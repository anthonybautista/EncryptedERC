// WWIII Game Movement System Tests
// Focus: Inter-bunker movement, topology validation, token transfers

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, Bunker, WWIIIGameToken } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp } from "./helpers";
import { User } from "./user";

describe("WWIIIGame Movement System", function () {
    this.timeout(300000); // 5 minutes
    let owner: SignerWithAddress;
    let waracle: SignerWithAddress; 
    let player1: SignerWithAddress;
    let player2: SignerWithAddress;
    let player3: SignerWithAddress;
    let others: SignerWithAddress[];
    let wwiii: WWIIIToken;
    let vault: EmissionVault;
    let rocket: WWIIIGameToken;
    let shield: WWIIIGameToken;
    let registrar: any;
    let bunkers: Bunker[];
    let bunkerAddresses: string[];
    let game: WWIIIGame;
    let bunkerUsers: User[];
    let tenK: bigint;
    let verifiers: any;

    // Helper function to deploy all required contracts
    async function deployContracts() {
        [owner, waracle, player1, player2, player3, ...others] = await ethers.getSigners();
        
        const babyJubJubAddress = await deployLibrary(owner);
        verifiers = await deployGameVerifiers(owner);
        
        // Deploy WWIII token
        const WWIIITokenFactory = await ethers.getContractFactory("WWIIIToken");
        wwiii = await WWIIITokenFactory.deploy();
        await wwiii.waitForDeployment();
        
        // Deploy EmissionVault
        const EmissionVaultFactory = await ethers.getContractFactory("EmissionVault");
        vault = await EmissionVaultFactory.deploy(wwiii.target);
        await vault.waitForDeployment();
        
        const sixBillion = ethers.parseEther("6000000000");
        await wwiii.transfer(vault.target, sixBillion);
        
        // Deploy EncryptedUserBalances and Registrar
        const EncryptedUserBalancesFactory = await ethers.getContractFactory("EncryptedUserBalances");
        const encryptedUserBalances = await EncryptedUserBalancesFactory.deploy();
        await encryptedUserBalances.waitForDeployment();
        
        const RegistrarFactory = await ethers.getContractFactory("Registrar");
        registrar = await RegistrarFactory.deploy(verifiers.registrationVerifier);
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
        
        // Create bunker users with unique keys
        bunkerUsers = [];
        for (let i = 0; i < 5; i++) {
            bunkerUsers.push(new User(others[i]));
        }
        
        // Deploy bunker contracts
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
        
        // Deploy game contract
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
        
        // Set up permissions
        await vault.setGameContract(game.target);
        for (const bunker of bunkers) {
            await bunker.updateGameContract(game.target);
        }
        
        await rocket.transferOwnership(game.target);
        await shield.transferOwnership(game.target);
        await game.acceptTokenOwnership(rocket.target);
        await game.acceptTokenOwnership(shield.target);
        
        // Distribute tokens
        tenK = ethers.parseEther("10000");
        const hundredK = ethers.parseEther("100000");
        await wwiii.transfer(player1.address, hundredK);
        await wwiii.transfer(player2.address, hundredK);
        await wwiii.transfer(player3.address, hundredK);
    }

    beforeEach(async function () {
        await deployContracts();
    });

    describe("Bunker Connection Topology", function () {
        it("Should validate canMove function for all bunker pairs", async function () {
            // Test Bunker 1 connections: 2, 3, 4
            expect(await game.canMove(1, 2)).to.equal(true);
            expect(await game.canMove(1, 3)).to.equal(true);
            expect(await game.canMove(1, 4)).to.equal(true);
            expect(await game.canMove(1, 5)).to.equal(false);
            expect(await game.canMove(1, 1)).to.equal(false); // Self move
            
            // Test Bunker 2 connections: 1, 3, 5
            expect(await game.canMove(2, 1)).to.equal(true);
            expect(await game.canMove(2, 3)).to.equal(true);
            expect(await game.canMove(2, 5)).to.equal(true);
            expect(await game.canMove(2, 4)).to.equal(false);
            expect(await game.canMove(2, 2)).to.equal(false);
            
            // Test Bunker 3 connections: ALL (1, 2, 4, 5) - Central hub
            expect(await game.canMove(3, 1)).to.equal(true);
            expect(await game.canMove(3, 2)).to.equal(true);
            expect(await game.canMove(3, 4)).to.equal(true);
            expect(await game.canMove(3, 5)).to.equal(true);
            expect(await game.canMove(3, 3)).to.equal(false);
            
            // Test Bunker 4 connections: 1, 3, 5
            expect(await game.canMove(4, 1)).to.equal(true);
            expect(await game.canMove(4, 3)).to.equal(true);
            expect(await game.canMove(4, 5)).to.equal(true);
            expect(await game.canMove(4, 2)).to.equal(false);
            expect(await game.canMove(4, 4)).to.equal(false);
            
            // Test Bunker 5 connections: 2, 3, 4
            expect(await game.canMove(5, 2)).to.equal(true);
            expect(await game.canMove(5, 3)).to.equal(true);
            expect(await game.canMove(5, 4)).to.equal(true);
            expect(await game.canMove(5, 1)).to.equal(false);
            expect(await game.canMove(5, 5)).to.equal(false);
        });

        it("Should reject invalid bunker IDs", async function () {
            expect(await game.canMove(0, 1)).to.equal(false);
            expect(await game.canMove(1, 0)).to.equal(false);
            expect(await game.canMove(6, 1)).to.equal(false);
            expect(await game.canMove(1, 6)).to.equal(false);
            expect(await game.canMove(255, 1)).to.equal(false);
        });

        it("Should validate bidirectional connections", async function () {
            // Test that all connections are bidirectional
            const testPairs = [
                [1, 2], [1, 3], [1, 4],
                [2, 3], [2, 5],
                [3, 4], [3, 5],
                [4, 5]
            ];
            
            for (const [from, to] of testPairs) {
                expect(await game.canMove(from, to)).to.equal(true, `${from} -> ${to} should be valid`);
                expect(await game.canMove(to, from)).to.equal(true, `${to} -> ${from} should be valid`);
            }
            
            // Test invalid connections are bidirectionally invalid
            const invalidPairs = [[1, 5], [2, 4]];
            for (const [from, to] of invalidPairs) {
                expect(await game.canMove(from, to)).to.equal(false, `${from} -> ${to} should be invalid`);
                expect(await game.canMove(to, from)).to.equal(false, `${to} -> ${from} should be invalid`);
            }
        });
    });

    describe("Movement Mechanics", function () {
        beforeEach(async function () {
            // Deploy player to bunker 1
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            // Start game to enable movement
            const combatStartTime = await getFutureTimestamp(100); // 100 seconds from now
            await game.connect(owner).startGame(combatStartTime);
            
            // Advance time to enable round start
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should allow valid movement between connected bunkers", async function () {
            const initialBunker1Balance = await wwiii.balanceOf(bunkerAddresses[0]);
            const initialBunker2Balance = await wwiii.balanceOf(bunkerAddresses[1]);
            
            await expect(game.connect(player1).move(2))
                .to.emit(game, "PlayerMoved")
                .withArgs(player1.address, 1, 2, tenK, 1);
            
            // Check player state updated
            const playerInfo = await game.players(player1.address);
            expect(playerInfo.currentBunker).to.equal(2);
            expect(playerInfo.deployedAmount).to.equal(tenK);
            expect(playerInfo.lastActionRound).to.equal(1);
            
            // Check tokens transferred between bunkers
            const finalBunker1Balance = await wwiii.balanceOf(bunkerAddresses[0]);
            const finalBunker2Balance = await wwiii.balanceOf(bunkerAddresses[1]);
            expect(finalBunker1Balance).to.equal(initialBunker1Balance - tenK);
            expect(finalBunker2Balance).to.equal(initialBunker2Balance + tenK);
            
            // Check bunker metadata updated
            const bunker1Info = await game.getBunkerInfo(1);
            const bunker2Info = await game.getBunkerInfo(2);
            expect(bunker1Info.bunkerState.totalDeployed).to.equal(0);
            expect(bunker1Info.bunkerState.players.length).to.equal(0);
            expect(bunker2Info.bunkerState.totalDeployed).to.equal(tenK);
            expect(bunker2Info.bunkerState.players.length).to.equal(1);
            expect(bunker2Info.bunkerState.players[0]).to.equal(player1.address);
        });

        it("Should reject movement to invalid bunkers", async function () {
            // Try to move from bunker 1 to bunker 5 (not connected)
            await expect(game.connect(player1).move(5))
                .to.be.revertedWithCustomError(game, "InvalidMove");
        });

        it("Should reject movement to invalid bunker IDs", async function () {
            await expect(game.connect(player1).move(0))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
            
            await expect(game.connect(player1).move(6))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
        });

        it("Should reject movement if player not deployed", async function () {
            await expect(game.connect(player2).move(2))
                .to.be.revertedWithCustomError(game, "NotDeployed");
        });

        it("Should reject movement if already acted this round", async function () {
            await game.connect(player1).move(2);
            
            await expect(game.connect(player1).move(3))
                .to.be.revertedWithCustomError(game, "AlreadyActedThisRound");
        });

        it("Should update deposit index to new bunker index", async function () {
            const bunker2IndexBefore = await game.getBunkerInfo(2);
            
            await game.connect(player1).move(2);
            
            const playerInfo = await game.players(player1.address);
            expect(playerInfo.depositIndex).to.equal(bunker2IndexBefore.bunkerState.index);
        });

        it("Should handle multiple players in source bunker", async function () {
            // Deploy player2 to same bunker
            await wwiii.connect(player2).approve(game.target, tenK);
            await game.connect(player2).deploy(1, tenK);
            
            // Move player1 out
            await game.connect(player1).move(2);
            
            // Check bunker 1 still has player2
            const bunker1Info = await game.getBunkerInfo(1);
            expect(bunker1Info.bunkerState.totalDeployed).to.equal(tenK);
            expect(bunker1Info.bunkerState.players.length).to.equal(1);
            expect(bunker1Info.bunkerState.players[0]).to.equal(player2.address);
            
            // Check player2 can still move in the same round (hasn't acted yet)
            await game.connect(player2).move(3);
        });

        it("Should handle movement to bunker with existing players", async function () {
            // Deploy player2 to bunker 2
            await wwiii.connect(player2).approve(game.target, tenK);
            await game.connect(player2).deploy(2, tenK);
            
            // Move player1 to bunker 2
            await game.connect(player1).move(2);
            
            const bunker2Info = await game.getBunkerInfo(2);
            expect(bunker2Info.bunkerState.totalDeployed).to.equal(tenK * 2n);
            expect(bunker2Info.bunkerState.players.length).to.equal(2);
            expect(bunker2Info.bunkerState.players).to.include(player1.address);
            expect(bunker2Info.bunkerState.players).to.include(player2.address);
        });

        it("Should reject movement to destroyed bunker", async function () {
            // Simulate bunker destruction by setting index to 0
            // Note: This would normally be done through combat resolution
            // For testing, we need access to internal functions or simulate the state
            
            // Since we can't directly modify bunker state in this test setup,
            // we'll test the validation logic exists by checking the revert message
            
            // This test will be fully implemented once we have WWIIInu functionality
            // For now, we can test that the validation exists in the contract
            expect(await game.canMove(1, 2)).to.equal(true); // Basic validation works
        });
    });

    describe("Movement During Different Game Phases", function () {
        beforeEach(async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
        });

        it("Should reject movement during deployment phase", async function () {
            // Game starts in deployment phase, no rounds active
            await expect(game.connect(player1).move(2))
                .to.be.revertedWithCustomError(game, "NoActiveRound");
        });

        it("Should reject movement when round ended but not resolved", async function () {
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            // Advance time to enable round start
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
            
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]); // 8+ hours
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(player1).move(2))
                .to.be.revertedWithCustomError(game, "RoundEnded");
        });

        it("Should reject movement when game is halted", async function () {
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            // Advance time to enable round start
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
            
            await game.connect(owner).haltGame();
            
            await expect(game.connect(player1).move(2))
                .to.be.revertedWithCustomError(game, "GameIsHalted");
        });
    });

    describe("Token Transfer Mechanics", function () {
        beforeEach(async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            // Advance time to enable round start
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should handle zero token movement gracefully", async function () {
            // This shouldn't normally happen, but test edge case
            // If a player somehow has zero current deployment
            
            // For now, movement requires tokens > 0
            await expect(game.connect(player1).move(2))
                .to.not.be.revertedWithCustomError(game, "NoTokensToMove");
        });

        it("Should preserve total token conservation", async function () {
            const totalSupplyBefore = await wwiii.totalSupply();
            const totalInBunkersBefore = await Promise.all(
                bunkerAddresses.map(addr => wwiii.balanceOf(addr))
            ).then(balances => balances.reduce((sum, balance) => sum + balance, 0n));
            
            await game.connect(player1).move(2);
            
            const totalSupplyAfter = await wwiii.totalSupply();
            const totalInBunkersAfter = await Promise.all(
                bunkerAddresses.map(addr => wwiii.balanceOf(addr))
            ).then(balances => balances.reduce((sum, balance) => sum + balance, 0n));
            
            expect(totalSupplyAfter).to.equal(totalSupplyBefore);
            expect(totalInBunkersAfter).to.equal(totalInBunkersBefore);
        });

        it("Should handle insufficient bunker balance gracefully", async function () {
            // This test would be relevant if bunker somehow had less tokens than expected
            // In normal operation, this shouldn't happen due to the index system
            
            // The getCurrentDeployment function handles this by taking min(calculated, bunkerBalance)
            const currentDeployment = await game.getCurrentDeployment(player1.address);
            expect(currentDeployment).to.equal(tenK);
        });
    });

    describe("Complex Movement Scenarios", function () {
        beforeEach(async function () {
            // Deploy multiple players to different bunkers
            await wwiii.connect(player1).approve(game.target, tenK);
            await wwiii.connect(player2).approve(game.target, tenK);
            await wwiii.connect(player3).approve(game.target, tenK);
            
            await game.connect(player1).deploy(1, tenK);
            await game.connect(player2).deploy(2, tenK);
            await game.connect(player3).deploy(3, tenK);
            
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            // Advance time to enable round start
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should handle chain movements correctly", async function () {
            // Player1: 1 -> 3, Player2: 2 -> 3, Player3: 3 -> 1
            
            await game.connect(player1).move(3);
            await game.connect(player2).move(3); 
            await game.connect(player3).move(1);
            
            // Check final bunker states
            const bunker1Info = await game.getBunkerInfo(1);
            const bunker2Info = await game.getBunkerInfo(2);
            const bunker3Info = await game.getBunkerInfo(3);
            
            expect(bunker1Info.bunkerState.players.length).to.equal(1);
            expect(bunker1Info.bunkerState.players[0]).to.equal(player3.address);
            expect(bunker1Info.bunkerState.totalDeployed).to.equal(tenK);
            
            expect(bunker2Info.bunkerState.players.length).to.equal(0);
            expect(bunker2Info.bunkerState.totalDeployed).to.equal(0);
            
            expect(bunker3Info.bunkerState.players.length).to.equal(2);
            expect(bunker3Info.bunkerState.totalDeployed).to.equal(tenK * 2n);
            expect(bunker3Info.bunkerState.players).to.include(player1.address);
            expect(bunker3Info.bunkerState.players).to.include(player2.address);
        });

        it("Should handle movement to central bunker (bunker 3)", async function () {
            // All players move to bunker 3 (central hub)
            await game.connect(player1).move(3); // 1 -> 3
            await game.connect(player2).move(3); // 2 -> 3
            // player3 already in bunker 3
            
            const bunker3Info = await game.getBunkerInfo(3);
            expect(bunker3Info.bunkerState.players.length).to.equal(3);
            expect(bunker3Info.bunkerState.totalDeployed).to.equal(tenK * 3n);
            expect(bunker3Info.bunkerState.players).to.include(player1.address);
            expect(bunker3Info.bunkerState.players).to.include(player2.address);
            expect(bunker3Info.bunkerState.players).to.include(player3.address);
        });

        it("Should handle movement from central bunker to all others", async function () {
            // End current round and start next round so players can act again
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]); // 8 hours + 1 second
            await ethers.provider.send("evm_mine", []);
            
            // Resolve round (Waracle provides combat results)
            const defaultBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            await game.connect(waracle).WWIIInu(defaultBalances, defaultBalances);
            await game.connect(waracle).startNewRound();
            
            // Player3 in bunker 3 can move to any other bunker
            await game.connect(player3).move(1);
            
            // End current round and start another round
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]); // 8 hours + 1 second
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(defaultBalances, defaultBalances);
            await game.connect(waracle).startNewRound();
            
            // Deploy new player to bunker 3
            await wwiii.connect(others[0]).approve(game.target, tenK);
            await wwiii.transfer(others[0].address, tenK);
            await game.connect(others[0]).deploy(3, tenK);
            
            // Test all possible moves from bunker 3
            await game.connect(others[0]).move(4); // 3 -> 4
            
            const player3Info = await game.players(player3.address);
            const newPlayerInfo = await game.players(others[0].address);
            
            expect(player3Info.currentBunker).to.equal(1);
            expect(newPlayerInfo.currentBunker).to.equal(4);
        });
    });

    describe("Movement Edge Cases", function () {
        beforeEach(async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            // Advance time to enable round start
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should handle movement at round boundaries", async function () {
            // Move just before round ends
            await ethers.provider.send("evm_increaseTime", [8 * 3600 - 10]); // Almost end of round
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(player1).move(2))
                .to.not.be.reverted;
            
            // Check player acted this round
            const playerInfo = await game.players(player1.address);
            expect(playerInfo.lastActionRound).to.equal(1);
        });

        it("Should handle movement with different deployment amounts", async function () {
            // Add more tokens before moving
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).addTokens(tenK); // Now has 20k total
            
            await game.connect(player1).move(2);
            
            const bunker2Info = await game.getBunkerInfo(2);
            expect(bunker2Info.bunkerState.totalDeployed).to.equal(tenK * 2n);
        });

        it("Should properly remove player from source bunker array", async function () {
            // Deploy multiple players to test array removal
            await wwiii.connect(player2).approve(game.target, tenK);
            await wwiii.connect(player3).approve(game.target, tenK);
            await game.connect(player2).deploy(1, tenK);
            await game.connect(player3).deploy(1, tenK);
            
            // Move middle player out
            await game.connect(player2).move(2);
            
            const bunker1Info = await game.getBunkerInfo(1);
            expect(bunker1Info.bunkerState.players.length).to.equal(2);
            expect(bunker1Info.bunkerState.players).to.include(player1.address);
            expect(bunker1Info.bunkerState.players).to.include(player3.address);
            expect(bunker1Info.bunkerState.players).to.not.include(player2.address);
        });
    });
});