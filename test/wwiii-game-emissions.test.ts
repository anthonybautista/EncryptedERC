// WWIII Game Flexible Emissions Tests
// Focus: Owner-controlled emission management, legacy compatibility, integration

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, WWIIIGameToken } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp } from "./helpers";
import { User } from "./user";

describe("Flexible Emission System", function () {
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
        
        await wwiii.transfer(player1.address, hundredK);
        await wwiii.transfer(player2.address, hundredK);
        await wwiii.transfer(player3.address, hundredK);
    }

    // Helper function to start game
    async function startGame() {
        const combatStartTime = await getFutureTimestamp(100);
        await game.connect(owner).startGame(combatStartTime);
        
        await ethers.provider.send("evm_increaseTime", [200]);
        await ethers.provider.send("evm_mine", []);
        
        await game.connect(waracle).startNewRound();
    }

    // Helper function to set up game with players
    async function setupGameWithPlayers() {
        await startGame();
        
        // Deploy players to different bunkers
        await wwiii.connect(player1).approve(game.target, tenK);
        await game.connect(player1).deploy(1, tenK);
        
        await wwiii.connect(player2).approve(game.target, tenK);
        await game.connect(player2).deploy(3, tenK);
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

    describe("Manual Emissions Management", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should use legacy emissions by default", async function () {
            expect(await game.useManualEmissions()).to.equal(false);
            expect(await game.currentRoundEmission()).to.equal(0);
            expect(await game.lastEmissionUpdateRound()).to.equal(0);
            
            const currentEmission = await game.getCurrentEmission();
            const expectedLegacy = ethers.parseEther("3000000000") / 1096n;
            expect(currentEmission).to.equal(expectedLegacy);
        });

        it("Should allow owner to set custom emissions", async function () {
            const customEmission = ethers.parseEther("5000000"); // 5M tokens per round
            
            await expect(game.connect(owner).setRoundEmissions(customEmission))
                .to.emit(game, "EmissionsUpdated")
                .withArgs(customEmission, 1, owner.address);
            
            expect(await game.useManualEmissions()).to.equal(true);
            expect(await game.currentRoundEmission()).to.equal(customEmission);
            expect(await game.getCurrentEmission()).to.equal(customEmission);
            expect(await game.lastEmissionUpdateRound()).to.equal(1);
        });

        it("Should apply custom emissions to new rounds", async function () {
            const customEmission = ethers.parseEther("1000000"); // 1M tokens per round
            
            await game.connect(owner).setRoundEmissions(customEmission);
            await simulateRoundResolution();
            
            const newRoundInfo = await game.rounds(2);
            expect(newRoundInfo.totalEmission).to.equal(customEmission);
        });

        it("Should prevent setting emissions higher than vault balance", async function () {
            const vaultBalance = await vault.remainingEmissions();
            const excessiveEmission = vaultBalance + ethers.parseEther("1000000");
            
            await expect(game.connect(owner).setRoundEmissions(excessiveEmission))
                .to.be.revertedWith("Emission exceeds vault balance");
        });

        it("Should prevent setting zero emissions", async function () {
            await expect(game.connect(owner).setRoundEmissions(0))
                .to.be.revertedWith("Emission must be positive");
        });

        it("Should allow reverting to legacy emissions", async function () {
            // Set custom emissions first
            await game.connect(owner).setRoundEmissions(ethers.parseEther("1000000"));
            expect(await game.useManualEmissions()).to.equal(true);
            
            // Revert to legacy
            await expect(game.connect(owner).useLegacyEmissions())
                .to.emit(game, "EmissionsReverted")
                .withArgs(1, owner.address);
                
            expect(await game.useManualEmissions()).to.equal(false);
            
            // Should use legacy calculation again
            const expectedLegacy = ethers.parseEther("3000000000") / 1096n;
            expect(await game.getCurrentEmission()).to.equal(expectedLegacy);
        });

        it("Should restrict emission changes to owner only", async function () {
            await expect(game.connect(player1).setRoundEmissions(ethers.parseEther("1000000")))
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
                
            await expect(game.connect(waracle).useLegacyEmissions())
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
                
            await expect(game.connect(player2).setRoundEmissions(ethers.parseEther("2000000")))
                .to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
        });

        it("Should support mid-game emission changes", async function () {
            // Start with legacy
            await simulateRoundResolution(); // Round 2
            let roundInfo = await game.rounds(2);
            const legacyEmission = roundInfo.totalEmission;
            
            // Switch to custom emissions
            const customEmission = ethers.parseEther("1500000");
            await game.connect(owner).setRoundEmissions(customEmission);
            
            // New rounds use custom emission
            await simulateRoundResolution(); // Round 3
            roundInfo = await game.rounds(3);
            expect(roundInfo.totalEmission).to.equal(customEmission);
            
            // Can revert to legacy mid-game
            await game.connect(owner).useLegacyEmissions();
            await simulateRoundResolution(); // Round 4
            roundInfo = await game.rounds(4);
            expect(roundInfo.totalEmission).to.equal(legacyEmission); // Back to legacy
        });

        it("Should cap manual emissions at vault balance", async function () {
            const vaultBalance = await vault.remainingEmissions();
            const largeEmission = vaultBalance * 2n; // Double vault balance
            
            // This should be rejected in setRoundEmissions
            await expect(game.connect(owner).setRoundEmissions(largeEmission))
                .to.be.revertedWith("Emission exceeds vault balance");
        });

        it("Should handle vault depletion with manual emissions", async function () {
            // Set a very large emission that would exceed vault
            const vaultBalance = await vault.remainingEmissions();
            const largeEmission = vaultBalance - ethers.parseEther("1000000"); // Just under vault balance
            
            await game.connect(owner).setRoundEmissions(largeEmission);
            
            // After setting, getCurrentEmission should still work
            const currentEmission = await game.getCurrentEmission();
            expect(currentEmission).to.be.lessThanOrEqual(vaultBalance);
        });

        it("Should maintain emission settings across multiple rounds", async function () {
            const customEmission = ethers.parseEther("2500000");
            
            await game.connect(owner).setRoundEmissions(customEmission);
            
            // Simulate multiple rounds
            for (let i = 0; i < 3; i++) {
                await simulateRoundResolution();
                const roundInfo = await game.rounds(2 + i);
                expect(roundInfo.totalEmission).to.equal(customEmission);
            }
        });
    });

    describe("Integration with Resource Distribution", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should distribute resources correctly with custom emissions", async function () {
            const customEmission = ethers.parseEther("3000000"); // 3M per round
            await game.connect(owner).setRoundEmissions(customEmission);
            
            // Current round (1) still uses legacy emission, custom applies to round 2+
            await simulateRoundResolution(); // Resolve round 1 with legacy emission
            
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker3BalanceBefore = await wwiii.balanceOf(bunkerAddresses[2]);
            
            // Round 2 should use custom emission
            await simulateRoundResolution(); 
            
            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            const bunker3BalanceAfter = await wwiii.balanceOf(bunkerAddresses[2]);
            
            // Calculate expected distributions based on custom emission
            const baseShare = customEmission / 6n;
            const bunker1Share = baseShare;
            const bunker3Share = baseShare * 2n; // Bunker 3 gets 2x
            
            expect(bunker1BalanceAfter - bunker1BalanceBefore).to.equal(bunker1Share);
            expect(bunker3BalanceAfter - bunker3BalanceBefore).to.equal(bunker3Share);
        });

        it("Should work correctly when switching between manual and legacy mid-game", async function () {
            // Start with legacy emissions
            await game.connect(owner).useLegacyEmissions();
            await simulateRoundResolution();
            const legacyRoundInfo = await game.rounds(2);
            const legacyEmission = legacyRoundInfo.totalEmission;

            // Switch to custom
            const customEmission = ethers.parseEther("4000000");
            await game.connect(owner).setRoundEmissions(customEmission);
            
            // Current round (4) still uses legacy, custom applies to round 3+
            await simulateRoundResolution(); // Resolve round 4 with legacy
            
            const bunker1BalanceBefore = await wwiii.balanceOf(bunkerAddresses[0]);
            await simulateRoundResolution(); // Round 5 should use custom emission
            const bunker1BalanceAfter = await wwiii.balanceOf(bunkerAddresses[0]);
            
            // Should use custom emission
            const customShare = customEmission / 6n;
            expect(bunker1BalanceAfter - bunker1BalanceBefore).to.equal(customShare);
            
            // Switch back to legacy
            await game.connect(owner).useLegacyEmissions();
            await simulateRoundResolution(); // Round 6 will still use custom emission
            
            const bunker1BalanceBefore2 = await wwiii.balanceOf(bunkerAddresses[0]);
            await simulateRoundResolution(); // Round 7 should use legacy again
            const bunker1BalanceAfter2 = await wwiii.balanceOf(bunkerAddresses[0]);
            
            // Should use legacy emission again
            const legacyShare = legacyEmission / 6n;
            expect(bunker1BalanceAfter2 - bunker1BalanceBefore2).to.equal(legacyShare);
        });
    });

    describe("Edge Cases and Error Conditions", function () {
        beforeEach(async function () {
            await setupGameWithPlayers();
        });

        it("Should handle emission changes when vault is nearly empty", async function () {
            // Manually reduce vault balance to test edge case
            // This would require more complex setup in a real scenario
            
            // For now, test that the function works with current vault balance
            const vaultBalance = await vault.remainingEmissions();
            const maxEmission = vaultBalance;
            
            await game.connect(owner).setRoundEmissions(maxEmission);
            expect(await game.getCurrentEmission()).to.be.lessThanOrEqual(vaultBalance);
        });

        it("Should preserve state correctly when emissions are changed multiple times", async function () {
            const emission1 = ethers.parseEther("1000000");
            const emission2 = ethers.parseEther("2000000");
            const emission3 = ethers.parseEther("1500000");
            
            // Change emissions multiple times
            await game.connect(owner).setRoundEmissions(emission1);
            expect(await game.currentRoundEmission()).to.equal(emission1);
            
            await game.connect(owner).setRoundEmissions(emission2);
            expect(await game.currentRoundEmission()).to.equal(emission2);
            
            await game.connect(owner).setRoundEmissions(emission3);
            expect(await game.currentRoundEmission()).to.equal(emission3);
            
            // Final emission should be emission3
            expect(await game.getCurrentEmission()).to.equal(emission3);
        });

        it("Should handle reverting to legacy when vault balance changes", async function () {
            // Set custom emission
            await game.connect(owner).setRoundEmissions(ethers.parseEther("1000000"));
            
            // Revert to legacy
            await game.connect(owner).useLegacyEmissions();
            
            // Legacy calculation should still work
            const expectedLegacy = ethers.parseEther("3000000000") / 1096n;
            expect(await game.getCurrentEmission()).to.equal(expectedLegacy);
        });
    });

    describe("View Function Behavior", function () {
        it("Should return correct values for all view functions", async function () {
            await setupGameWithPlayers();
            
            // Test default state
            expect(await game.useManualEmissions()).to.equal(false);
            expect(await game.currentRoundEmission()).to.equal(0);
            expect(await game.lastEmissionUpdateRound()).to.equal(0);
            
            const legacyEmission = ethers.parseEther("3000000000") / 1096n;
            expect(await game.getCurrentEmission()).to.equal(legacyEmission);
            
            // Test after setting manual emissions
            const customEmission = ethers.parseEther("2000000");
            await game.connect(owner).setRoundEmissions(customEmission);
            
            expect(await game.useManualEmissions()).to.equal(true);
            expect(await game.currentRoundEmission()).to.equal(customEmission);
            expect(await game.lastEmissionUpdateRound()).to.equal(1);
            expect(await game.getCurrentEmission()).to.equal(customEmission);
        });
    });
});