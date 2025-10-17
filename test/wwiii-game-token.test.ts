import { ethers } from "hardhat";
import { expect } from "chai";
import { WWIIIGameToken, Registrar, MockVerifier } from "../generated-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployLibrary } from "./helpers";

describe("WWIIIGameToken Contract", function () {
    this.timeout(300000); // 5 minutes
    let rocketToken: WWIIIGameToken;
    let shieldToken: WWIIIGameToken;
    let registrar: Registrar;
    let owner: SignerWithAddress;
    let gameContract: SignerWithAddress;
    let bunker1: SignerWithAddress;
    let bunker2: SignerWithAddress;
    let bunker3: SignerWithAddress;
    let unauthorizedUser: SignerWithAddress;

    // Mock verifier contracts
    let mockMintVerifier: MockVerifier;
    let mockWithdrawVerifier: MockVerifier;
    let mockTransferVerifier: MockVerifier;
    let mockBurnVerifier: MockVerifier;

    beforeEach(async function () {
        [owner, gameContract, bunker1, bunker2, bunker3, unauthorizedUser] = await ethers.getSigners();
        
        // Deploy BabyJubJub library
        const babyJubJubAddress = await deployLibrary(owner);
        
        // Deploy mock verifiers
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
        mockMintVerifier = await MockVerifierFactory.deploy();
        mockWithdrawVerifier = await MockVerifierFactory.deploy();
        mockTransferVerifier = await MockVerifierFactory.deploy();
        mockBurnVerifier = await MockVerifierFactory.deploy();
        
        await mockMintVerifier.waitForDeployment();
        await mockWithdrawVerifier.waitForDeployment();
        await mockTransferVerifier.waitForDeployment();
        await mockBurnVerifier.waitForDeployment();

        // Deploy Registrar with mock registration verifier
        const RegistrarFactory = await ethers.getContractFactory("Registrar");
        const mockRegistrationVerifier = await MockVerifierFactory.deploy();
        await mockRegistrationVerifier.waitForDeployment();
        
        registrar = await RegistrarFactory.deploy(await mockRegistrationVerifier.getAddress());
        await registrar.waitForDeployment();

        // Deploy WWIIIGameToken contracts (ROCKET and SHIELD instances)
        const TokenFactory = await ethers.getContractFactory("WWIIIGameToken", {
            libraries: {
                BabyJubJub: babyJubJubAddress,
            },
        });
        
        // Deploy ROCKET token
        rocketToken = await TokenFactory.deploy({
            registrar: await registrar.getAddress(),
            isConverter: false,
            name: "ROCKET Token",
            symbol: "ROCKET",
            decimals: 18,
            mintVerifier: await mockMintVerifier.getAddress(),
            withdrawVerifier: await mockWithdrawVerifier.getAddress(),
            transferVerifier: await mockTransferVerifier.getAddress(),
            burnVerifier: await mockBurnVerifier.getAddress()
        });
        await rocketToken.waitForDeployment();
        
        // Deploy SHIELD token
        shieldToken = await TokenFactory.deploy({
            registrar: await registrar.getAddress(),
            isConverter: false,
            name: "SHIELD Token",
            symbol: "SHIELD",
            decimals: 18,
            mintVerifier: await mockMintVerifier.getAddress(),
            withdrawVerifier: await mockWithdrawVerifier.getAddress(),
            transferVerifier: await mockTransferVerifier.getAddress(),
            burnVerifier: await mockBurnVerifier.getAddress()
        });
        await shieldToken.waitForDeployment();
        
        // Transfer ownership to game contract (simulating production setup)
        await rocketToken.transferOwnership(gameContract.address);
        await rocketToken.connect(gameContract).acceptOwnership();
        await shieldToken.transferOwnership(gameContract.address);
        await shieldToken.connect(gameContract).acceptOwnership();
    });

    describe("Deployment and eERC20 Integration", function () {
        it("Should deploy both ROCKET and SHIELD tokens with correct metadata", async function () {
            expect(await rocketToken.name()).to.equal("ROCKET Token");
            expect(await rocketToken.symbol()).to.equal("ROCKET");
            expect(await rocketToken.decimals()).to.equal(18);
            
            expect(await shieldToken.name()).to.equal("SHIELD Token");
            expect(await shieldToken.symbol()).to.equal("SHIELD");
            expect(await shieldToken.decimals()).to.equal(18);
        });

        it("Should inherit from EncryptedERC correctly", async function () {
            // Verify both tokens have eERC20 functions
            expect(typeof rocketToken.privateMint).to.equal("function");
            expect(typeof rocketToken.privateBurn).to.equal("function");
            expect(typeof rocketToken.transfer).to.equal("function");
            expect(typeof rocketToken.burnAllTokensFrom).to.equal("function");
            
            expect(typeof shieldToken.privateMint).to.equal("function");
            expect(typeof shieldToken.privateBurn).to.equal("function");
            expect(typeof shieldToken.transfer).to.equal("function");
            expect(typeof shieldToken.burnAllTokensFrom).to.equal("function");
            
            // Verify registrar is set
            expect(await rocketToken.registrar()).to.equal(await registrar.getAddress());
            expect(await shieldToken.registrar()).to.equal(await registrar.getAddress());
        });

        it("Should be owned by game contract after ownership transfer", async function () {
            expect(await rocketToken.owner()).to.equal(gameContract.address);
            expect(await shieldToken.owner()).to.equal(gameContract.address);
        });
    });

    describe("Burn Functionality", function () {
        it("Should allow owner (game contract) to burn all tokens from bunkers", async function () {
            const bunkers = [bunker1.address, bunker2.address, bunker3.address];
            
            await expect(
                rocketToken.connect(gameContract).burnAllTokensFrom(bunkers)
            ).to.emit(rocketToken, "AllTokensBurned")
            .withArgs(bunkers);
        });

        it("Should allow burning from empty bunker array", async function () {
            const bunkers: string[] = [];
            
            await expect(
                rocketToken.connect(gameContract).burnAllTokensFrom(bunkers)
            ).to.emit(rocketToken, "AllTokensBurned")
            .withArgs(bunkers);
        });

        it("Should skip zero addresses in bunker array", async function () {
            const bunkers = [bunker1.address, ethers.ZeroAddress, bunker2.address];
            
            // Should not revert, just skip zero address
            await expect(
                rocketToken.connect(gameContract).burnAllTokensFrom(bunkers)
            ).to.emit(rocketToken, "AllTokensBurned")
            .withArgs(bunkers);
        });

        it("Should not allow non-owner to burn tokens", async function () {
            const bunkers = [bunker1.address, bunker2.address];
            
            await expect(
                rocketToken.connect(unauthorizedUser).burnAllTokensFrom(bunkers)
            ).to.be.revertedWithCustomError(rocketToken, "OwnableUnauthorizedAccount");
        });

        it("Should work for both ROCKET and SHIELD tokens", async function () {
            const bunkers = [bunker1.address, bunker2.address];
            
            // Should work for ROCKET
            await expect(
                rocketToken.connect(gameContract).burnAllTokensFrom(bunkers)
            ).to.emit(rocketToken, "AllTokensBurned")
            .withArgs(bunkers);
            
            // Should work for SHIELD
            await expect(
                shieldToken.connect(gameContract).burnAllTokensFrom(bunkers)
            ).to.emit(shieldToken, "AllTokensBurned")
            .withArgs(bunkers);
        });

        it("Should handle large bunker arrays efficiently", async function () {
            const bunkers = [bunker1.address, bunker2.address, bunker3.address, bunker1.address, bunker2.address];
            
            await expect(
                rocketToken.connect(gameContract).burnAllTokensFrom(bunkers)
            ).to.emit(rocketToken, "AllTokensBurned")
            .withArgs(bunkers);
        });
    });

    describe("Access Control Integration", function () {
        it("Should maintain eERC20 functionality", async function () {
            // Test that original eERC20 functions still exist
            expect(typeof rocketToken.privateMint).to.equal("function");
            expect(typeof rocketToken.transfer).to.equal("function");
            expect(typeof rocketToken.privateBurn).to.equal("function");
            expect(typeof shieldToken.privateMint).to.equal("function");
            expect(typeof shieldToken.transfer).to.equal("function");
            expect(typeof shieldToken.privateBurn).to.equal("function");
        });

        it("Should support ownership transfers (Ownable2Step)", async function () {
            // Deploy new token to test ownership transfer
            const babyJubJubAddress = await deployLibrary(owner);
            const TokenFactory = await ethers.getContractFactory("WWIIIGameToken", {
                libraries: {
                    BabyJubJub: babyJubJubAddress,
                },
            });
            
            const newToken = await TokenFactory.deploy({
                registrar: await registrar.getAddress(),
                isConverter: false,
                name: "TEST Token",
                symbol: "TEST",
                decimals: 18,
                mintVerifier: await mockMintVerifier.getAddress(),
                withdrawVerifier: await mockWithdrawVerifier.getAddress(),
                transferVerifier: await mockTransferVerifier.getAddress(),
                burnVerifier: await mockBurnVerifier.getAddress()
            });
            
            // Should start owned by deployer
            expect(await newToken.owner()).to.equal(owner.address);
            
            // Transfer ownership
            await newToken.transferOwnership(gameContract.address);
            
            // Should still be owned by original owner until accepted
            expect(await newToken.owner()).to.equal(owner.address);
            
            // Accept ownership
            await newToken.connect(gameContract).acceptOwnership();
            
            // Should now be owned by game contract
            expect(await newToken.owner()).to.equal(gameContract.address);
        });
    });

    describe("Gas Cost Analysis", function () {
        it("Should measure gas costs for burn operations", async function () {
            // Single bunker burn
            const singleBunker = [bunker1.address];
            const singleTx = await rocketToken.connect(gameContract).burnAllTokensFrom(singleBunker);
            const singleReceipt = await singleTx.wait();
            console.log(`Single bunker burn gas cost: ${singleReceipt?.gasUsed.toString()}`);

            // Multiple bunker burn (typical game scenario with 5 bunkers)
            const allBunkers = [bunker1.address, bunker2.address, bunker3.address, bunker1.address, bunker2.address];
            const multipleTx = await rocketToken.connect(gameContract).burnAllTokensFrom(allBunkers);
            const multipleReceipt = await multipleTx.wait();
            console.log(`Five bunker burn gas cost: ${multipleReceipt?.gasUsed.toString()}`);
        });
    });

    describe("Unified Token Architecture", function () {
        it("Should use same contract code for both ROCKET and SHIELD", async function () {
            // Both should have identical function signatures
            expect(rocketToken.interface.format()).to.deep.equal(shieldToken.interface.format());
            
            // Both should respond to same functions
            const bunkers = [bunker1.address];
            
            await expect(rocketToken.connect(gameContract).burnAllTokensFrom(bunkers))
                .to.emit(rocketToken, "AllTokensBurned");
            await expect(shieldToken.connect(gameContract).burnAllTokensFrom(bunkers))
                .to.emit(shieldToken, "AllTokensBurned");
        });

        it("Should have independent state for ROCKET and SHIELD instances", async function () {
            // Even though they use the same code, they should have separate state
            expect(await rocketToken.getAddress()).to.not.equal(await shieldToken.getAddress());
            expect(await rocketToken.name()).to.not.equal(await shieldToken.name());
            expect(await rocketToken.symbol()).to.not.equal(await shieldToken.symbol());
        });
    });
});