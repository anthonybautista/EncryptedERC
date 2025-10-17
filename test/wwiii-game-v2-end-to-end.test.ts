// WWIII Game V2 End-to-End Tests
// Focus: Complete tour flow from start to finish

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

describe("WWIIIGameV2 End-to-End Tour Flow", function () {
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
    let registrar: Registrar;
    let game: WWIIIGameV2;
    let bunkerUsers: User[];
    let bunkerAddresses: string[];
    let verifiers: any;

    beforeEach(async function () {
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
        
        // Distribute tokens to players
        await wwiii.transfer(player1.address, ethers.parseEther("500000"));
        await wwiii.transfer(player2.address, ethers.parseEther("500000"));
    });

    describe("Complete Tour Cycle", function () {
        it("Should execute a full tour: WAITING → DEPLOYMENT → BATTLE → WAITING", async function () {
            // Phase 1: Initial WAITING state
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            expect(await game.tourNumber()).to.equal(0);
            
            // Can't deploy in WAITING
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await expect(game.connect(player1).deploy(1, ethers.parseEther("100000")))
                .to.be.revertedWithCustomError(game, "NotInDeploymentPhase");
            
            // Phase 2: Start tour and enter DEPLOYMENT
            const tourEmissions = [
                ethers.parseEther("1000000"), // Round 1
                ethers.parseEther("800000")   // Round 2
            ];
            
            await expect(game.connect(owner).startTour(1, 2, tourEmissions))
                .to.emit(game, "TourStarted")
                .withArgs(1, 1, 2, 1, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
            
            expect(await game.getCurrentTourPhase()).to.equal(1); // DEPLOYMENT
            expect(await game.tourNumber()).to.equal(1);
            
            // Players can deploy during DEPLOYMENT phase
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            await wwiii.connect(player2).approve(game.target, ethers.parseEther("150000"));
            await game.connect(player2).deploy(2, ethers.parseEther("150000"));
            
            // Can retreat during DEPLOYMENT
            await game.connect(player1).retreat();
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000")); // Re-deploy
            
            // Phase 3: Transition to BATTLE
            await ethers.provider.send("evm_increaseTime", [3700]); // 1 hour + buffer
            await ethers.provider.send("evm_mine", []);
            
            // Start first round triggers DEPLOYMENT → BATTLE transition
            await expect(game.connect(waracle).startNewRound())
                .to.emit(game, "RoundStarted")
                .withArgs(1, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1),
                         await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1 + 8 * 3600),
                         tourEmissions[0]);
            
            expect(await game.getCurrentTourPhase()).to.equal(2); // BATTLE
            expect(await game.currentRound()).to.equal(1);
            
            // Players locked during BATTLE - can't retreat or deploy
            await expect(game.connect(player1).retreat())
                .to.be.revertedWithCustomError(game, "CannotRetreatDuringBattle");
            await expect(game.connect(player2).deploy(3, ethers.parseEther("100000")))
                .to.be.revertedWithCustomError(game, "NotInDeploymentPhase");
            
            // Phase 4: Complete first round
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]); // 8 hours + buffer
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            expect(await game.getCurrentTourPhase()).to.equal(2); // Still BATTLE (not last round)
            
            // Phase 5: Start and complete second (final) round
            await expect(game.connect(waracle).startNewRound())
                .to.emit(game, "RoundStarted")
                .withArgs(2, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1),
                         await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1 + 8 * 3600),
                         tourEmissions[1]);
            
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // Last round completion triggers BATTLE → WAITING transition
            await expect(game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]))
                .to.emit(game, "TourCompleted")
                .withArgs(1, 2, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
            
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            // Phase 6: Post-tour WAITING state
            // Players can retreat after tour ends
            await expect(game.connect(player1).retreat()).to.not.be.reverted;
            await expect(game.connect(player2).retreat()).to.not.be.reverted;
            
            // Can't start new rounds without new tour
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "NoActiveTour");
            
            // Can't deploy without new tour
            await expect(game.connect(player1).deploy(1, ethers.parseEther("100000")))
                .to.be.revertedWithCustomError(game, "NotInDeploymentPhase");
        });
    });

    describe("Multiple Tour Cycles", function () {
        it("Should handle multiple consecutive tours", async function () {
            // First tour
            await game.connect(owner).startTour(1, 1, [ethers.parseEther("500000")]);
            expect(await game.tourNumber()).to.equal(1);
            
            // Deploy and complete first tour
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).startNewRound();
            
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            // Second tour with different parameters
            const secondTourEmissions = [
                ethers.parseEther("750000"),
                ethers.parseEther("600000"),
                ethers.parseEther("450000")
            ];
            
            await game.connect(owner).startTour(2, 3, secondTourEmissions);
            expect(await game.tourNumber()).to.equal(2);
            expect(await game.getCurrentTourPhase()).to.equal(1); // DEPLOYMENT
            
            // Verify tour details are updated
            const [deploymentEndTime, battleStartRound, battleEndRound, roundEmissions, phase] = 
                await game.getCurrentTourDetails();
            expect(battleStartRound).to.equal(2); // Continues from previous tour
            expect(battleEndRound).to.equal(4);   // 3 rounds: 2, 3, 4
            expect(roundEmissions.length).to.equal(3);
            expect(phase).to.equal(1); // DEPLOYMENT
        });
    });

    describe("Tour Boundary Enforcement", function () {
        it("Should strictly enforce round limits per tour", async function () {
            // Start 2-round tour
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            // Deploy player
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            // Complete deployment phase and both battle rounds
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            
            // Round 1
            await game.connect(waracle).startNewRound();
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            // Round 2 (last round of tour)
            await game.connect(waracle).startNewRound();
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
            
            // Attempting round 3 should fail - tour is over
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "NoActiveTour");
        });
    });

    describe("Emission Distribution", function () {
        it("Should distribute tour-specific emissions correctly", async function () {
            const tourEmissions = [
                ethers.parseEther("1500000"), // Higher than legacy amounts
                ethers.parseEther("1200000")
            ];
            
            await game.connect(owner).startTour(1, 2, tourEmissions);
            
            // Deploy player
            await wwiii.connect(player1).approve(game.target, ethers.parseEther("100000"));
            await game.connect(player1).deploy(1, ethers.parseEther("100000"));
            
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
            
            // Check first round uses custom emission
            await game.connect(waracle).startNewRound();
            const round1 = await game.rounds(1);
            expect(round1.totalEmission).to.equal(tourEmissions[0]);
            
            // Complete and check second round
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            await game.connect(waracle).startNewRound();
            const round2 = await game.rounds(2);
            expect(round2.totalEmission).to.equal(tourEmissions[1]);
            
            // Verify getNextEmissions works correctly
            expect(await game.getNextEmissions()).to.equal(tourEmissions[1]);
        });
    });
});