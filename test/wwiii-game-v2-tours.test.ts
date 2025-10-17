// WWIII Game V2 Tour Management Tests
// Focus: Tour lifecycle, phase transitions, and configuration validation

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

describe("WWIIIGameV2 Tour Management", function () {
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
        
        // Distribute tokens
        await wwiii.transfer(player1.address, ethers.parseEther("100000"));
    });

    describe("Tour Initialization", function () {
        it("Should start in WAITING phase", async function () {
            expect(await game.getCurrentTourPhase()).to.equal(0); // TourPhase.WAITING
            expect(await game.tourNumber()).to.equal(0);
        });

        it("Should validate tour configuration", async function () {
            const invalidConfigs = [
                // Zero deployment hours
                { hours: 0, rounds: 5, rewards: [100, 100, 100, 100, 100] },
                // Too many deployment hours
                { hours: 200, rounds: 5, rewards: [100, 100, 100, 100, 100] },
                // Zero rounds
                { hours: 48, rounds: 0, rewards: [] },
                // Too many rounds
                { hours: 48, rounds: 150, rewards: new Array(150).fill(100) },
                // Mismatched rewards length
                { hours: 48, rounds: 5, rewards: [100, 100, 100] }
            ];

            for (const config of invalidConfigs) {
                await expect(
                    game.connect(owner).startTour(
                        config.hours,
                        config.rounds,
                        config.rewards.map(r => ethers.parseEther(r.toString()))
                    )
                ).to.be.revertedWithCustomError(game, "InvalidTourConfiguration");
            }
        });

        it("Should reject excessive emissions", async function () {
            const vaultBalance = await vault.remainingEmissions();
            const excessiveRewards = [vaultBalance + 1n]; // More than vault has
            
            await expect(
                game.connect(owner).startTour(48, 1, excessiveRewards)
            ).to.be.revertedWithCustomError(game, "InvalidTourConfiguration");
        });
    });

    describe("Tour Lifecycle", function () {
        it("Should start tour and transition to DEPLOYMENT phase", async function () {
            const deploymentHours = 48;
            const numberOfRounds = 3;
            const roundRewards = [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000"),
                ethers.parseEther("600000")
            ];
            
            const startTx = await game.connect(owner).startTour(
                deploymentHours,
                numberOfRounds,
                roundRewards
            );
            
            const receipt = await startTx.wait();
            const startTime = (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp;
            
            expect(await game.getCurrentTourPhase()).to.equal(1); // TourPhase.DEPLOYMENT
            expect(await game.tourNumber()).to.equal(1);
            
            const [deploymentEndTime, battleStartRound, battleEndRound, roundEmissions, phase] = 
                await game.getCurrentTourDetails();
            expect(deploymentEndTime).to.equal(startTime + deploymentHours * 3600);
            expect(battleStartRound).to.equal(1);
            expect(battleEndRound).to.equal(3);
            expect(roundEmissions.length).to.equal(3);
            expect(phase).to.equal(1); // TourPhase.DEPLOYMENT
            
            await expect(startTx)
                .to.emit(game, "TourStarted")
                .withArgs(1, deploymentHours, numberOfRounds, 1, startTime);
        });

        it("Should prevent starting tour when not in WAITING phase", async function () {
            // Start first tour
            await game.connect(owner).startTour(48, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            // Try to start another tour while in DEPLOYMENT
            await expect(
                game.connect(owner).startTour(24, 1, [ethers.parseEther("500000")])
            ).to.be.revertedWithCustomError(game, "InvalidTourConfiguration");
        });

        it("Should handle phase transitions correctly", async function () {
            // Start tour
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            expect(await game.getCurrentTourPhase()).to.equal(1); // DEPLOYMENT
            
            // Fast forward past deployment time
            await ethers.provider.send("evm_increaseTime", [3700]); // 1 hour + buffer
            await ethers.provider.send("evm_mine", []);
            
            // Start first round should transition to BATTLE
            await game.connect(waracle).startNewRound();
            expect(await game.getCurrentTourPhase()).to.equal(2); // BATTLE
            
            // Fast forward and resolve first round
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // WWIIInu should not change phase (not last round)
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            expect(await game.getCurrentTourPhase()).to.equal(2); // Still BATTLE
            
            // Start second round
            await game.connect(waracle).startNewRound();
            
            // Fast forward and resolve second (last) round
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // WWIIInu on last round should transition to WAITING
            await expect(game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]))
                .to.emit(game, "TourCompleted")
                .withArgs(1, 2, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
                
            expect(await game.getCurrentTourPhase()).to.equal(0); // WAITING
        });
    });

    describe("Tour Boundaries", function () {
        beforeEach(async function () {
            // Start 2-round tour
            await game.connect(owner).startTour(1, 2, [
                ethers.parseEther("1000000"),
                ethers.parseEther("800000")
            ]);
            
            // Skip deployment phase
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);
        });

        it("Should prevent rounds beyond tour boundary", async function () {
            // Start round 1
            await game.connect(waracle).startNewRound();
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            // Start round 2 (last round)
            await game.connect(waracle).startNewRound();
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            // Try to start round 3 (should fail - tour is now in WAITING phase)
            await expect(game.connect(waracle).startNewRound())
                .to.be.revertedWithCustomError(game, "NoActiveTour");
        });

        it("Should use tour-specific emissions", async function () {
            const expectedEmission1 = ethers.parseEther("1000000");
            const expectedEmission2 = ethers.parseEther("800000");
            
            // Start round 1
            const round1Tx = await game.connect(waracle).startNewRound();
            await expect(round1Tx)
                .to.emit(game, "RoundStarted");
            
            const round1 = await game.rounds(1);
            expect(round1.totalEmission).to.equal(expectedEmission1);
            
            // Complete round 1
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            await game.connect(waracle).WWIIInu([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
            
            // Start round 2
            await expect(game.connect(waracle).startNewRound())
                .to.emit(game, "RoundStarted")
                .withArgs(2, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1), 
                         await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1 + 8 * 3600),
                         expectedEmission2);
            
            const round2 = await game.rounds(2);
            expect(round2.totalEmission).to.equal(expectedEmission2);
        });
    });
});