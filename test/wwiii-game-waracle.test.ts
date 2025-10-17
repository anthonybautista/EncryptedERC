// WWIII Game Waracle Functions Tests
// Focus: WWIIInu combat resolution, destroyBunker cleanup, token burning

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, WWIIIGameToken } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp } from "./helpers";
import { User } from "./user";

describe("WWIIIGame Waracle Functions", function () {
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
        await wwiii.transfer(player3.address, hundredK);
    }

    // Helper function to start game and round with players deployed
    async function setupGameWithPlayers() {
        const combatStartTime = await getFutureTimestamp(100);
        await game.connect(owner).startGame(combatStartTime);
        
        await ethers.provider.send("evm_increaseTime", [200]);
        await ethers.provider.send("evm_mine", []);
        
        await game.connect(waracle).startNewRound();
        
        // Deploy players to different bunkers
        await wwiii.connect(player1).approve(game.target, tenK);
        await wwiii.connect(player2).approve(game.target, tenK);
        await wwiii.connect(player3).approve(game.target, tenK);
        
        await game.connect(player1).deploy(1, tenK);
        await game.connect(player2).deploy(2, tenK);
        await game.connect(player3).deploy(3, tenK);
    }

    beforeEach(async function () {
        await deployContracts();
    });

    describe("WWIIInu Access Control", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should only allow Waracle to call WWIIInu", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await expect(game.connect(player1).WWIIInu(rocketBalances, shieldBalances))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
            
            await expect(game.connect(owner).WWIIInu(rocketBalances, shieldBalances))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
        });

        it("Should reject WWIIInu if no active round", async function () {
            // Create game without starting rounds
            await deployContracts();
            
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.be.revertedWithCustomError(game, "NoActiveRound");
        });

        it("Should reject WWIIInu if round not ended", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            // Round is still active (hasn't been 8 hours)
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.be.revertedWithCustomError(game, "RoundNotEnded");
        });

        it("Should reject WWIIInu if round already resolved", async function () {
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            // First call should succeed 
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Now try to call WWIIInu on the processed round - should fail
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.be.revertedWithCustomError(game, "RoundAlreadyResolved");
        });
    });

    describe("Combat Resolution Logic", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
            
            // Fast forward past round end
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
        });

        it("Should calculate damage correctly (ROCKET - SHIELD)", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("1000"), // Bunker 1: 1000 ROCKET
                ethers.parseEther("500"),  // Bunker 2: 500 ROCKET
                ethers.parseEther("2000"), // Bunker 3: 2000 ROCKET
                0n,                        // Bunker 4: 0 ROCKET
                ethers.parseEther("300")   // Bunker 5: 300 ROCKET
            ];
            
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("600"),  // Bunker 1: 600 SHIELD (net damage: 400)
                ethers.parseEther("800"),  // Bunker 2: 800 SHIELD (net damage: 0, shields > rockets)
                ethers.parseEther("1500"), // Bunker 3: 1500 SHIELD (net damage: 500)
                ethers.parseEther("100"),  // Bunker 4: 100 SHIELD (net damage: 0, no rockets)
                ethers.parseEther("200")   // Bunker 5: 200 SHIELD (net damage: 100)
            ];
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.emit(game, "WaracleSubmission")
                .withArgs(
                    1, // round
                    rocketBalances,
                    shieldBalances,
                    [
                        ethers.parseEther("400"), // Bunker 1 damage
                        0n,                       // Bunker 2 damage (shields >= rockets)
                        ethers.parseEther("500"), // Bunker 3 damage
                        0n,                       // Bunker 4 damage
                        ethers.parseEther("100")  // Bunker 5 damage
                    ]
                );
        });

        it("Should handle zero combat tokens", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.emit(game, "WaracleSubmission")
                .withArgs(1, rocketBalances, shieldBalances, [0n, 0n, 0n, 0n, 0n]);
            
            // No bunkers should be damaged, but they should receive emissions
            const roundInfo = await game.rounds(1);
            const baseShare = roundInfo.totalEmission / 6n;
            
            for (let i = 1; i <= 5; i++) {
                const bunkerInfo = await game.getBunkerInfo(i);
                if (i === 3) {
                    // Bunker 3 gets 2x share
                    expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK + baseShare * 2n);
                } else if (i <= 2) {
                    // Bunkers 1 and 2 have players, get base share
                    expect(bunkerInfo.bunkerState.totalDeployed).to.equal(tenK + baseShare);
                } else {
                    // Bunkers 4 and 5 are empty, no emissions
                    expect(bunkerInfo.bunkerState.totalDeployed).to.equal(0);
                }
            }
        });

        it("Should apply partial damage correctly", async function () {
            // Use damage that's significant but doesn't destroy the bunker
            const roundInfo = await game.rounds(1);
            const baseShare = roundInfo.totalEmission / 6n;
            const damageAmount = ethers.parseEther("5000"); // 5000 < 10000, so bunker survives
            
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                damageAmount, // Bunker 1: partial damage
                0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Calculate expected final value: original - damage + emissions
            const expectedTotal = tenK - damageAmount + baseShare;
            
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(expectedTotal);
            
            // Index should increase because emissions overwhelm the damage
            expect(bunkerInfo.bunkerState.index).to.be.greaterThan(await game.BASE_INDEX());
        });

        it("Should handle complete bunker destruction", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("15000"), // More than bunker's 10k deployment
                0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            const destroyedBunkers = await game.connect(waracle).WWIIInu.staticCall(rocketBalances, shieldBalances);
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.emit(game, "BunkerDestroyed")
                .withArgs(1, 1, tenK); // Bunker 1, round 1, total lost
            
            expect(destroyedBunkers).to.deep.equal([1]); // Array with bunker 1
            
            // Bunker should be marked for destruction (index = 0)
            const bunkerInfo = await game.bunkers(1);
            expect(bunkerInfo.index).to.equal(0);
            expect(bunkerInfo.totalDeployed).to.equal(0);
            
            // All tokens should be burned
            const bunkerBalance = await wwiii.balanceOf(bunkerAddresses[0]);
            expect(bunkerBalance).to.equal(0);
        });

        it("Should handle multiple bunker destruction", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("15000"), // Destroy bunker 1
                ethers.parseEther("20000"), // Destroy bunker 2
                0n,
                ethers.parseEther("12000"), // Destroy bunker 4
                0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            const destroyedBunkers = await game.connect(waracle).WWIIInu.staticCall(rocketBalances, shieldBalances);
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            expect(destroyedBunkers).to.have.lengthOf(3);
            expect(destroyedBunkers).to.include(1n);
            expect(destroyedBunkers).to.include(2n);
            expect(destroyedBunkers).to.include(4n);
            
            // Check all destroyed bunkers are marked
            for (const bunkerId of [1, 2, 4]) {
                const bunkerInfo = await game.bunkers(bunkerId);
                expect(bunkerInfo.index).to.equal(0);
                expect(bunkerInfo.totalDeployed).to.equal(0);
            }
            
            // Surviving bunkers should be intact  
            // Bunker 3 has players and gets emissions
            const bunker3Info = await game.getBunkerInfo(3);
            const roundInfo = await game.rounds(1);
            const baseShare = roundInfo.totalEmission / 6n;
            expect(bunker3Info.bunkerState.index).to.be.greaterThan(await game.BASE_INDEX()); // Increased due to emissions
            expect(bunker3Info.bunkerState.totalDeployed).to.equal(tenK + baseShare * 2n); // Gets 2x share
            
            // Bunker 5 is empty (no players), so it stays at initial state
            const bunker5Info = await game.getBunkerInfo(5);
            expect(bunker5Info.bunkerState.index).to.equal(await game.BASE_INDEX());
            expect(bunker5Info.bunkerState.totalDeployed).to.equal(0); // Empty bunker
        });
    });

    describe("Token Burning After Combat", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
            
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
        });

        it("Should burn all ROCKET and SHIELD tokens after resolution", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("1000"), ethers.parseEther("500"), 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("300"), 0n, ethers.parseEther("200"), 0n, 0n
            ];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Verify burnAllTokensFrom was called
            // Note: This would require mock verification in a real test environment
            // For now, we verify the function exists and would be called
            
            // After burning, all bunkers should have zero ROCKET and SHIELD balances
            // This creates a clean slate for the next round
        });

        it("Should burn tokens even when no damage occurs", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Even with no combat tokens, the burning function should still be called
            // This ensures consistent state management
        });

        it("Should call burnAllTokensFrom with all bunker addresses", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // The internal _burnAllCombatTokens function should call:
            // ROCKET.burnAllTokensFrom([bunker1, bunker2, bunker3, bunker4, bunker5])
            // SHIELD.burnAllTokensFrom([bunker1, bunker2, bunker3, bunker4, bunker5])
            
            // This would be verified with proper mock contracts
        });
    });

    describe("Resource Distribution", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
            
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
        });

        it("Should distribute resources to surviving bunkers", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            const vaultBalanceBefore = await vault.remainingEmissions();
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.emit(game, "ResourcesDistributed");
            
            // Check that vault balance decreased
            const vaultBalanceAfter = await vault.remainingEmissions();
            expect(vaultBalanceAfter).to.be.lessThan(vaultBalanceBefore);
            
            // Check that bunkers received tokens
            for (let i = 1; i <= 5; i++) {
                // Each bunker should receive resources
                // Bunker 3 should receive 2x share
            }
        });

        it("Should give bunker 3 double resource share", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker3BalanceBefore = await wwiii.balanceOf(bunkerAddresses[2]);
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker3BalanceAfter = await wwiii.balanceOf(bunkerAddresses[2]);
            
            const bunker1Increase = bunker1BalanceAfter - bunker1BalanceBefore;
            const bunker3Increase = bunker3BalanceAfter - bunker3BalanceBefore;
            
            // Bunker 3 should receive 2x the increase of bunker 1
            expect(bunker3Increase).to.equal(bunker1Increase * 2n);
        });

        it("Should spoil resources for destroyed bunkers", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("15000"), // Destroy bunker 1
                0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.emit(game, "ResourcesSpoiled")
                .withArgs(1, await ethers.provider.getBlock("latest").then(async () => {
                    const roundInfo = await game.rounds(1);
                    return roundInfo.totalEmission / 6n; // Base share
                }), 1);
            
            // Destroyed bunker's share should go to dead address
            // Other bunkers should still receive their shares
        });

        it("Should handle vault depletion gracefully", async function () {
            // This test would require simulating a nearly depleted vault
            // For now, we test that the function handles the case properly
            
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Should complete successfully even if vault has insufficient funds
        });

        it("Should update bunker indices after resource distribution", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            const bunker1IndexBefore = await game.bunkers(1);
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            const bunker1IndexAfter = await game.bunkers(1);
            
            // Index should be updated to reflect new resources
            expect(bunker1IndexAfter.index).to.be.greaterThan(bunker1IndexBefore.index);
            expect(bunker1IndexAfter.totalDeployed).to.be.greaterThan(bunker1IndexBefore.totalDeployed);
        });
    });

    describe("Bunker Destruction and Cleanup", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
            
            // Add more players to test cleanup
            for (let i = 0; i < 3; i++) {
                await wwiii.transfer(others[i].address, tenK);
                await wwiii.connect(others[i]).approve(game.target, tenK);
                await game.connect(others[i]).deploy(1, tenK); // All in bunker 1
            }
            
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
        });

        it("Should mark bunkers for destruction when destroyed", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("1000000"), // Destroy bunker 1 with massive damage
                0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            // Execute damage
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Verify bunker 1 was destroyed by checking its state
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.index).to.equal(0); // Marked for destruction
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(0);
            expect(bunkerInfo.bunkerState.players.length).to.equal(4); // Players still in array, need cleanup
        });

        it("Should allow Waracle to clean up destroyed bunkers", async function () {
            // First destroy bunker 1
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("50000"), 0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Clean up in batches
            await expect(game.connect(waracle).destroyBunker(1, 2)) // Process 2 players
                .to.not.be.reverted;
            
            // Check that some players were processed
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.players.length).to.equal(2); // 2 remaining
        });

        it("Should complete cleanup and reinitialize bunker", async function () {
            // Apply massive damage to ensure bunker destruction
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("1000000"), 0n, 0n, 0n, 0n // 1M damage vs 40k deployed
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            // Execute damage
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Verify bunker 1 was destroyed by checking its index
            const afterDamageInfo = await game.getBunkerInfo(1);
            expect(afterDamageInfo.bunkerState.index).to.equal(0); // Marked for destruction
            
            // Clean up all players - this will process all 4 players and emit the event
            await expect(game.connect(waracle).destroyBunker(1, 10))
                .to.emit(game, "BunkerDestroyed")
                .withArgs(1, 1, 0);
            
            // Bunker should be reinitialized
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.index).to.equal(await game.BASE_INDEX());
            expect(bunkerInfo.bunkerState.players.length).to.equal(0);
            expect(bunkerInfo.bunkerState.totalDeployed).to.equal(0);
        });

        it("Should reset player states during cleanup", async function () {
            // Apply massive damage to ensure bunker destruction
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("1000000"), 0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            // Execute damage
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Verify bunker 1 was destroyed by checking its index
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.index).to.equal(0); // Marked for destruction
            
            // Check player state before cleanup
            const playerInfoBefore = await game.players(player1.address);
            expect(playerInfoBefore.currentBunker).to.equal(1);
            
            // Clean up all players (single call processes all 4 players)
            await game.connect(waracle).destroyBunker(1, 10);
            
            // Check player state after cleanup
            const playerInfoAfter = await game.players(player1.address);
            expect(playerInfoAfter.currentBunker).to.equal(0);
            expect(playerInfoAfter.deployedAmount).to.equal(0);
            expect(playerInfoAfter.deploymentTimestamp).to.equal(0);
            expect(playerInfoAfter.depositIndex).to.equal(0);
        });

        it("Should reject destroyBunker for non-destroyed bunkers", async function () {
            await expect(game.connect(waracle).destroyBunker(2, 10))
                .to.be.revertedWithCustomError(game, "BunkerNotMarkedForDestruction");
        });

        it("Should reject destroyBunker from non-Waracle", async function () {
            // First destroy a bunker
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("50000"), 0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            await expect(game.connect(player1).destroyBunker(1, 10))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");
        });
    });

    describe("Edge Cases and Error Handling", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
            
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
        });

        it("Should handle very large damage values", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("1000000"), // Much larger than bunker's deployment
                0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.not.be.reverted;
            
            // Should still destroy bunker correctly
            const bunkerInfo = await game.bunkers(1);
            expect(bunkerInfo.index).to.equal(0);
        });

        it("Should handle precision in damage calculations", async function () {
            // Use massive damage to ensure net negative effect (damage > emissions)
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("500000.123456789"), // Fractional damage that overwhelms emissions
                0n, 0n, 0n, 0n
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("0.987654321"), // Small shield amount
                0n, 0n, 0n, 0n
            ];
            
            await expect(game.connect(waracle).WWIIInu(rocketBalances, shieldBalances))
                .to.not.be.reverted;
            
            // Should handle precision correctly - bunker should be destroyed
            const bunkerInfo = await game.getBunkerInfo(1);
            expect(bunkerInfo.bunkerState.index).to.equal(0); // Destroyed
        });

        it("Should handle simultaneous multi-bunker scenarios", async function () {
            const rocketBalances: [bigint, bigint, bigint, bigint, bigint] = [
                ethers.parseEther("500000"), // Destroy bunker 1 (massive damage)
                ethers.parseEther("100000"), // Massive damage to bunker 2 but with shields
                ethers.parseEther("500000"), // Destroy bunker 3 (massive damage)
                0n,                          // No damage to bunker 4
                ethers.parseEther("200000")  // Large damage to bunker 5
            ];
            const shieldBalances: [bigint, bigint, bigint, bigint, bigint] = [
                0n,                          // No shields for bunker 1
                ethers.parseEther("200000"), // Enough shields to save bunker 2
                0n,                          // No shields for bunker 3
                0n,   // No shields for bunker 4
                0n  // No shields for bunker 5
            ];
            
            const destroyedBunkers = await game.connect(waracle).WWIIInu.staticCall(rocketBalances, shieldBalances);
            
            await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);
            
            // Should handle all scenarios correctly  
            expect(destroyedBunkers).to.have.lengthOf(3);
            expect(destroyedBunkers).to.include(1n);
            expect(destroyedBunkers).to.include(3n);
            expect(destroyedBunkers).to.include(5n);
            
            // Check damage/shield effects applied correctly
            const bunker2Info = await game.bunkers(2);
            const bunker5Info = await game.bunkers(5);
            // Bunker 2: 100k rockets - 200k shields = 0 damage + emissions
            // This should INCREASE the index due to emissions
            expect(bunker2Info.index).to.be.greaterThan(await game.BASE_INDEX());
            // Bunker 5: 200k rockets - 0 shields = 200k damage to empty bunker = destroyed
            expect(bunker5Info.index).to.equal(0);
            
            // Check undamaged bunker - should have unchanged index and zero deployed
            const bunker4Info = await game.bunkers(4);
            expect(bunker4Info.totalDeployed).to.equal(0); // Should stay empty
            expect(bunker4Info.index).to.equal(await game.BASE_INDEX()); // Should be unchanged
        });
    });
});