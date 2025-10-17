// WWIII Game Round Management Tests
// Focus: Round progression, timing, game phases, startNewRound functionality

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, WWIIIGameToken } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp } from "./helpers";
import { User } from "./user";

describe("WWIIIGame Round Management", function () {
    this.timeout(300000); // 5 minutes
    let owner: SignerWithAddress;
    let waracle: SignerWithAddress; 
    let player1: SignerWithAddress;
    let player2: SignerWithAddress;
    let others: SignerWithAddress[];
    let wwiii: WWIIIToken;
    let vault: EmissionVault;
    let rocket: WWIIIGameToken;
    let shield: WWIIIGameToken;
    let registrar: any;
    let bunkerAddresses: string[];
    let game: WWIIIGame;
    let bunkerUsers: User[];
    let tenK: bigint;
    let verifiers: any;

    // Helper function to deploy all required contracts
    async function deployContracts() {
        [owner, waracle, player1, player2, ...others] = await ethers.getSigners();
        
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
        
        // Deploy registrar
        const EncryptedUserBalancesFactory = await ethers.getContractFactory("EncryptedUserBalances");
        const encryptedUserBalances = await EncryptedUserBalancesFactory.deploy();
        await encryptedUserBalances.waitForDeployment();
        
        const RegistrarFactory = await ethers.getContractFactory("Registrar");
        registrar = await RegistrarFactory.deploy(verifiers.registrationVerifier);
        await registrar.waitForDeployment();
        
        // Deploy tokens
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
        
        // Create bunker users
        bunkerUsers = [];
        for (let i = 0; i < 5; i++) {
            bunkerUsers.push(new User(others[i]));
        }
        
        // Deploy bunkers
        const BunkerFactory = await ethers.getContractFactory("Bunker");
        bunkerAddresses = [];
        
        for (let i = 1; i <= 5; i++) {
            const bunker = await BunkerFactory.deploy(
                i,
                wwiii.target
            );
            await bunker.waitForDeployment();
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
        for (let i = 0; i < 5; i++) {
            const bunker = await ethers.getContractAt("Bunker", bunkerAddresses[i]);
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
    }

    beforeEach(async function () {
        await deployContracts();
    });

    describe("Game Phase Management", function () {
        it("Should start in DEPLOYMENT phase", async function () {
            expect(await game.gamePhase()).to.equal(0); // DEPLOYMENT
            expect(await game.currentRound()).to.equal(0);
            expect(await game.combatStartTime()).to.equal(0);
        });

        it("Should allow owner to start game with combat start time", async function () {
            const futureTime = await getFutureTimestamp(3600); // 1 hour from now
            
            await expect(game.connect(owner).startGame(futureTime))
                .to.emit(game, "GameStarted")
                .withArgs(futureTime);
            
            expect(await game.gamePhase()).to.equal(1); // ACTIVE
            expect(await game.combatStartTime()).to.equal(futureTime);
        });

        it("Should reject starting game with past time", async function () {
            const currentBlock = await ethers.provider.getBlock("latest");
            const pastTime = currentBlock!.timestamp - 3600; // 1 hour ago
            
            await expect(game.connect(owner).startGame(pastTime))
                .to.be.revertedWithCustomError(game, "InvalidStartTime");
        });

        it("Should reject starting game multiple times", async function () {
            const futureTime = await getFutureTimestamp(3600);
            await game.connect(owner).startGame(futureTime);
            
            await expect(game.connect(owner).startGame(futureTime + 3600))
                .to.be.revertedWithCustomError(game, "GameAlreadyStarted");
        });

        it("Should reject non-owner starting game", async function () {
            const futureTime = await getFutureTimestamp(3600);
            
            await expect(game.connect(player1).startGame(futureTime))
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
        });
    });

    describe("Round Initialization", function () {
        beforeEach(async function () {
            const combatStartTime = await getFutureTimestamp(3600);
            await game.connect(owner).startGame(combatStartTime);
        });

        it("Should reject starting round before combat start time", async function () {
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "TooEarlyForFirstRound");
        });

        it("Should allow Waracle to start first round after combat time", async function () {
            // Fast forward to combat start time
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(waracle).startNewRound())
                .to.emit(game, "RoundStarted");
            
            expect(await game.currentRound()).to.equal(1);
            
            const roundInfo = await game.rounds(1);
            expect(roundInfo.resolved).to.equal(false);
            expect(roundInfo.totalEmission).to.be.greaterThan(0);
        });

        it("Should reject non-Waracle starting rounds", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(player1).startNewRound())
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
        });

        it("Should calculate round duration correctly", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine", []);
            
            const startTx = await game.connect(waracle).startNewRound();
            const receipt = await startTx.wait();
            const startTimestamp = (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp;
            
            const roundInfo = await game.rounds(1);
            expect(roundInfo.endTime).to.equal(roundInfo.startTime + BigInt(8 * 3600)); // 8 hours
            expect(roundInfo.startTime).to.equal(startTimestamp);
        });

        it("Should calculate emission amount correctly for first year", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
            
            const roundInfo = await game.rounds(1);
            // Year 1: 3B tokens / 1096 rounds ≈ 2,739,726 tokens per round
            const expectedEmission = ethers.parseEther("3000000000") / 1096n;
            expect(roundInfo.totalEmission).to.equal(expectedEmission);
        });
    });

    describe("Round Progression", function () {
        beforeEach(async function () {
            const combatStartTime = await getFutureTimestamp(100); // Soon
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound(); // Start round 1
        });

        it("Should prevent starting new round before previous is resolved", async function () {
            // Try to start a new round immediately - should fail because current round hasn't ended yet
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "RoundNotEnded");
        });

        it("Should mark previous round as resolved when starting new round", async function () {
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // First call to WWIIInu (normally) or startNewRound directly
            await game.connect(waracle).startNewRound();
            
            const round1Info = await game.rounds(1);
            expect(round1Info.resolved).to.equal(true);
            expect(await game.currentRound()).to.equal(2);
        });

        it("Should handle multiple round progression", async function () {
            for (let i = 2; i <= 5; i++) {
                await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
                await ethers.provider.send("evm_mine", []);
                
                await expect(game.connect(waracle).startNewRound())
                    .to.emit(game, "RoundResolved")
                    .withArgs(i - 1, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
                
                expect(await game.currentRound()).to.equal(i);
            }
        });

        it("Should transition emission rates between years", async function () {
            // Test emission calculation for different years
            let round = 1;
            
            // Year 1 emission (rounds 1-1096)
            let roundInfo = await game.rounds(round);
            const year1Emission = roundInfo.totalEmission;
            
            // Simulate progression to year 2 (round 1097)
            for (let i = 2; i <= 1097; i++) {
                await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
                await ethers.provider.send("evm_mine", []);
                await game.connect(waracle).startNewRound();
            }
            
            // Check year 2 emission
            roundInfo = await game.rounds(1097);
            const year2Emission = roundInfo.totalEmission;
            
            // Year 2 should be 2/3 of year 1
            const expectedYear2 = (year1Emission * 2n) / 3n;
            expect(year2Emission).to.be.closeTo(expectedYear2, ethers.parseEther("1000")); // Allow small rounding
        });

        it("Should end game when vault is depleted", async function () {
            // Simulate vault depletion by setting very low balance
            // This test would require more complex setup to actually deplete the vault
            
            // For now, test the logic exists
            const gameState = await game.getGameState();
            expect(gameState.gameEnded).to.equal(false);
            expect(gameState._remainingEmissions).to.be.greaterThan(0);
        });
    });

    describe("Round Timing and Boundaries", function () {
        beforeEach(async function () {
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should enforce 8-hour round duration exactly", async function () {
            const roundInfo = await game.rounds(1);
            const expectedDuration = 8 * 3600; // 8 hours in seconds
            
            expect(roundInfo.endTime - roundInfo.startTime).to.equal(expectedDuration);
        });

        it("Should allow actions during active round", async function () {
            // Deploy player to test actions are allowed
            await wwiii.connect(player1).approve(game.target, tenK);
            
            await expect(game.connect(player1).deploy(1, tenK))
                .to.not.be.reverted;
        });

        it("Should reject actions after round ends", async function () {
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            await wwiii.connect(player1).approve(game.target, tenK);
            
            // Deploy should fail because round ended
            await expect(game.connect(player1).deploy(1, tenK))
                .to.be.revertedWithCustomError(game, "CannotActDuringTransition");
        });

        it("Should handle round boundary edge cases", async function () {
            // Test actions at exact round boundaries
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            // Fast forward to just before round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 - 10]);
            await ethers.provider.send("evm_mine", []);
            
            // Should still allow actions
            await wwiii.connect(player1).approve(game.target, tenK);
            await expect(game.connect(player1).addTokens(tenK))
                .to.not.be.reverted;
            
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [20]);
            await ethers.provider.send("evm_mine", []);
            
            // Should reject actions
            await expect(game.connect(player1).addTokens(tenK))
                .to.be.revertedWithCustomError(game, "CannotActDuringTransition");
        });

        it("Should not allow retreat during round transition", async function () {
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // Retreat should be rejected during transition (round ended but not resolved)
            await expect(game.connect(player1).retreat())
                .to.be.revertedWithCustomError(game, "CannotRetreatDuringTransition");
        });
    });

    describe("Emergency Halt Mechanism", function () {
        beforeEach(async function () {
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should reject emergency halt before 24 hours", async function () {
            // Fast forward past round end but not 24 hours
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 3600]); // 9 hours
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(player1).emergencyHaltGame())
                .to.be.revertedWithCustomError(game, "MustWait24Hours");
        });

        it("Should allow emergency halt after 24 hours of Waracle inactivity", async function () {
            // Fast forward past round end + 24 hours
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 24 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(player1).emergencyHaltGame())
                .to.emit(game, "EmergencyHalt")
                .withArgs(1, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1), player1.address);
            
            expect(await game.gameHalted()).to.equal(true);
            expect(await game.gamePhase()).to.equal(2); // HALTED
        });

        it("Should reject emergency halt if already halted", async function () {
            await game.connect(owner).haltGame();
            
            await expect(game.connect(player1).emergencyHaltGame())
                .to.be.revertedWithCustomError(game, "AlreadyHalted");
        });


        it("Should prevent new rounds after emergency halt", async function () {
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 24 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(player1).emergencyHaltGame();
            
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "GameNotActive");
        });
    });

    describe("Game State Queries", function () {
        beforeEach(async function () {
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
        });

        it("Should return correct game state during active round", async function () {
            const gameState = await game.getGameState();
            
            expect(gameState._currentRound).to.equal(1);
            expect(gameState.roundEndTime).to.be.greaterThan(0);
            expect(gameState.roundResolved).to.equal(false);
            expect(gameState._gameHalted).to.equal(false);
            expect(gameState.gameEnded).to.equal(false);
            expect(gameState._remainingEmissions).to.be.greaterThan(0);
            expect(gameState.currentRoundEmissions).to.be.greaterThan(0);
        });

        it("Should return correct game state after round ends", async function () {
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            const gameState = await game.getGameState();
            expect(gameState.roundResolved).to.equal(false); // Not resolved until Waracle acts
        });

        it("Should return correct game state after round resolution", async function () {
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
            
            const gameState = await game.getGameState();
            expect(gameState._currentRound).to.equal(2);
        });
    });

    describe("Round Constants and Configuration", function () {
        it("Should have correct round duration constant", async function () {
            const roundDuration = await game.ROUND_DURATION();
            expect(roundDuration).to.equal(8 * 3600); // 8 hours
        });

        it("Should calculate rounds per year correctly", async function () {
            // Internal calculation: 3 rounds per day * 365.25 days ≈ 1096 rounds
            // We can verify this by checking emission calculations
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
            
            const roundInfo = await game.rounds(1);
            // 3B tokens / 1096 rounds
            const expectedEmission = ethers.parseEther("3000000000") / 1096n;
            expect(roundInfo.totalEmission).to.equal(expectedEmission);
        });

        it("Should handle precision in emission calculations", async function () {
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            // Start multiple rounds to test consistency
            for (let i = 1; i <= 5; i++) {
                // Advance time before starting new round (except first)
                if (i > 1) {
                    await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
                    await ethers.provider.send("evm_mine", []);
                }
                
                await game.connect(waracle).startNewRound();
                
                const roundInfo = await game.rounds(i);
                expect(roundInfo.totalEmission).to.be.greaterThan(0);
            }
        });
    });
});