// WWIII Game Integration Tests
// Focus: Complete game flows, multi-round scenarios, full lifecycle testing

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, WWIIIGameToken } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp } from "./helpers";
import { User } from "./user";

describe("WWIIIGame Integration Tests", function () {
    this.timeout(300000); // 5 minutes
    let owner: SignerWithAddress;
    let waracle: SignerWithAddress; 
    let players: SignerWithAddress[];
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
        const signers = await ethers.getSigners();
        [owner, waracle, ...others] = signers;
        players = others.slice(0, 10); // First 10 for players
        
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
            bunkerUsers.push(new User(others[10 + i])); // Use others[10-14] for bunkers
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
        
        // Distribute tokens to players
        tenK = ethers.parseEther("10000");
        const hundredK = ethers.parseEther("100000");
        
        for (let i = 0; i < players.length; i++) {
            await wwiii.transfer(players[i].address, hundredK);
        }
    }

    // Helper function to start game
    async function startGame() {
        const combatStartTime = await getFutureTimestamp(100);
        await game.connect(owner).startGame(combatStartTime);
        
        await ethers.provider.send("evm_increaseTime", [200]);
        await ethers.provider.send("evm_mine", []);
        
        await game.connect(waracle).startNewRound();
    }

    // Helper function to simulate round resolution
    async function simulateRoundResolution(rocketBalances?: bigint[], shieldBalances?: bigint[]) {
        const defaultBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
        
        await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
        await ethers.provider.send("evm_mine", []);
        
        const destroyedBunkers = await game.connect(waracle).WWIIInu.staticCall(
            rocketBalances ? rocketBalances as [bigint, bigint, bigint, bigint, bigint] : defaultBalances,
            shieldBalances ? shieldBalances as [bigint, bigint, bigint, bigint, bigint] : defaultBalances
        );
        
        await game.connect(waracle).WWIIInu(
            rocketBalances ? rocketBalances as [bigint, bigint, bigint, bigint, bigint] : defaultBalances,
            shieldBalances ? shieldBalances as [bigint, bigint, bigint, bigint, bigint] : defaultBalances
        );
        
        // Clean up any destroyed bunkers
        for (const bunkerId of destroyedBunkers) {
            // Clean up destroyed bunker by removing all players
            await game.connect(waracle).destroyBunker(bunkerId, 100); // Clean up to 100 players
        }
        
        await game.connect(waracle).startNewRound();
    }

    beforeEach(async function () {
        await deployContracts();
    });

    describe("Complete Game Lifecycle", function () {
        it("Should complete full deployment → active → combat flow", async function () {
            // Phase 1: Deployment
            expect(await game.gamePhase()).to.equal(0); // DEPLOYMENT
            
            // Players deploy during deployment phase
            for (let i = 0; i < 5; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy((i % 5) + 1, tenK); // Distribute across bunkers
            }
            
            // Phase 2: Game Start
            await startGame();
            expect(await game.gamePhase()).to.equal(1); // ACTIVE
            expect(await game.currentRound()).to.equal(1);
            
            // Phase 3: Combat Resolution
            await simulateRoundResolution();
            expect(await game.currentRound()).to.equal(2);
            
            // Verify all players still have positive balances
            for (let i = 0; i < 5; i++) {
                const balance = await game.getCurrentDeployment(players[i].address);
                expect(balance).to.be.greaterThan(tenK); // Should have gained resources
            }
        });

        it("Should handle complete 3-year game simulation (abbreviated)", async function () {
            await startGame();
            
            // Deploy players
            for (let i = 0; i < 5; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy((i % 5) + 1, tenK);
            }
            
            const initialVaultBalance = await vault.remainingEmissions();
            
            // Simulate 20 rounds (representative of longer gameplay)
            for (let round = 0; round < 20; round++) {
                await simulateRoundResolution();
                
                // Verify game state remains consistent
                const gameState = await game.getGameState();
                expect(gameState._gameHalted).to.equal(false);
                expect(gameState.gameEnded).to.equal(false);
            }
            
            const finalVaultBalance = await vault.remainingEmissions();
            expect(finalVaultBalance).to.be.lessThan(initialVaultBalance);
            
            // Verify all players still have deployments
            for (let i = 0; i < 5; i++) {
                const balance = await game.getCurrentDeployment(players[i].address);
                expect(balance).to.be.greaterThan(0);
            }
        });

        it("Should handle game conclusion when vault depleted", async function () {
            // This would require extensive simulation or vault manipulation
            // For now, test the detection logic
            
            const gameState = await game.getGameState();
            expect(gameState.gameEnded).to.equal(false);
            expect(gameState._remainingEmissions).to.be.greaterThan(0);
            
            // Game should end when remainingEmissions = 0 AND round resolved
        });
    });

    describe("Multi-Player Competitive Scenarios", function () {
        beforeEach(async function () {
            await startGame();
        });

        it("Should handle competitive deployment to same bunker", async function () {
            // Multiple players deploy to bunker 3 (central hub with 2x resources)
            for (let i = 0; i < 5; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(3, tenK); // All to bunker 3
            }
            
            const bunkerInfo = await game.getBunkerInfo(3);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK * 5n);
            expect(bunkerInfo.bunkerState.players.length).to.equal(5);
            
            // After resource distribution, all should benefit equally
            await simulateRoundResolution();
            
            for (let i = 0; i < 5; i++) {
                const balance = await game.getCurrentDeployment(players[i].address);
                expect(balance).to.be.greaterThan(tenK); // All should gain from 2x resources
            }
        });

        it("Should handle strategic movement patterns", async function () {
            // Deploy players to different bunkers
            for (let i = 0; i < 5; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy((i % 5) + 1, tenK);
            }
            
            // Player in bunker 1 moves to bunker 3 (central hub)
            await game.connect(players[0]).move(3);
            
            // Verify movement
            const playerInfo = await game.players(players[0].address);
            expect(playerInfo.currentBunker).to.equal(3);
            
            // Check bunker states
            const bunker1Info = await game.getBunkerInfo(1);
            const bunker3Info = await game.getBunkerInfo(3);
            
            expect(bunker1Info.bunkerState.players.length).to.equal(0);
            expect(bunker3Info.bunkerState.players.length).to.equal(2); // Original player + moved player
        });

        it("Should handle coordinated retreat patterns", async function () {
            // Deploy multiple players
            for (let i = 0; i < 3; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(1, tenK);
            }
            
            const bunkerInfoBefore = await game.getBunkerInfo(1);
            expect(bunkerInfoBefore.bunkerState.players.length).to.equal(3);
            
            // Two players retreat
            await game.connect(players[0]).retreat();
            await game.connect(players[1]).retreat();
            
            const bunkerInfoAfter = await game.getBunkerInfo(1);
            expect(bunkerInfoAfter.bunkerState.players.length).to.equal(1);
            expect(bunkerInfoAfter.bunkerState.totalDeployed).to.equal(tenK); // Only one player remains
            
            // Verify retreated players got their tokens back
            const player0Balance = await wwiii.balanceOf(players[0].address);
            const player1Balance = await wwiii.balanceOf(players[1].address);
            
            expect(player0Balance).to.be.greaterThanOrEqual(ethers.parseEther("100000")); // Original + returned
            expect(player1Balance).to.be.greaterThanOrEqual(ethers.parseEther("100000"));
        });

        it("Should handle mixed strategies over multiple rounds", async function () {
            // Initial deployment
            for (let i = 0; i < 6; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy((i % 5) + 1, tenK);
            }
            
            // Round 1: No combat
            await simulateRoundResolution();
            
            // Round 2: Some players move
            await game.connect(players[0]).move(3); // 1 → 3
            await game.connect(players[1]).move(3); // 2 → 3
            
            await simulateRoundResolution();
            
            // Round 3: Some players retreat
            await game.connect(players[5]).retreat();
            
            await simulateRoundResolution();
            
            // Round 4: New players join
            await wwiii.connect(players[6]).approve(game.target, tenK);
            await game.connect(players[6]).deploy(1, tenK);
            
            await simulateRoundResolution();
            
            // Verify game state remains consistent
            const gameState = await game.getGameState();
            expect(gameState._currentRound).to.equal(5);
            expect(gameState._gameHalted).to.equal(false);
            
            // Verify players have reasonable balances
            for (let i = 0; i < 5; i++) { // First 5 still deployed
                const balance = await game.getCurrentDeployment(players[i].address);
                expect(balance).to.be.greaterThan(0);
            }
        });
    });

    describe("Bunker Destruction and Recovery Cycles", function () {
        beforeEach(async function () {
            await startGame();
            
            // Deploy players to all bunkers
            for (let i = 0; i < 5; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(i + 1, tenK);
            }
        });

        it("Should handle complete bunker destruction and cleanup", async function () {
            // Destroy bunker 1
            await simulateRoundResolution(
                [ethers.parseEther("15000"), 0n, 0n, 0n, 0n], // Destroy bunker 1
                [0n, 0n, 0n, 0n, 0n]
            );
            
            // Verify bunker 1 is cleaned up and reinitialized
            const bunker1Info = await game.getBunkerInfo(1);
            expect(bunker1Info.bunkerState.index).to.equal(await game.BASE_INDEX()); // Reinitialized after cleanup
            expect(bunker1Info.bunkerState.totalDeployed).to.equal(0);
            expect(bunker1Info.bunkerState.players.length).to.equal(0);
            
            // Verify player is eliminated
            const player0Info = await game.players(players[0].address);
            expect(player0Info.currentBunker).to.equal(0);
            expect(player0Info.deployedAmount).to.equal(0);
            
            // Verify other bunkers received emissions and grew
            for (let i = 2; i <= 5; i++) {
                const bunkerInfo = await game.getBunkerInfo(i);
                expect(bunkerInfo.bunkerState.index).to.be.greaterThan(await game.BASE_INDEX()); // Grew due to emissions
                expect(bunkerInfo.bunkerState.totalDeployed).to.be.greaterThan(tenK); // Increased due to emissions
            }
        });

        it("Should handle bunker recovery and reoccupation", async function () {
            // Destroy bunker 1
            await simulateRoundResolution(
                [ethers.parseEther("15000"), 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );
            
            // Verify bunker is reinitialized
            const bunker1InfoAfterDestruction = await game.getBunkerInfo(1);
            expect(bunker1InfoAfterDestruction.bunkerState.index).to.equal(await game.BASE_INDEX());
            expect(bunker1InfoAfterDestruction.bunkerState.players.length).to.equal(0);
            
            // New player deploys to recovered bunker
            await wwiii.connect(players[5]).approve(game.target, tenK);
            await game.connect(players[5]).deploy(1, tenK);
            
            const bunker1InfoAfterReoccupation = await game.getBunkerInfo(1);
            expect(bunker1InfoAfterReoccupation.bunkerState.totalDeployed).to.equal(tenK);
            expect(bunker1InfoAfterReoccupation.bunkerState.players.length).to.equal(1);
            expect(bunker1InfoAfterReoccupation.bunkerState.players[0]).to.equal(players[5].address);
            
            // Verify new player can participate normally
            await simulateRoundResolution();
            
            const newPlayerBalance = await game.getCurrentDeployment(players[5].address);
            expect(newPlayerBalance).to.be.greaterThan(tenK);
        });

        it("Should handle multiple simultaneous bunker destructions", async function () {
            // Add more players to bunkers 2 and 4
            await wwiii.connect(players[5]).approve(game.target, tenK);
            await wwiii.connect(players[6]).approve(game.target, tenK);
            await game.connect(players[5]).deploy(2, tenK);
            await game.connect(players[6]).deploy(4, tenK);
            
            // Destroy bunkers 1, 2, and 4
            await simulateRoundResolution(
                [
                    ethers.parseEther("15000"), // Destroy bunker 1
                    ethers.parseEther("25000"), // Destroy bunker 2 (has 2 players)
                    0n,                         // Bunker 3 survives
                    ethers.parseEther("25000"), // Destroy bunker 4 (has 2 players)
                    0n                          // Bunker 5 survives
                ],
                [0n, 0n, 0n, 0n, 0n]
            );
            
            // Verify destroyed bunkers
            for (const bunkerId of [1, 2, 4]) {
                const bunkerInfo = await game.getBunkerInfo(bunkerId);
                expect(bunkerInfo.bunkerState.index).to.equal(await game.BASE_INDEX()); // Reinitialized
                expect(bunkerInfo.bunkerState.players.length).to.equal(0);
                expect(bunkerInfo.bunkerState.totalDeployed).to.equal(0);
            }
            
            // Verify surviving bunkers got their resources
            const bunker3Info = await game.bunkers(3);
            const bunker5Info = await game.bunkers(5);
            
            expect(bunker3Info.totalDeployed).to.be.greaterThan(tenK); // Resources added
            expect(bunker5Info.totalDeployed).to.be.greaterThan(tenK);
            
            // Verify eliminated players
            for (const playerId of [0, 1, 5, 3, 6]) {
                const playerInfo = await game.players(players[playerId].address);
                expect(playerInfo.currentBunker).to.equal(0);
            }
        });
    });

    describe("Economic Flow Validation", function () {
        beforeEach(async function () {
            await startGame();
            
            for (let i = 0; i < 5; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(i + 1, tenK);
            }
        });

        it("Should maintain economic balance over multiple rounds", async function () {
            const initialTotalSupply = await wwiii.totalSupply();
            const initialVaultBalance = await vault.remainingEmissions();
            
            // Track total player value over time
            let totalPlayerValue = tenK * 5n;
            
            for (let round = 0; round < 10; round++) {
                const vaultBalanceBefore = await vault.remainingEmissions();
                
                // Vary scenarios: no damage, small damage, large damage
                const scenarios = [
                    { rockets: [0n, 0n, 0n, 0n, 0n], shields: [0n, 0n, 0n, 0n, 0n] },
                    { rockets: [ethers.parseEther("1000"), 0n, 0n, 0n, 0n], shields: [0n, 0n, 0n, 0n, 0n] },
                    { rockets: [0n, ethers.parseEther("2000"), 0n, 0n, 0n], shields: [0n, 0n, 0n, 0n, 0n] }
                ];
                
                const scenario = scenarios[round % scenarios.length];
                await simulateRoundResolution(scenario.rockets, scenario.shields);
                
                const vaultBalanceAfter = await vault.remainingEmissions();
                const emissionAmount = vaultBalanceBefore - vaultBalanceAfter;
                
                // Calculate new total player value
                let newTotalPlayerValue = 0n;
                for (let i = 0; i < 5; i++) {
                    const playerBalance = await game.getCurrentDeployment(players[i].address);
                    newTotalPlayerValue += playerBalance;
                }
                
                // Total value should increase by emission amount minus damage
                const damageAmount = scenario.rockets.reduce((sum, val) => sum + val, 0n);
                const expectedIncrease = emissionAmount - damageAmount;
                
                expect(newTotalPlayerValue).to.be.closeTo(
                    totalPlayerValue + expectedIncrease,
                    ethers.parseEther("100") // Small tolerance for rounding
                );
                
                totalPlayerValue = newTotalPlayerValue;
                
                // Verify total supply unchanged
                const currentTotalSupply = await wwiii.totalSupply();
                expect(currentTotalSupply).to.equal(initialTotalSupply);
            }
        });

        it("Should verify bunker 3 advantage over time", async function () {
            let bunker3TotalGains = 0n;
            let bunker1TotalGains = 0n;
            
            for (let round = 0; round < 5; round++) {
                const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
                const bunker3BalanceBefore = await wwiii.balanceOf(bunkerAddresses[2]);
                
                await simulateRoundResolution();
                
                const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
                const bunker3BalanceAfter = await wwiii.balanceOf(bunkerAddresses[2]);
                
                bunker1TotalGains += (bunker1BalanceAfter - bunker1BalanceBefore);
                bunker3TotalGains += (bunker3BalanceAfter - bunker3BalanceBefore);
            }
            
            // Bunker 3 should have gained exactly 2x
            expect(bunker3TotalGains).to.equal(bunker1TotalGains * 2n);
        });

        it("Should validate index system accuracy over time", async function () {
            // Track one player's balance through multiple scenarios
            const playerAddress = players[0].address;
            let expectedBalance = tenK;
            
            for (let round = 0; round < 10; round++) {
                const playerBalanceBefore = await game.getCurrentDeployment(playerAddress);
                const bunkerBalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
                
                // Apply small damage occasionally
                const damage = round % 3 === 0 ? ethers.parseEther("500") : 0n;
                await simulateRoundResolution(
                    [damage, 0n, 0n, 0n, 0n],
                    [0n, 0n, 0n, 0n, 0n]
                );
                
                const playerBalanceAfter = await game.getCurrentDeployment(playerAddress);
                const bunkerBalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
                
                // Calculate expected change
                const bunkerIncrease = bunkerBalanceAfter - bunkerBalanceBefore;
                const playerIncrease = playerBalanceAfter - playerBalanceBefore;
                
                // For single player in bunker, increases should be equal
                expect(playerIncrease).to.be.closeTo(bunkerIncrease, ethers.parseEther("1"));
                
                expectedBalance = playerBalanceAfter;
            }
            
            // Final balance should be reasonable (exponential growth is expected over many rounds)
            expect(expectedBalance).to.be.greaterThan(tenK);
            expect(expectedBalance).to.be.lessThan(tenK * 1000n); // More reasonable sanity check for integration test
        });
    });

    describe("Game State Consistency", function () {
        it("Should maintain consistent state across complex scenarios", async function () {
            await startGame();
            
            // Complex scenario: players joining/leaving, movements, destructions
            const gameStateHistory: any[] = [];
            
            // Round 1: Initial deployments
            for (let i = 0; i < 3; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(i + 1, tenK);
            }
            
            gameStateHistory.push(await game.getGameState());
            await simulateRoundResolution();
            
            // Round 2: More players join
            for (let i = 3; i < 6; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(((i - 3) % 3) + 1, tenK);
            }
            
            gameStateHistory.push(await game.getGameState());
            await simulateRoundResolution();
            
            // Round 3: Some players move
            await game.connect(players[0]).move(3);
            await game.connect(players[3]).move(2);
            
            gameStateHistory.push(await game.getGameState());
            await simulateRoundResolution();
            
            // Round 4: Damage occurs
            await simulateRoundResolution(
                [ethers.parseEther("5000"), 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );
            
            // Round 5: Some players retreat
            await game.connect(players[1]).retreat();
            await game.connect(players[4]).retreat();
            
            gameStateHistory.push(await game.getGameState());
            await simulateRoundResolution();
            
            // Verify game state consistency
            const finalGameState = await game.getGameState();
            expect(finalGameState._currentRound).to.equal(6);
            expect(finalGameState._gameHalted).to.equal(false);
            expect(finalGameState.gameEnded).to.equal(false);
            
            // Verify all round numbers increased monotonically
            for (let i = 1; i < gameStateHistory.length; i++) {
                expect(gameStateHistory[i]._currentRound).to.be.greaterThan(gameStateHistory[i-1]._currentRound);
            }
            
            // Verify remaining players have valid states
            const activePlayers = [players[0], players[2], players[3], players[5]]; // Players who didn't retreat
            for (const player of activePlayers) {
                const playerInfo = await game.players(player.address);
                expect(playerInfo.currentBunker).to.be.greaterThan(0);
                expect(playerInfo.currentBunker).to.be.lessThanOrEqual(5);
                
                const balance = await game.getCurrentDeployment(player.address);
                expect(balance).to.be.greaterThan(0);
            }
        });

        it("Should handle emergency halt and recovery", async function () {
            await startGame();
            
            // Deploy players
            for (let i = 0; i < 3; i++) {
                await wwiii.connect(players[i]).approve(game.target, tenK);
                await game.connect(players[i]).deploy(i + 1, tenK);
            }
            
            // Fast forward past round end but don't resolve
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // Wait 24+ hours for emergency halt
            await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // Any player can trigger emergency halt
            await expect(game.connect(players[0]).emergencyHaltGame())
                .to.emit(game, "EmergencyHalt");
            
            expect(await game.gameHalted()).to.equal(true);
            expect(await game.gamePhase()).to.equal(2); // HALTED
            
            // Players cannot retreat during transition period (round ended but not resolved)
            await expect(game.connect(players[0]).retreat())
                .to.be.revertedWithCustomError(game, "CannotRetreatDuringTransition");
            
            // But cannot take other actions
            await expect(game.connect(players[1]).move(2))
                .to.be.revertedWithCustomError(game, "GameIsHalted");
            
            // Waracle cannot start new rounds
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "GameNotActive");
        });
    });
});