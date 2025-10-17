// WWIII Game V2 Mechanics Tests
// Focus: Testing changed mechanics vs V1 (retreat/deploy/round restrictions)

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type {
    WWIIIGameV2,
    WWIIIToken,
    EmissionVault,
    WWIIIGameToken,
    Registrar
} from "../typechain-types";
import { deployGameVerifiers, deployLibrary } from "./helpers";
import { User } from "./user";

describe("WWIIIGameV2 Changed Mechanics", function () {
    this.timeout(300000); // 5 minutes
    
    let owner: SignerWithAddress;
    let waracle: SignerWithAddress;
    let player1: SignerWithAddress;
    let others: SignerWithAddress[];
    let wwiii: WWIIIToken;
    let vault: EmissionVault;
    let rocket: WWIIIGameToken;
    let shield: WWIIIGameToken;
    let registrar: Registrar;
    let game: WWIIIGameV2;
    let bunkerUsers: User[];
    let bunkerAddresses: string[];
    let verifiers: any;

    beforeEach(async function () {
        [owner, waracle, player1, ...others] = await ethers.getSigners();
        
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
            const bunker = await BunkerFactory.deploy(i, wwiii.target);
            await bunker.waitForDeployment();
            bunkerAddresses.push(bunker.target.toString());
            
            await bunker.setBunkerPublicKey([bunkerUsers[i-1].publicKey[0], bunkerUsers[i-1].publicKey[1]]);
        }
        
        // Deploy V2 game contract
        const WWIIIGameV2Factory = await ethers.getContractFactory("WWIIIGameV2");
        game = await WWIIIGameV2Factory.deploy(
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
        
        // Distribute tokens (need more than minimum deposit of 100k)
        await wwiii.transfer(player1.address, ethers.parseEther("500000"));
    });

    describe("Retreat Restrictions", function () {
        it("Should allow retreat during WAITING phase", async function () {
            // Game starts in WAITING phase
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            // First need to deploy during a tour, then end it to return to WAITING
            await game.connect(owner).startTour(1, 1, [ethers.parseEther("1000000")]);
            
            // Deploy player during DEPLOYMENT
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            // Complete the tour to return to WAITING
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).startNewRound();
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            // Should be able to retreat in WAITING phase
            await expect(game.connect(player1).retreat())
                .to.not.be.reverted;
        });

        it("Should allow retreat during DEPLOYMENT phase", async function () {
            // Start tour
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            expect(await game.getCurrentTourPhase()).to.equal(1); // DEPLOYMENT
            
            // Deploy player
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            // Should be able to retreat during DEPLOYMENT
            await expect(game.connect(player1).retreat())
                .to.not.be.reverted;
        });

        it("Should block retreat during BATTLE phase", async function () {
            // Start tour and move to battle phase
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            // Deploy player
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            // Move to battle phase
            await ethers.provider.send("evm_increaseTime", [3700]); // 1 hour + buffer
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).startNewRound();
            expect(await game.getCurrentTourPhase()).to.equal(2); // BATTLE
            
            // Retreat should be blocked during BATTLE
            await expect(game.connect(player1).retreat())
                .to.be.revertedWithCustomError(game, "CannotRetreatDuringBattle");
        });

        it("Should allow retreat after tour ends", async function () {
            // Start tour, move through battle, and end tour
            await game.connect(owner).startTour(1, 1, [ethers.parseEther("1000000")]);
            
            // Deploy player
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            // Move through deployment and battle
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).startNewRound();
            
            // End battle
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            // Should be able to retreat after tour ends
            await expect(game.connect(player1).retreat())
                .to.not.be.reverted;
        });
    });

    describe("Deploy Restrictions", function () {
        it("Should block deploy during WAITING phase", async function () {
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            
            await expect(game.connect(player1).deploy(1, ethers.parseEther("100000")))
                .to.be.revertedWithCustomError(game, "NotInDeploymentPhase");
        });

        it("Should allow deploy during DEPLOYMENT phase", async function () {
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            expect(await game.getCurrentTourPhase()).to.equal(1); // DEPLOYMENT
            
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            
            await expect(game.connect(player1).deploy(1, ethers.parseEther("100000")))
                .to.not.be.reverted;
        });

        it("Should block deploy during BATTLE phase", async function () {
            // Start tour and move to battle
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).startNewRound();
            expect(await game.getCurrentTourPhase()).to.equal(2); // BATTLE
            
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            
            await expect(game.connect(player1).deploy(1, ethers.parseEther("100000")))
                .to.be.revertedWithCustomError(game, "NotInDeploymentPhase");
        });
    });

    describe("Round Restrictions", function () {
        it("Should block startNewRound during WAITING phase", async function () {
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "NoActiveTour");
        });

        it("Should block startNewRound before deployment phase ends", async function () {
            await game.connect(owner).startTour(2, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            expect(await game.getCurrentTourPhase()).to.equal(1); // DEPLOYMENT
            
            // Try to start round before deployment time ends (2 hours)
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "StillInDeploymentPhase");
        });

        it("Should allow startNewRound after deployment phase ends", async function () {
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            // Wait for deployment to end
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            
            await expect(game.connect(waracle).startNewRound())
                .to.not.be.reverted;
        });

        it("Should block WWIIInu calls outside BATTLE phase", async function () {
            // Try WWIIInu in WAITING phase
            await expect(game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]))
                .to.be.revertedWithCustomError(game, "NoActiveTour");
            
            // Start tour (DEPLOYMENT phase)
            await game.connect(owner).startTour(1, 1, [ethers.parseEther("1000000")]);
            
            // Try WWIIInu in DEPLOYMENT phase
            await expect(game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]))
                .to.be.revertedWithCustomError(game, "NoActiveTour");
        });
    });

    describe("Tour-Specific Emissions", function () {
        it("Should use tour-defined emissions instead of legacy calculation", async function () {
            const customEmissions = [
                ethers.parseEther("500000"),  // Round 1: 500k
                ethers.parseEther("750000"),  // Round 2: 750k
                ethers.parseEther("1000000")  // Round 3: 1M
            ];
            
            await game.connect(owner).startTour(1, 3, customEmissions);
            
            // Skip deployment phase
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            
            // Start round 1 and check emission
            await game.connect(waracle).startNewRound();
            const round1 = await game.rounds(1);
            expect(round1.totalEmission).to.equal(customEmissions[0]);
            
            // Complete round 1 and start round 2
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            await game.connect(waracle).startNewRound();
            
            const round2 = await game.rounds(2);
            expect(round2.totalEmission).to.equal(customEmissions[1]);
        });

        it("Should return correct next emissions based on tour phase", async function () {
            const customEmissions = [
                ethers.parseEther("100000"),
                ethers.parseEther("200000")
            ];
            
            // WAITING phase should return 0
            expect(await game.getNextEmissions()).to.equal(0);
            
            // Start tour (DEPLOYMENT phase)
            await game.connect(owner).startTour(1, 2, customEmissions);
            
            // DEPLOYMENT phase should return first round emission
            expect(await game.getNextEmissions()).to.equal(customEmissions[0]);
            
            // Move to BATTLE phase
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).startNewRound();
            
            // BATTLE phase should return current round emission
            expect(await game.getNextEmissions()).to.equal(customEmissions[0]);
        });
    });
});