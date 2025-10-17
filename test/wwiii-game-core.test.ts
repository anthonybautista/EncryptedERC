// WWIII Game Core Functionality Tests
// Focus: Player management, deployment, basic state management, and access control

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type {
    WWIIIGame,
    WWIIIToken,
    EmissionVault,
    Bunker,
    WWIIIGameToken,
    EncryptedUserBalances,
    Registrar
} from "../typechain-types";
import { deployGameVerifiers, deployLibrary } from "./helpers";
import { User } from "./user";

describe("WWIIIGame Core Functionality", function () {
    this.timeout(300000); // 5 minutes
    let owner: SignerWithAddress;
    let waracle: SignerWithAddress; 
    let player1: SignerWithAddress;
    let player2: SignerWithAddress;
    let player3: SignerWithAddress;
    let others: SignerWithAddress[];
    let wwiii: any;
    let vault: any;
    let rocket: any;
    let shield: any;
    let registrar: any;
    let encryptedUserBalances: any;
    let bunkers: any[];
    let bunkerAddresses: string[];
    let game: any;
    let testUsers: any[];
    let bunkerUsers: any[];
    let auditorUser: any;
    let tenK: any;
    let hundredK: any;
    let verifiers: any;

    beforeEach(async function () {
        [owner, waracle, player1, player2, player3, ...others] = await ethers.getSigners();
        
        // Deploy BabyJubJub library
        const babyJubJubAddress = await deployLibrary(owner);
        
        // Deploy verifiers
        verifiers = await deployGameVerifiers(owner);
        
        // Deploy WWIII token with 10B supply
        const WWIIITokenFactory = await ethers.getContractFactory("WWIIIToken");
        wwiii = await WWIIITokenFactory.deploy();
        await wwiii.waitForDeployment();
        
        // Deploy EmissionVault
        const EmissionVaultFactory = await ethers.getContractFactory("EmissionVault");
        vault = await EmissionVaultFactory.deploy(wwiii.target);
        await vault.waitForDeployment();
        
        // Transfer 6B tokens to vault
        const sixBillion = ethers.parseEther("6000000000");
        await wwiii.transfer(vault.target, sixBillion);
        
        // Deploy EncryptedUserBalances and Registrar
        const EncryptedUserBalancesFactory = await ethers.getContractFactory("EncryptedUserBalances");
        encryptedUserBalances = await EncryptedUserBalancesFactory.deploy();
        await encryptedUserBalances.waitForDeployment();
        
        const RegistrarFactory = await ethers.getContractFactory("Registrar");
        registrar = await RegistrarFactory.deploy(
            verifiers.registrationVerifier
        );
        await registrar.waitForDeployment();
        
        // Deploy ROCKET and SHIELD tokens
        const GameTokenFactory = await ethers.getContractFactory("WWIIIGameToken", {
            libraries: { BabyJubJub: babyJubJubAddress }
        });
        rocket = await GameTokenFactory.deploy({
            registrar: registrar.target,
            isConverter: false,
            name: "ROCKET",
            symbol: "ROCKET",
            decimals: 18,
            mintVerifier: verifiers.mintVerifier,
            withdrawVerifier: verifiers.withdrawVerifier,
            transferVerifier: verifiers.transferVerifier,
            burnVerifier: verifiers.burnVerifier
        });
        await rocket.waitForDeployment();
        
        shield = await GameTokenFactory.deploy({
            registrar: registrar.target,
            isConverter: false,
            name: "SHIELD",
            symbol: "SHIELD",
            decimals: 18,
            mintVerifier: verifiers.mintVerifier,
            withdrawVerifier: verifiers.withdrawVerifier,
            transferVerifier: verifiers.transferVerifier,
            burnVerifier: verifiers.burnVerifier
        });
        await shield.waitForDeployment();
        
        // Create test users for bunkers (each bunker needs unique BabyJubJub keys)
        bunkerUsers = [
            new User(others[0]), // Bunker 1
            new User(others[1]), // Bunker 2
            new User(others[2]), // Bunker 3
            new User(others[3]), // Bunker 4
            new User(others[4])  // Bunker 5
        ];
        
        // Deploy 5 bunker contracts
        const BunkerFactory = await ethers.getContractFactory("Bunker");
        bunkers = [];
        bunkerAddresses = [];
        
        for (let i = 1; i <= 5; i++) {
            const bunker = await BunkerFactory.deploy(
                i,
                wwiii.target
            );
            await bunker.waitForDeployment();
            bunkers.push(bunker);
            bunkerAddresses.push(bunker.target.toString());
            
            // Set bunker public key after deployment
            await bunker.setBunkerPublicKey([bunkerUsers[i-1].publicKey[0], bunkerUsers[i-1].publicKey[1]]);
        }
        
        // Deploy main game contract
        const WWIIIGameFactory = await ethers.getContractFactory("WWIIIGame");
        game = await WWIIIGameFactory.deploy(
            wwiii.target,
            vault.target,
            rocket.target,
            shield.target,
            registrar.target,
            verifiers.actionVerifier,
            bunkerAddresses,
            waracle.address
        );
        await game.waitForDeployment();
        
        // Set game contract in vault
        await vault.setGameContract(game.target);
        
        // Update game contract in bunkers
        for (const bunker of bunkers) {
            await bunker.updateGameContract(game.target);
        }
        
        // Transfer token ownership to game contract
        await rocket.transferOwnership(game.target);
        await shield.transferOwnership(game.target);
        await game.acceptTokenOwnership(rocket.target);
        await game.acceptTokenOwnership(shield.target);
        
        // Distribute WWIII tokens to test players
        tenK = ethers.parseEther("10000");
        hundredK = ethers.parseEther("100000");
        
        await wwiii.transfer(player1.address, hundredK);
        await wwiii.transfer(player2.address, hundredK);
        await wwiii.transfer(player3.address, hundredK);
        
        // Create player users for testing
        testUsers = [
            new User(player1),
            new User(player2),
            new User(player3)
        ];
    });

    describe("Deployment and Initialization", function () {
        it("Should deploy with correct initial state", async function () {
            expect(await game.WWIII()).to.equal(wwiii.target);
            expect(await game.emissionVault()).to.equal(vault.target);
            expect(await game.ROCKET()).to.equal(rocket.target);
            expect(await game.SHIELD()).to.equal(shield.target);
            expect(await game.registrar()).to.equal(registrar.target);
            expect(await game.trustedWaracle()).to.equal(waracle.address);
            
            // Check bunker addresses
            for (let i = 1; i <= 5; i++) {
                expect(await game.bunkerContracts(i)).to.equal(bunkerAddresses[i-1]);
            }
            
            // Check initial game state
            expect(await game.currentRound()).to.equal(0);
            expect(await game.gamePhase()).to.equal(0); // DEPLOYMENT phase
            expect(await game.gameHalted()).to.equal(false);
            expect(await game.minimumDeposit()).to.equal(ethers.parseEther("10000"));
        });

        it("Should have correct bunker indices initialized", async function () {
            const baseIndex = await game.BASE_INDEX();
            expect(baseIndex).to.equal(ethers.parseEther("10000")); // 10000 * 1e18
            
            for (let i = 1; i <= 5; i++) {
                const bunkerInfo = await game.getBunkerInfo(i);
                expect(bunkerInfo.bunkerState.index).to.equal(baseIndex);
                expect(bunkerInfo.bunkerState.totalDeployed).to.equal(0);
                expect(bunkerInfo.bunkerState.players.length).to.equal(0);
                expect(bunkerInfo.isDestroyed).to.equal(false);
            }
        });

        it("Should reject invalid constructor parameters", async function () {
            const WWIIIGameFactory = await ethers.getContractFactory("WWIIIGame");
            
            // Test with invalid bunker count
            await expect(
                WWIIIGameFactory.deploy(
                    wwiii.target,
                    vault.target,
                    rocket.target,
                    shield.target,
                    registrar.target,
                    verifiers.actionVerifier,
                    [], // Empty bunker array
                    waracle.address
                )
            ).to.be.revertedWithCustomError(game, "InvalidBunkerCount");
            
            // Test with zero address
            await expect(
                WWIIIGameFactory.deploy(
                    ethers.ZeroAddress,
                    vault.target,
                    rocket.target,
                    shield.target,
                    registrar.target,
                    verifiers.actionVerifier,
                    bunkerAddresses,
                    waracle.address
                )
            ).to.be.revertedWithCustomError(game, "InvalidTokenAddress");
        });
    });

    describe("Player Deployment", function () {
        it("Should allow player to deploy to bunker with minimum amount", async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            
            await expect(game.connect(player1).deploy(1, tenK))
                .to.emit(game, "PlayerDeployed")
                .withArgs(player1.address, 1, tenK, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
            
            const playerInfo = await game.players(player1.address);
            expect(playerInfo.currentBunker).to.equal(1);
            expect(playerInfo.deployedAmount).to.equal(tenK);
            expect(playerInfo.lastActionRound).to.equal(0);
            expect(playerInfo.deploymentTimestamp).to.be.greaterThan(0);
            
            const currentDeployment = await game.getCurrentDeployment(player1.address);
            expect(currentDeployment).to.equal(tenK);
        });

        it("Should reject deployment below minimum", async function () {
            const belowMin = ethers.parseEther("9999");
            await wwiii.connect(player1).approve(game.target, belowMin);
            
            await expect(game.connect(player1).deploy(1, belowMin))
                .to.be.revertedWithCustomError(game, "BelowMinimumDeposit");
        });

        it("Should reject deployment to invalid bunker", async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            
            await expect(game.connect(player1).deploy(0, tenK))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
            
            await expect(game.connect(player1).deploy(6, tenK))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
        });

        it("Should reject double deployment", async function () {
            await wwiii.connect(player1).approve(game.target, tenK * 2n);
            
            await game.connect(player1).deploy(1, tenK);
            
            await expect(game.connect(player1).deploy(2, tenK))
                .to.be.revertedWithCustomError(game, "AlreadyDeployed");
        });

        it("Should update bunker metadata correctly", async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await wwiii.connect(player2).approve(game.target, tenK);
            
            await game.connect(player1).deploy(1, tenK);
            await game.connect(player2).deploy(1, tenK);
            
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK * 2n);
            expect(bunkerInfo.bunkerState.players.length).to.equal(2);
            expect(bunkerInfo.bunkerState.players).to.include(player1.address);
            expect(bunkerInfo.bunkerState.players).to.include(player2.address);
        });

        it("Should transfer tokens to bunker contract", async function () {
            const initialBunkerBalance = await wwiii.balanceOf(bunkerAddresses[0]);
            
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            const finalBunkerBalance = await wwiii.balanceOf(bunkerAddresses[0]);
            expect(finalBunkerBalance).to.equal(initialBunkerBalance + tenK);
        });
    });

    describe("Adding Tokens", function () {
        beforeEach(async function () {
            await wwiii.connect(player1).approve(game.target, tenK * 3n);
            await game.connect(player1).deploy(1, tenK);
        });

        it("Should allow adding tokens before taking action", async function () {
            await expect(game.connect(player1).addTokens(tenK))
                .to.emit(game, "PlayerAddedTokens")
                .withArgs(player1.address, 1, tenK, tenK * 2n);
            
            const playerInfo = await game.players(player1.address);
            expect(playerInfo.deployedAmount).to.equal(tenK * 2n);
            
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK * 2n);
        });

        it("Should reject adding tokens if not deployed", async function () {
            await wwiii.connect(player2).approve(game.target, tenK);
            
            await expect(game.connect(player2).addTokens(tenK))
                .to.be.revertedWithCustomError(game, "NotDeployed");
        });

        it("Should reject adding zero tokens", async function () {
            await expect(game.connect(player1).addTokens(0))
                .to.be.revertedWithCustomError(game, "ZeroAmount");
        });

        it("Should update deposit index correctly", async function () {
            const playerInfoBefore = await game.players(player1.address);
            const bunkerIndexBefore = await game.bunkers(1);
            
            await game.connect(player1).addTokens(tenK);
            
            const playerInfoAfter = await game.players(player1.address);
            expect(playerInfoAfter.depositIndex).to.equal(bunkerIndexBefore.index);
        });
    });

    describe("Player Retreat", function () {
        beforeEach(async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
        });

        it("Should allow player to retreat and withdraw tokens", async function () {
            const initialBalance = await wwiii.balanceOf(player1.address);
            
            await expect(game.connect(player1).retreat())
                .to.emit(game, "PlayerRetreated");
            
            const finalBalance = await wwiii.balanceOf(player1.address);
            expect(finalBalance).to.equal(initialBalance + tenK);
            
            const playerInfo = await game.players(player1.address);
            expect(playerInfo.currentBunker).to.equal(0);
            expect(playerInfo.deployedAmount).to.equal(0);
            expect(playerInfo.deploymentTimestamp).to.equal(0);
            expect(playerInfo.depositIndex).to.equal(0);
        });

        it("Should reject retreat if not deployed", async function () {
            await expect(game.connect(player2).retreat())
                .to.be.revertedWithCustomError(game, "NotDeployed");
        });

        it("Should update bunker metadata on retreat", async function () {
            await wwiii.connect(player2).approve(game.target, tenK);
            await game.connect(player2).deploy(1, tenK);
            
            await game.connect(player1).retreat();
            
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK); // Only player2 remains
            expect(bunkerInfo.bunkerState.players.length).to.equal(1);
            expect(bunkerInfo.bunkerState.players[0]).to.equal(player2.address);
        });

        it("Should calculate deployment duration correctly", async function () {
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
            await ethers.provider.send("evm_mine", []);
            
            const tx = await game.connect(player1).retreat();
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    const parsed = game.interface.parseLog(log);
                    return parsed?.name === "PlayerRetreated";
                } catch {
                    return false;
                }
            });
            
            if (event) {
                const parsed = game.interface.parseLog(event);
                const deploymentDuration = parsed?.args.deploymentDuration;
                expect(deploymentDuration).to.be.greaterThan(3600 - 10); // Allow for small timing differences
            }
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
        });

        it("Should return correct player info", async function () {
            const playerInfo = await game.getPlayerInfo(player1.address);
            expect(playerInfo.currentBunker).to.equal(1);
            expect(playerInfo.deployedAmount).to.equal(tenK);
            expect(playerInfo.currentDeployment).to.equal(tenK);
            expect(playerInfo.hasActedThisRound).to.equal(false);
            expect(playerInfo.canAddTokens).to.equal(true);
            expect(playerInfo.canAct).to.equal(true);
        });

        it("Should return correct bunker info", async function () {
            await wwiii.connect(player2).approve(game.target, tenK);
            await game.connect(player2).deploy(1, tenK);
            
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerContract).to.equal(bunkerAddresses[0]);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK * 2n);
            expect(bunkerInfo.bunkerState.players.length).to.equal(2);
            expect(bunkerInfo.bunkerState.index).to.equal(await game.BASE_INDEX());
            expect(bunkerInfo.isDestroyed).to.equal(false);
        });

        it("Should return correct game state", async function () {
            const gameState = await game.getGameState();
            expect(gameState._currentRound).to.equal(0);
            expect(gameState._gameHalted).to.equal(false);
            expect(gameState.gameEnded).to.equal(false);
            expect(gameState._remainingEmissions).to.be.greaterThan(0);
        });

        it("Should return current deployment with precision", async function () {
            const currentDeployment = await game.getCurrentDeployment(player1.address);
            expect(currentDeployment).to.equal(tenK);
            
            // Test with zero address
            const zeroDeployment = await game.getCurrentDeployment(ethers.ZeroAddress);
            expect(zeroDeployment).to.equal(0);
        });
    });

    describe("Access Control", function () {
        it("Should restrict Waracle functions", async function () {
            await expect(game.connect(player1).WWIIInu([0,0,0,0,0], [0,0,0,0,0]))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
            
            await expect(game.connect(player1).startNewRound())
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
            
            await expect(game.connect(player1).destroyBunker(1, 10))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
        });

        it("Should restrict owner functions", async function () {
            await expect(game.connect(player1).setMinimumDeposit(ethers.parseEther("20000")))
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
            
            await expect(game.connect(player1).haltGame())
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
            
            await expect(game.connect(player1).startGame(Math.floor(Date.now() / 1000) + 3600))
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
        });

        it("Should allow owner to update minimum deposit", async function () {
            const newMinimum = ethers.parseEther("20000");
            
            await expect(game.connect(owner).setMinimumDeposit(newMinimum))
                .to.emit(game, "MinimumDepositUpdated")
                .withArgs(ethers.parseEther("10000"), newMinimum);
            
            expect(await game.minimumDeposit()).to.equal(newMinimum);
        });

        it("Should allow owner to update Waracle", async function () {
            const newWaracle = player3.address;
            
            await expect(game.connect(owner).setWaracle(newWaracle))
                .to.emit(game, "WaracleUpdated")
                .withArgs(waracle.address, newWaracle);
            
            expect(await game.trustedWaracle()).to.equal(newWaracle);
        });

        it("Should reject zero address for Waracle", async function () {
            await expect(game.connect(owner).setWaracle(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(game, "InvalidWaracleAddress");
        });
    });

    describe("Token Ownership Management", function () {
        it("Should transfer ROCKET token ownership", async function () {
            expect(await rocket.owner()).to.equal(game.target);

            await game.connect(owner).transferTokenOwnership(rocket.target, player1.address);
            
            expect(await rocket.pendingOwner()).to.equal(player1.address);
            expect(await rocket.owner()).to.equal(game.target); // Still current owner

            await rocket.connect(player1).acceptOwnership();
            
            expect(await rocket.owner()).to.equal(player1.address);
            expect(await rocket.pendingOwner()).to.equal(ethers.ZeroAddress);
        });

        it("Should transfer SHIELD token ownership", async function () {
            expect(await shield.owner()).to.equal(game.target);

            await game.connect(owner).transferTokenOwnership(shield.target, player1.address);
            
            expect(await shield.pendingOwner()).to.equal(player1.address);
            expect(await shield.owner()).to.equal(game.target);

            await shield.connect(player1).acceptOwnership();
            
            expect(await shield.owner()).to.equal(player1.address);
            expect(await shield.pendingOwner()).to.equal(ethers.ZeroAddress);
        });

        it("Should allow game contract to accept token ownership", async function () {
            await game.connect(owner).transferTokenOwnership(rocket.target, player1.address);
            await rocket.connect(player1).acceptOwnership();
            
            await rocket.connect(player1).transferOwnership(game.target);
            
            await game.connect(owner).acceptTokenOwnership(rocket.target);
            
            expect(await rocket.owner()).to.equal(game.target);
        });

        it("Should reject invalid token addresses for ownership transfer", async function () {
            await expect(
                game.connect(owner).transferTokenOwnership(ethers.ZeroAddress, player1.address)
            ).to.be.revertedWithCustomError(game, "InvalidTokenAddress");

            await expect(
                game.connect(owner).transferTokenOwnership(player1.address, player1.address)
            ).to.be.revertedWithCustomError(game, "InvalidTokenAddress");
        });

        it("Should reject zero address as new owner", async function () {
            await expect(
                game.connect(owner).transferTokenOwnership(rocket.target, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(game, "InvalidRecipient");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow owner to halt game", async function () {
            await expect(game.connect(owner).haltGame())
                .to.emit(game, "GameHalted")
                .withArgs(0, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
            
            expect(await game.gameHalted()).to.equal(true);
            expect(await game.gamePhase()).to.equal(2); // HALTED
        });

        it("Should block actions when game halted", async function () {
            await game.connect(owner).haltGame();
            
            await wwiii.connect(player1).approve(game.target, tenK);
            
            await expect(game.connect(player1).deploy(1, tenK))
                .to.be.revertedWithCustomError(game, "GameIsHalted");
        });

        it("Should still allow retreat when halted", async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            await game.connect(owner).haltGame();
            
            await expect(game.connect(player1).retreat())
                .to.not.be.reverted;
        });

        it("Should allow emergency token withdrawal", async function () {
            // Deploy a test ERC20 token
            const TestTokenFactory = await ethers.getContractFactory("WWIIIToken");
            const testToken = await TestTokenFactory.deploy();
            await testToken.waitForDeployment();
            
            // Send some tokens to game contract
            const testAmount = ethers.parseEther("1000");
            await testToken.transfer(game.target, testAmount);
            
            await expect(game.connect(owner).emergencyWithdrawToken(testToken.target, player1.address, testAmount))
                .to.emit(game, "EmergencyWithdraw")
                .withArgs(testToken.target, player1.address, testAmount);
            
            expect(await testToken.balanceOf(player1.address)).to.equal(testAmount);
        });

        it("Should reject withdrawal of WWIII token", async function () {
            await expect(game.connect(owner).emergencyWithdrawToken(wwiii.target, player1.address, 1000))
                .to.be.revertedWithCustomError(game, "CannotWithdrawGameToken");
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle bunker ID validation consistently", async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            
            for (const invalidId of [0, 6, 255]) {
                await expect(game.connect(player1).deploy(invalidId, tenK))
                    .to.be.revertedWithCustomError(game, "InvalidBunkerId");
            }
        });

        it("Should handle insufficient token balance gracefully", async function () {
            const excessiveAmount = ethers.parseEther("1000000");
            await wwiii.connect(player1).approve(game.target, excessiveAmount);
            
            await expect(game.connect(player1).deploy(1, excessiveAmount))
                .to.be.reverted; // ERC20 transfer will fail
        });

        it("Should handle zero deployment calculations", async function () {
            const zeroCurrentDeployment = await game.getCurrentDeployment(player1.address);
            expect(zeroCurrentDeployment).to.equal(0);
        });

        it("Should validate bunker info queries", async function () {
            await expect(game.getBunkerInfo(0))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
            
            await expect(game.getBunkerInfo(6))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
        });
    });
});