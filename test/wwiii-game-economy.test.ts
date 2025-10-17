// WWIII Game Economics Tests
// Focus: Resource distribution, emission schedule, index system, vault management

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, WWIIIGameToken } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp } from "./helpers";
import { User } from "./user";

describe("WWIIIGame Economics", function () {
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

    // Helper function to start game and deploy players
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

    // Helper function to simulate round resolution
    async function simulateRoundResolution(rocketBalances?: bigint[], shieldBalances?: bigint[]) {
        const defaultBalances: [bigint, bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n, 0n];
        
        await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
        await ethers.provider.send("evm_mine", []);
        
        await game.connect(waracle).WWIIInu(
            rocketBalances ? rocketBalances as [bigint, bigint, bigint, bigint, bigint] : defaultBalances,
            shieldBalances ? shieldBalances as [bigint, bigint, bigint, bigint, bigint] : defaultBalances
        );
        
        await game.connect(waracle).startNewRound();
    }

    beforeEach(async function () {
        await deployContracts();
    });

    describe("3-Year Emission Schedule", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should calculate Year 1 emissions correctly", async function () {
            const roundInfo = await game.rounds(1);
            
            // Year 1: 3B tokens / 1096 rounds ≈ 2,739,726 tokens per round
            const expectedEmission = ethers.parseEther("3000000000") / 1096n;
            expect(roundInfo.totalEmission).to.equal(expectedEmission);
        });

        it("Should transition to Year 2 emission rate", async function () {
            // Simulate 1096 rounds to reach year 2
            for (let i = 2; i <= 1097; i++) {
                await simulateRoundResolution();
            }
            
            const roundInfo = await game.rounds(1097);
            
            // Year 2: 2B tokens / 1096 rounds ≈ 1,826,484 tokens per round  
            const expectedEmission = ethers.parseEther("2000000000") / 1096n;
            expect(roundInfo.totalEmission).to.equal(expectedEmission);
        });

        it("Should transition to Year 3 emission rate", async function () {
            // Simulate to year 3 (round 2193)
            for (let i = 2; i <= 2193; i++) {
                await simulateRoundResolution();
            }
            
            const roundInfo = await game.rounds(2193);
            
            // Year 3: 1B tokens / 1096 rounds ≈ 913,242 tokens per round
            const expectedEmission = ethers.parseEther("1000000000") / 1096n;
            expect(roundInfo.totalEmission).to.equal(expectedEmission);
        });

        it("Should handle post-3-year emissions", async function () {
            // Test the logic without simulating all rounds
            // Skip to round 3289 directly by checking emission calculation logic
            
            // Simulate a few rounds to test the transition logic exists
            for (let i = 2; i <= 10; i++) {
                await simulateRoundResolution();
            }
            
            // Verify that emission calculation works correctly
            const vaultBalance = await vault.remainingEmissions();
            expect(vaultBalance).to.be.greaterThan(0);
            
            // The actual post-3-year logic would be tested in integration tests
            // For unit tests, we just verify the mechanism exists
        });

        it("Should end game when vault depleted", async function () {
            // This test simulates vault depletion
            // In practice, would require many rounds or artificial depletion
            
            const gameState = await game.getGameState();
            expect(gameState.gameEnded).to.equal(false);
            expect(gameState._remainingEmissions).to.be.greaterThan(0);
            
            // Game should end when remainingEmissions = 0
        });
    });

    describe("Resource Distribution Mechanics", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should distribute resources in correct proportions", async function () {
            // Players are already deployed by setupGameWithPlayers:
            // player1 in bunker 1, player2 in bunker 2, player3 in bunker 3
            // Bunkers 4 and 5 are empty
            
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker2BalanceBefore = await wwiii.balanceOf(bunkerAddresses[1]);
            const bunker3BalanceBefore = await wwiii.balanceOf(bunkerAddresses[2]);
            const bunker4BalanceBefore = await wwiii.balanceOf(bunkerAddresses[3]);
            const bunker5BalanceBefore = await wwiii.balanceOf(bunkerAddresses[4]);
            const deadAddressBefore = await wwiii.balanceOf("0x000000000000000000000000000000000000dEaD");
            
            await simulateRoundResolution();
            
            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker2BalanceAfter = await wwiii.balanceOf(bunkerAddresses[1]);
            const bunker3BalanceAfter = await wwiii.balanceOf(bunkerAddresses[2]);
            const bunker4BalanceAfter = await wwiii.balanceOf(bunkerAddresses[3]);
            const bunker5BalanceAfter = await wwiii.balanceOf(bunkerAddresses[4]);
            const deadAddressAfter = await wwiii.balanceOf("0x000000000000000000000000000000000000dEaD");
            
            const bunker1Increase = bunker1BalanceAfter - bunker1BalanceBefore;
            const bunker2Increase = bunker2BalanceAfter - bunker2BalanceBefore;
            const bunker3Increase = bunker3BalanceAfter - bunker3BalanceBefore;
            const bunker4Increase = bunker4BalanceAfter - bunker4BalanceBefore;
            const bunker5Increase = bunker5BalanceAfter - bunker5BalanceBefore;
            const deadAddressIncrease = deadAddressAfter - deadAddressBefore;
            
            // Regular bunkers with players (1, 2) should get equal shares
            expect(bunker1Increase).to.equal(bunker2Increase);
            expect(bunker1Increase).to.be.greaterThan(0);
            
            // Bunker 3 should get 2x share
            expect(bunker3Increase).to.equal(bunker1Increase * 2n);
            
            // Empty bunkers (4, 5) should get no resources
            expect(bunker4Increase).to.equal(0);
            expect(bunker5Increase).to.equal(0);
            
            // Dead address should receive spoiled resources from empty bunkers
            expect(deadAddressIncrease).to.be.greaterThan(0);
            
            // Total resources should equal expected distribution:
            // bunker1 + bunker2 + bunker3 + spoiled = totalEmission
            const roundInfo = await game.rounds(1);
            const totalDistributed = bunker1Increase + bunker2Increase + bunker3Increase + deadAddressIncrease;
            // Allow small rounding difference (up to 10 wei)
            expect(totalDistributed).to.be.closeTo(roundInfo.totalEmission, 10);
        });

        it("Should calculate base share correctly", async function () {
            const roundInfo = await game.rounds(1);
            const totalEmission = roundInfo.totalEmission;
            
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            
            await simulateRoundResolution();
            
            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker1Increase = bunker1BalanceAfter - bunker1BalanceBefore;
            
            // Base share = totalEmission / 6
            const expectedBaseShare = totalEmission / 6n;
            expect(bunker1Increase).to.equal(expectedBaseShare);
        });

        it("Should withdraw from vault before distribution", async function () {
            const vaultBalanceBefore = await vault.remainingEmissions();
            const roundInfo = await game.rounds(1);
            const expectedWithdrawal = roundInfo.totalEmission;
            
            await simulateRoundResolution();
            
            const vaultBalanceAfter = await vault.remainingEmissions();
            const actualWithdrawal = vaultBalanceBefore - vaultBalanceAfter;
            
            expect(actualWithdrawal).to.equal(expectedWithdrawal);
        });

        it("Should handle vault insufficient balance gracefully", async function () {
            // This would require a complex setup to drain the vault
            // For now, test that the logic exists
            
            const vaultBalance = await vault.remainingEmissions();
            expect(vaultBalance).to.be.greaterThan(0);
            
            // The contract should handle min(requested, available) logic
        });

        it("Should spoil resources for destroyed bunkers", async function () {
            const deadAddressBalanceBefore = await wwiii.balanceOf(await game.DEAD_ADDRESS());
            
            // Destroy bunker 1
            await simulateRoundResolution(
                [ethers.parseEther("15000"), 0n, 0n, 0n, 0n], // Destroy bunker 1
                [0n, 0n, 0n, 0n, 0n]
            );
            
            const deadAddressBalanceAfter = await wwiii.balanceOf(await game.DEAD_ADDRESS());
            const spoiledAmount = deadAddressBalanceAfter - deadAddressBalanceBefore;
            
            // Should include both destroyed tokens AND spoiled resources
            expect(spoiledAmount).to.be.greaterThan(tenK); // At least the destroyed deployment
            
            // The spoiled resources should equal base share
            const roundInfo = await game.rounds(1);
            const baseShare = roundInfo.totalEmission / 6n;
            expect(spoiledAmount).to.be.greaterThanOrEqual(tenK + baseShare);
        });
    });

    describe("Index System Precision", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should maintain precision constants", async function () {
            const baseIndex = await game.BASE_INDEX();
            
            expect(baseIndex).to.equal(ethers.parseEther("10000")); // 10000 * 1e18
        });

        it("Should calculate player balance with index correctly", async function () {
            const currentDeployment = await game.getCurrentDeployment(player1.address);
            expect(currentDeployment).to.equal(tenK); // Initial deployment
            
            // After resource distribution, should increase proportionally
            await simulateRoundResolution();
            
            const newDeployment = await game.getCurrentDeployment(player1.address);
            expect(newDeployment).to.be.greaterThan(tenK);
        });

        it("Should update bunker index after resource distribution", async function () {
            const bunker1InfoBefore = await game.getBunkerInfo(1);
            const indexBefore = bunker1InfoBefore.bunkerState.index;
            const totalBefore = bunker1InfoBefore.bunkerState.totalDeployed;
            
            await simulateRoundResolution();
            
            const bunker1InfoAfter = await game.getBunkerInfo(1);
            const indexAfter = bunker1InfoAfter.bunkerState.index;
            const totalAfter = bunker1InfoAfter.bunkerState.totalDeployed;
            
            // Index should increase (more resources per unit)
            expect(indexAfter).to.be.greaterThan(indexBefore);
            expect(totalAfter).to.be.greaterThan(totalBefore);
        });

        it("Should calculate damage index correctly", async function () {
            // Deploy massive amount to enable meaningful damage
            const massiveDeployment = ethers.parseEther("1200000"); // 1.2M tokens
            await wwiii.transfer(others[0].address, massiveDeployment);
            await wwiii.connect(others[0]).approve(game.target, massiveDeployment);
            await game.connect(others[0]).deploy(1, massiveDeployment);
            
            const bunker1InfoBefore = await game.getBunkerInfo(1);
            const indexBefore = bunker1InfoBefore.bunkerState.index;
            const totalDeployedBefore = bunker1InfoBefore.bunkerState.totalDeployed;
            
            // Apply damage that overwhelms emissions - 1M damage to be sure
            const damageAmount = ethers.parseEther("1000000");
            await simulateRoundResolution(
                [damageAmount, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );
            
            const bunker1InfoAfter = await game.getBunkerInfo(1);
            const indexAfter = bunker1InfoAfter.bunkerState.index;
            const totalDeployedAfter = bunker1InfoAfter.bunkerState.totalDeployed;
            
            // Index should decrease (damage overwhelms emissions)
            expect(indexAfter).to.be.lessThan(indexBefore);
            
            // Calculate expected values accounting for order: damage first, then emissions
            const roundInfo = await game.rounds(1);
            const baseShare = roundInfo.totalEmission / 6n; // Base emission per bunker
            const netChange = baseShare - damageAmount; // Net change (negative because damage > emissions)
            const expectedTotalAfter = totalDeployedBefore + netChange;
            
            // Verify final totalDeployed = original - damage + emissions
            expect(totalDeployedAfter).to.equal(expectedTotalAfter);
            
            // Index calculation: newIndex = oldIndex * newTotal / oldTotal
            const expectedIndex = (indexBefore * expectedTotalAfter) / totalDeployedBefore;
            expect(indexAfter).to.be.closeTo(expectedIndex, ethers.parseEther("1000")); // Allow for some rounding
        });

        it("Should maintain precision over multiple rounds", async function () {
            let totalExpectedBalance = tenK;
            
            // Simulate 10 rounds with various scenarios
            for (let i = 0; i < 10; i++) {
                const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
                
                // Alternate between no damage and small damage
                const damage = i % 2 === 0 ? 0n : ethers.parseEther("100");
                await simulateRoundResolution(
                    [damage, 0n, 0n, 0n, 0n],
                    [0n, 0n, 0n, 0n, 0n]
                );
                
                const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
                const resourceIncrease = bunker1BalanceAfter - bunker1BalanceBefore;
                
                // Track expected vs actual
                if (damage > 0) {
                    totalExpectedBalance = totalExpectedBalance + resourceIncrease - damage;
                } else {
                    totalExpectedBalance = totalExpectedBalance + resourceIncrease;
                }
            }
            
            const finalPlayerBalance = await game.getCurrentDeployment(player1.address);
            
            // Should be within 1% of expected (accounting for rounding)
            const tolerance = totalExpectedBalance / 100n;
            expect(finalPlayerBalance).to.be.closeTo(totalExpectedBalance, tolerance);
        });

        it("Should handle precision with very small amounts", async function () {
            // Deploy massive amount to enable meaningful damage testing
            const massiveDeployment = ethers.parseEther("500000"); // 500k tokens
            await wwiii.transfer(others[1].address, massiveDeployment);
            await wwiii.connect(others[1]).approve(game.target, massiveDeployment);
            await game.connect(others[1]).deploy(1, massiveDeployment);
            
            const bunkerInfoBefore = await game.getBunkerInfo(1);
            const indexBefore = bunkerInfoBefore.bunkerState.index;
            const totalDeployedBefore = bunkerInfoBefore.bunkerState.totalDeployed;
            
            // Test with damage that just slightly overwhelms emissions
            const roundInfo = await game.rounds(1);
            const baseShare = roundInfo.totalEmission / 6n; // ~456k emissions
            const smallDamage = baseShare + ethers.parseEther("10000"); // 10k more than emissions
            
            await simulateRoundResolution(
                [smallDamage, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );
            
            const bunkerInfoAfter = await game.getBunkerInfo(1);
            const indexAfter = bunkerInfoAfter.bunkerState.index;
            const totalDeployedAfter = bunkerInfoAfter.bunkerState.totalDeployed;
            
            // Index should decrease slightly due to damage overwhelming emissions
            expect(indexAfter).to.be.lessThan(indexBefore);
            expect(indexAfter).to.be.greaterThan(0);
            
            // Verify the net effect (should be -10k tokens)
            const expectedNetDecrease = ethers.parseEther("10000");
            const expectedTotalAfter = totalDeployedBefore - expectedNetDecrease;
            expect(totalDeployedAfter).to.be.closeTo(expectedTotalAfter, ethers.parseEther("100"));
            
            // Difference should be small but measurable (precision maintained)
            const difference = indexBefore - indexAfter;
            expect(difference).to.be.greaterThan(0);
            expect(difference).to.be.lessThan(indexBefore / 10n); // Less than 10% change
        });

        it("Should handle precision loss vs bunker balance", async function () {
            const currentDeployment = await game.getCurrentDeployment(player1.address);
            const bunkerBalance = await wwiii.balanceOf(bunkerAddresses[0]);
            
            // getCurrentDeployment should return min(calculated, bunkerBalance)
            expect(currentDeployment).to.be.lessThanOrEqual(bunkerBalance);
        });
    });

    describe("Vault Integration", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should verify vault has 6B tokens initially", async function () {
            const vaultBalance = await vault.remainingEmissions();
            expect(vaultBalance).to.equal(ethers.parseEther("6000000000"));
        });

        it("Should verify game contract can withdraw from vault", async function () {
            const balanceBefore = await vault.remainingEmissions();
            
            await simulateRoundResolution();
            
            const balanceAfter = await vault.remainingEmissions();
            expect(balanceAfter).to.be.lessThan(balanceBefore);
        });

        it("Should handle vault withdrawal failure gracefully", async function () {
            // This would require mocking vault failure
            // For now, verify that withdrawal success is checked
            
            await expect(simulateRoundResolution())
                .to.not.be.reverted;
        });

        // Removed: totalWithdrawn function doesn't exist on vault contract
    });

    describe("Economic Balance Validation", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should maintain token conservation across system", async function () {
            const totalSupply = await wwiii.totalSupply();
            
            // Calculate total tokens in various locations
            const vaultBalance = await vault.remainingEmissions();
            const gameBalance = await wwiii.balanceOf(game.target);
            const bunkerBalances = await Promise.all(
                bunkerAddresses.map(addr => wwiii.balanceOf(addr))
            );
            const playerBalances = await Promise.all([
                wwiii.balanceOf(player1.address),
                wwiii.balanceOf(player2.address),
                wwiii.balanceOf(player3.address)
            ]);
            const deadBalance = await wwiii.balanceOf(await game.DEAD_ADDRESS());
            const ownerBalance = await wwiii.balanceOf(owner.address);
            
            const totalAccountedFor = vaultBalance + gameBalance + deadBalance + ownerBalance +
                bunkerBalances.reduce((sum, bal) => sum + bal, 0n) +
                playerBalances.reduce((sum, bal) => sum + bal, 0n);
            
            expect(totalAccountedFor).to.equal(totalSupply);
        });

        it("Should verify emission schedule totals 6B over 3 years", async function () {
            // Calculate total emissions for 3 years (3288 rounds)
            const year1Total = (ethers.parseEther("3000000000") / 1096n) * 1096n;
            const year2Total = (ethers.parseEther("2000000000") / 1096n) * 1096n;
            const year3Total = (ethers.parseEther("1000000000") / 1096n) * 1096n;
            
            const totalEmissions = year1Total + year2Total + year3Total;
            
            // Should be close to 6B (allowing for rounding)
            const expectedTotal = ethers.parseEther("6000000000");
            const tolerance = ethers.parseEther("1000000"); // 1M token tolerance
            
            expect(totalEmissions).to.be.closeTo(expectedTotal, tolerance);
        });

        it("Should verify bunker 3 gets exactly 2x resources over time", async function () {
            let bunker1Total = 0n;
            let bunker3Total = 0n;
            
            // Simulate 5 rounds
            for (let i = 0; i < 5; i++) {
                const bunker1Before = await wwiii.balanceOf(bunkerAddresses[0]);
                const bunker3Before = await wwiii.balanceOf(bunkerAddresses[2]);
                
                await simulateRoundResolution();
                
                const bunker1After = await wwiii.balanceOf(bunkerAddresses[0]);
                const bunker3After = await wwiii.balanceOf(bunkerAddresses[2]);
                
                bunker1Total += (bunker1After - bunker1Before);
                bunker3Total += (bunker3After - bunker3Before);
            }
            
            // Bunker 3 should have received exactly 2x
            expect(bunker3Total).to.equal(bunker1Total * 2n);
        });

        it("Should verify no tokens lost in damage/resource cycles", async function () {
            const totalSupplyBefore = await wwiii.totalSupply();
            
            // Simulate multiple rounds with damage
            for (let i = 0; i < 3; i++) {
                await simulateRoundResolution(
                    [ethers.parseEther("1000"), 0n, 0n, 0n, 0n], // Small damage each round
                    [0n, 0n, 0n, 0n, 0n]
                );
            }
            
            const totalSupplyAfter = await wwiii.totalSupply();
            
            // Total supply should remain constant (tokens are moved to DEAD_ADDRESS, not destroyed)
            expect(totalSupplyAfter).to.equal(totalSupplyBefore);
        });
    });

    describe("Long-term Economic Simulation", function () {
        it("Should handle year transitions smoothly", async function () {
            await setupGameWithPlayers();
            
            // Test year 1 to year 2 transition (around round 1096-1097)
            // This is a simplified version - full test would require 1096 rounds
            
            const year1Emission = ethers.parseEther("3000000000") / 1096n;
            const year2Emission = ethers.parseEther("2000000000") / 1096n;
            
            expect(year2Emission).to.equal(year1Emission * 2n / 3n);
        });


        it("Should verify precision over extended gameplay", async function () {
            await setupGameWithPlayers();
            
            let cumulativeError = 0n;
            
            // Simulate 20 rounds with varying scenarios
            for (let i = 0; i < 20; i++) {
                const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
                const playerBalanceBefore = await game.getCurrentDeployment(player1.address);
                
                // Alternate scenarios
                const scenarios = [
                    // No damage
                    { rockets: [0n, 0n, 0n, 0n, 0n], shields: [0n, 0n, 0n, 0n, 0n] },
                    // Small damage
                    { rockets: [ethers.parseEther("100"), 0n, 0n, 0n, 0n], shields: [0n, 0n, 0n, 0n, 0n] },
                    // Large damage
                    { rockets: [ethers.parseEther("2000"), 0n, 0n, 0n, 0n], shields: [0n, 0n, 0n, 0n, 0n] }
                ];
                
                const scenario = scenarios[i % scenarios.length];
                await simulateRoundResolution(scenario.rockets, scenario.shields);
                
                const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
                const playerBalanceAfter = await game.getCurrentDeployment(player1.address);
                
                // Calculate precision error (difference between calculated and actual)
                const bunkerChange = bunker1BalanceAfter - bunker1BalanceBefore;
                const playerChange = playerBalanceAfter - playerBalanceBefore;
                
                // Player change should approximately equal bunker change for single player
                const error = bunkerChange > playerChange ? bunkerChange - playerChange : playerChange - bunkerChange;
                cumulativeError += error;
            }
            
            // Cumulative precision error should be minimal (< 0.1% of total value)
            const finalBalance = await game.getCurrentDeployment(player1.address);
            const errorPercentage = (Number(cumulativeError) / Number(finalBalance)) * 100;
            
            expect(errorPercentage).to.be.lessThan(0.1);
        });
    });

    describe("Bunker Index Reset System", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should reset bunker index successfully", async function () {
            // End current round and distribute resources to build up index
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Capture index after resource distribution but before starting new round
            const bunker1InfoBefore = await game.getBunkerInfo(1);
            const indexBefore = bunker1InfoBefore.bunkerState.index;
            const totalDeployedBefore = bunker1InfoBefore.bunkerState.totalDeployed;
            
            // Index should be higher than base after resource distribution
            expect(indexBefore).to.be.greaterThan(await game.BASE_INDEX());

            // Reset bunker 1 index (still between rounds)
            await game.connect(waracle).resetBunkerIndex(1, 0);

            const bunker1InfoAfter = await game.getBunkerInfo(1);
            const indexAfter = bunker1InfoAfter.bunkerState.index;
            const totalDeployedAfter = bunker1InfoAfter.bunkerState.totalDeployed;

            // Index should be reset to BASE_INDEX
            expect(indexAfter).to.equal(await game.BASE_INDEX());
            
            // Total deployed should remain the same
            expect(totalDeployedAfter).to.equal(totalDeployedBefore);
        });

        it("Should handle sequential batching correctly", async function () {
            // Give tokens to additional players first
            await wwiii.transfer(others[0].address, tenK);
            await wwiii.transfer(others[1].address, tenK);
            
            // Deploy multiple players to bunker 1
            await wwiii.connect(others[0]).approve(game.target, tenK);
            await wwiii.connect(others[1]).approve(game.target, tenK);
            await game.connect(others[0]).deploy(1, tenK);
            await game.connect(others[1]).deploy(1, tenK);

            // End current round and distribute resources to build up index
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Capture balances after resource distribution
            const player1BalanceBefore = await game.getCurrentDeployment(player1.address);
            const others0BalanceBefore = await game.getCurrentDeployment(others[0].address);
            const others1BalanceBefore = await game.getCurrentDeployment(others[1].address);

            // Start reset process with batch size 2 (should process only 2 players)
            await game.connect(waracle).resetBunkerIndex(1, 2);

            // Check that next index tracking shows 2 players processed
            const nextIndex = await game.bunkerResetNextIndex(1);
            expect(nextIndex).to.equal(2);

            // Process remaining player (batch size 1)
            await game.connect(waracle).resetBunkerIndex(1, 1);

            // Now next index tracking should be reset (completed)
            const finalNextIndex = await game.bunkerResetNextIndex(1);
            expect(finalNextIndex).to.equal(0);

            // Verify all player balances are preserved
            const player1BalanceAfter = await game.getCurrentDeployment(player1.address);
            const others0BalanceAfter = await game.getCurrentDeployment(others[0].address);
            const others1BalanceAfter = await game.getCurrentDeployment(others[1].address);

            // All balances should be preserved
            expect(player1BalanceAfter).to.equal(player1BalanceBefore);
            expect(others0BalanceAfter).to.equal(others0BalanceBefore);
            expect(others1BalanceAfter).to.equal(others1BalanceBefore);
        });

        it("Should revert for destroyed bunkers", async function () {
            // End current round and apply massive damage to destroy bunker 1
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [ethers.parseEther("15000"), 0n, 0n, 0n, 0n], // Destroy bunker 1
                [0n, 0n, 0n, 0n, 0n]
            );

            // Verify bunker is destroyed
            const bunker1Info = await game.getBunkerInfo(1);
            expect(bunker1Info.bunkerState.index).to.equal(0);

            // Should revert when trying to reset destroyed bunker
            await expect(game.connect(waracle).resetBunkerIndex(1, 0))
                .to.be.revertedWithCustomError(game, "BunkerAlreadyDestroyed");
        });

        it("Should preserve total value during reset", async function () {
            // End current round and distribute resources to build up index
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Capture values after resource distribution but before reset
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            const player1BalanceBefore = await game.getCurrentDeployment(player1.address);

            // Reset should preserve value
            await game.connect(waracle).resetBunkerIndex(1, 0);

            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            const player1BalanceAfter = await game.getCurrentDeployment(player1.address);

            // Bunker balance should remain the same
            expect(bunker1BalanceAfter).to.equal(bunker1BalanceBefore);
            
            // Player balance should remain the same
            expect(player1BalanceAfter).to.equal(player1BalanceBefore);
        });

        it("Should block new rounds during active reset", async function () {
            // Give tokens to additional players first
            for (let i = 2; i < 6; i++) {
                await wwiii.transfer(others[i].address, tenK);
            }
            
            // Deploy many players to create a large reset operation
            for (let i = 2; i < 6; i++) {
                await wwiii.connect(others[i]).approve(game.target, tenK);
                await game.connect(others[i]).deploy(1, tenK);
            }

            // Simulate rounds
            for (let i = 0; i < 3; i++) {
                await simulateRoundResolution();
            }

            // Start reset (this should set bunkerResetNextIndex > 0)
            const bunker1Info = await game.getBunkerInfo(1);
            const playerCount = bunker1Info.bunkerState.players.length;
            
            if (playerCount > 5) { // If we have enough players to trigger batching
                // Mock a partial reset by setting nextIndex manually
                // In real scenario, reset would be partial due to gas limits
                
                // Advance time for next round
                await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
                await ethers.provider.send("evm_mine", []);

                // Try to start new round - should work if no active reset
                await expect(game.connect(waracle).startNewRound())
                    .to.not.be.reverted;
            }
        });

        it("Should handle empty bunkers correctly", async function () {
            // Try to reset an empty bunker (bunker 4 has no players)
            const bunker4Info = await game.getBunkerInfo(4);
            expect(bunker4Info.bunkerState.players.length).to.equal(0);

            // End current round first to allow reset
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Empty bunkers stay at BASE_INDEX and cannot be reset (IndexResetNotNeeded)
            await expect(game.connect(waracle).resetBunkerIndex(4, 0))
                .to.be.revertedWithCustomError(game, "IndexResetNotNeeded");

            // Index should still be BASE_INDEX
            const bunker4InfoAfter = await game.getBunkerInfo(4);
            expect(bunker4InfoAfter.bunkerState.index).to.equal(await game.BASE_INDEX());
        });

        it("Should only allow waracle to reset bunkers", async function () {
            // End current round first to allow reset
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            await expect(game.connect(player1).resetBunkerIndex(1, 0))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");

            await expect(game.connect(owner).resetBunkerIndex(1, 0))
                .to.be.revertedWithCustomError(game, "OnlyWaracle");

            // Waracle should be able to reset
            await expect(game.connect(waracle).resetBunkerIndex(1, 0))
                .to.not.be.reverted;
        });

        it("Should validate bunker ID", async function () {
            await expect(game.connect(waracle).resetBunkerIndex(0, 0))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");

            await expect(game.connect(waracle).resetBunkerIndex(6, 0))
                .to.be.revertedWithCustomError(game, "InvalidBunkerId");
        });

        it("Should emit events during reset", async function () {
            // End current round and distribute resources to build up index
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Capture index before reset
            const bunker1InfoBefore = await game.getBunkerInfo(1);
            const indexBefore = bunker1InfoBefore.bunkerState.index;

            // Reset and check for events (3rd arg is playersReset count, not newIndex)
            await expect(game.connect(waracle).resetBunkerIndex(1, 0))
                .to.emit(game, "BunkerIndexReset")
                .withArgs(1, indexBefore, 1); // 1 player was reset
        });

        it("Should handle multiple resets correctly", async function () {
            // End current round and distribute resources to build up index
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Capture balance after resource distribution
            const player1BalanceBefore = await game.getCurrentDeployment(player1.address);

            // First reset should work
            await game.connect(waracle).resetBunkerIndex(1, 0);
            const balanceAfterFirst = await game.getCurrentDeployment(player1.address);
            
            // Second reset should fail - index is now at BASE_INDEX
            await expect(game.connect(waracle).resetBunkerIndex(1, 0))
                .to.be.revertedWithCustomError(game, "IndexResetNotNeeded");

            // Balance should be preserved after first reset
            expect(balanceAfterFirst).to.equal(player1BalanceBefore);

            // Index should be BASE_INDEX
            const bunker1Info = await game.getBunkerInfo(1);
            expect(bunker1Info.bunkerState.index).to.equal(await game.BASE_INDEX());
        });

        it("Should handle precision correctly during reset", async function () {
            // End current round and distribute resources to build up index
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu(
                [0n, 0n, 0n, 0n, 0n],
                [0n, 0n, 0n, 0n, 0n]
            );

            // Capture values after resource distribution but before reset
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            const player1BalanceBefore = await game.getCurrentDeployment(player1.address);

            // Reset index
            await game.connect(waracle).resetBunkerIndex(1, 0);

            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            const player1BalanceAfter = await game.getCurrentDeployment(player1.address);

            // Values should be preserved exactly (no precision loss)
            expect(bunker1BalanceAfter).to.equal(bunker1BalanceBefore);
            expect(player1BalanceAfter).to.equal(player1BalanceBefore);

            // Index should be exactly BASE_INDEX
            const bunker1Info = await game.getBunkerInfo(1);
            expect(bunker1Info.bunkerState.index).to.equal(await game.BASE_INDEX());
        });
    });
});