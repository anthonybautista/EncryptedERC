// SPDX-License-Identifier: UNLICENSED
// Copyright 2025, Smolrun LLC

import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { 
    Bunker,
    WWIIIGameToken,
    WWIIIToken,
    Registrar
} from "../generated-types";
import { User } from "./user";
import { deployVerifiers, deployLibrary } from "./helpers";

describe("Bunker Contract", function () {
    let bunker: Bunker;
    let rocketToken: WWIIIGameToken;
    let shieldToken: WWIIIGameToken;
    let wwiiiToken: WWIIIToken;
    let registrar: Registrar;
    let gameContract: SignerWithAddress;
    let owner: SignerWithAddress;
    let player1: SignerWithAddress;
    let player2: SignerWithAddress;
    let unauthorized: SignerWithAddress;
    
    let bunkerUser: User; // Bunker's cryptographic identity (keys held by Waracle)
    
    const BUNKER_ID = 1;
    
    beforeEach(async function () {
        [owner, gameContract, player1, player2, unauthorized] = await ethers.getSigners();
        
        // Create unique cryptographic identity for this specific bunker
        // IMPORTANT: In production, each bunker (1-5) MUST have its own unique BabyJubJub key pair:
        // - Bunker 1: Private key K1, Public key P1
        // - Bunker 2: Private key K2, Public key P2  
        // - Bunker 3: Private key K3, Public key P3
        // - Bunker 4: Private key K4, Public key P4
        // - Bunker 5: Private key K5, Public key P5
        // 
        // Waracle holds ALL private keys (K1-K5) off-chain to decrypt combat tokens:
        // - ROCKET tokens to Bunker 3 are encrypted with P3, decrypted with K3
        // - SHIELD tokens to Bunker 1 are encrypted with P1, decrypted with K1
        // 
        // This test uses the same key for all bunkers for simplicity, but deployment
        // scripts MUST generate unique keys for each bunker contract.
        bunkerUser = new User(owner); // Using owner as registration signer for simplicity
        
        // Deploy eERC20 infrastructure
        const { 
            registrationVerifier,
            mintVerifier, 
            withdrawVerifier, 
            transferVerifier, 
            burnVerifier 
        } = await deployVerifiers(owner, false);
        const babyJubJub = await deployLibrary(owner);
        
        const RegistrarFactory = await ethers.getContractFactory("Registrar");
        registrar = await RegistrarFactory.deploy(registrationVerifier);
        await registrar.waitForDeployment();
        
        // Deploy WWIII token (standard ERC20)
        const WWIIIFactory = await ethers.getContractFactory("WWIIIToken");
        wwiiiToken = await WWIIIFactory.deploy();
        await wwiiiToken.waitForDeployment();
        
        // Deploy ROCKET token (encrypted ERC20)
        const TokenFactory = await ethers.getContractFactory("WWIIIGameToken", {
            libraries: {
                "contracts/libraries/BabyJubJub.sol:BabyJubJub": babyJubJub,
            },
        });
        rocketToken = await TokenFactory.deploy({
            registrar: await registrar.getAddress(),
            isConverter: false,
            name: "ROCKET",
            symbol: "ROCKET",
            decimals: 18,
            mintVerifier,
            withdrawVerifier,
            transferVerifier,
            burnVerifier
        });
        await rocketToken.waitForDeployment();
        
        // Deploy SHIELD token (encrypted ERC20)
        shieldToken = await TokenFactory.deploy({
            registrar: await registrar.getAddress(),
            isConverter: false,
            name: "SHIELD",
            symbol: "SHIELD", 
            decimals: 18,
            mintVerifier,
            withdrawVerifier,
            transferVerifier,
            burnVerifier
        });
        await shieldToken.waitForDeployment();
        
        // Deploy Bunker contract with bunker's public key
        const BunkerFactory = await ethers.getContractFactory("Bunker");
        bunker = await BunkerFactory.deploy(
            BUNKER_ID,
            await wwiiiToken.getAddress()
        );
        await bunker.waitForDeployment();
        
        // Set bunker public key after deployment
        await bunker.setBunkerPublicKey([bunkerUser.publicKey[0], bunkerUser.publicKey[1]]);
        
        // Set game contract after deployment
        await bunker.updateGameContract(gameContract.address);
        
        // Give players some WWIII tokens for testing
        await wwiiiToken.transfer(player1.address, ethers.parseEther("100000"));
        await wwiiiToken.transfer(player2.address, ethers.parseEther("100000"));
        await wwiiiToken.transfer(gameContract.address, ethers.parseEther("100000"));
    });
    
    describe("Deployment", function () {
        it("should set correct bunker ID", async function () {
            expect(await bunker.bunkerId()).to.equal(BUNKER_ID);
        });
        
        it("should set correct game contract", async function () {
            expect(await bunker.gameContract()).to.equal(gameContract.address);
        });
        
        it("should set correct WWIII token address", async function () {
            expect(await bunker.wwiiiToken()).to.equal(await wwiiiToken.getAddress());
        });
        
        it("should set correct bunker public key", async function () {
            const storedKey = await bunker.getBunkerPublicKey();
            expect(storedKey[0]).to.equal(bunkerUser.publicKey[0]);
            expect(storedKey[1]).to.equal(bunkerUser.publicKey[1]);
        });
        
        it("should start with zero token balance", async function () {
            expect(await bunker.getTokenBalance()).to.equal(0);
        });
        
        it("should grant max approval to game contract", async function () {
            const approval = await wwiiiToken.allowance(await bunker.getAddress(), gameContract.address);
            expect(approval).to.equal(ethers.MaxUint256);
        });
        
        it("should revert for invalid bunker ID", async function () {
            const BunkerFactory = await ethers.getContractFactory("Bunker");
            
            await expect(
                BunkerFactory.deploy(
                    0, // Invalid ID
                    await wwiiiToken.getAddress()
                )
            ).to.be.revertedWithCustomError(bunker, "InvalidAmount");
            
            await expect(
                BunkerFactory.deploy(
                    6, // Invalid ID
                    await wwiiiToken.getAddress()
                )
            ).to.be.revertedWithCustomError(bunker, "InvalidAmount");
        });
        
        it("should revert for zero addresses", async function () {
            const BunkerFactory = await ethers.getContractFactory("Bunker");
            
            await expect(
                BunkerFactory.deploy(
                    BUNKER_ID,
                    ethers.ZeroAddress // Invalid token
                )
            ).to.be.revertedWithCustomError(bunker, "InvalidAddress");
        });
    });
    
    describe("Token Management via Game Contract", function () {
        describe("Deposits", function () {
            it("should allow game contract to deposit tokens via transferFrom", async function () {
                const depositAmount = ethers.parseEther("10000");
                
                // Player approves game contract
                await wwiiiToken.connect(player1).approve(gameContract.address, depositAmount);
                
                // Game contract transfers tokens to bunker
                await wwiiiToken.connect(gameContract).transferFrom(
                    player1.address,
                    await bunker.getAddress(),
                    depositAmount
                );
                
                expect(await bunker.getTokenBalance()).to.equal(depositAmount);
            });
            
            it("should accumulate multiple deposits", async function () {
                const amount1 = ethers.parseEther("10000");
                const amount2 = ethers.parseEther("15000");
                
                // Setup approvals
                await wwiiiToken.connect(player1).approve(gameContract.address, amount1);
                await wwiiiToken.connect(player2).approve(gameContract.address, amount2);
                
                // Game contract deposits for both players
                await wwiiiToken.connect(gameContract).transferFrom(player1.address, await bunker.getAddress(), amount1);
                await wwiiiToken.connect(gameContract).transferFrom(player2.address, await bunker.getAddress(), amount2);
                
                expect(await bunker.getTokenBalance()).to.equal(amount1 + amount2);
            });
        });
        
        describe("Transfers Between Bunkers", function () {
            let bunker2: Bunker;
            
            beforeEach(async function () {
                // Deploy second bunker
                const BunkerFactory = await ethers.getContractFactory("Bunker");
                bunker2 = await BunkerFactory.deploy(
                    2,
                    await wwiiiToken.getAddress()
                );
                await bunker2.waitForDeployment();
                
                // Set bunker public key after deployment
                await bunker2.setBunkerPublicKey([bunkerUser.publicKey[0], bunkerUser.publicKey[1]]);
                
                // Set game contract after deployment
                await bunker2.updateGameContract(gameContract.address);
                
                // Setup initial balance in bunker 1
                const initialAmount = ethers.parseEther("20000");
                await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), initialAmount);
            });
            
            it("should allow game contract to transfer tokens between bunkers", async function () {
                const transferAmount = ethers.parseEther("5000");
                const initialBalance = await bunker.getTokenBalance();
                
                // Game contract transfers from bunker1 to bunker2
                await wwiiiToken.connect(gameContract).transferFrom(
                    await bunker.getAddress(),
                    await bunker2.getAddress(),
                    transferAmount
                );
                
                expect(await bunker.getTokenBalance()).to.equal(initialBalance - transferAmount);
                expect(await bunker2.getTokenBalance()).to.equal(transferAmount);
            });
            
            it("should handle multiple transfers correctly", async function () {
                const transfer1 = ethers.parseEther("3000");
                const transfer2 = ethers.parseEther("7000");
                const initialBalance = await bunker.getTokenBalance();
                
                await wwiiiToken.connect(gameContract).transferFrom(
                    await bunker.getAddress(),
                    await bunker2.getAddress(),
                    transfer1
                );
                
                await wwiiiToken.connect(gameContract).transferFrom(
                    await bunker.getAddress(),
                    await bunker2.getAddress(),
                    transfer2
                );
                
                expect(await bunker.getTokenBalance()).to.equal(initialBalance - transfer1 - transfer2);
                expect(await bunker2.getTokenBalance()).to.equal(transfer1 + transfer2);
            });
        });
        
        describe("Withdrawals to Players", function () {
            beforeEach(async function () {
                // Setup initial balance in bunker
                const initialAmount = ethers.parseEther("30000");
                await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), initialAmount);
            });
            
            it("should allow game contract to withdraw tokens to players", async function () {
                const withdrawAmount = ethers.parseEther("8000");
                const initialBunkerBalance = await bunker.getTokenBalance();
                const initialPlayerBalance = await wwiiiToken.balanceOf(player1.address);
                
                // Game contract withdraws tokens to player
                await wwiiiToken.connect(gameContract).transferFrom(
                    await bunker.getAddress(),
                    player1.address,
                    withdrawAmount
                );
                
                expect(await bunker.getTokenBalance()).to.equal(initialBunkerBalance - withdrawAmount);
                expect(await wwiiiToken.balanceOf(player1.address)).to.equal(initialPlayerBalance + withdrawAmount);
            });
            
            it("should handle partial withdrawal when bunker has insufficient balance", async function () {
                const bunkerBalance = await bunker.getTokenBalance();
                const withdrawAmount = bunkerBalance + ethers.parseEther("1000"); // More than available
                
                // Should revert when trying to withdraw more than available
                await expect(
                    wwiiiToken.connect(gameContract).transferFrom(
                        await bunker.getAddress(),
                        player1.address,
                        withdrawAmount
                    )
                ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InsufficientBalance");
            });
        });
        
        describe("Token Burning", function () {
            beforeEach(async function () {
                // Setup initial balance in bunker
                const initialAmount = ethers.parseEther("25000");
                await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), initialAmount);
            });
            
            it("should allow game contract to burn tokens to dead address", async function () {
                const burnAmount = ethers.parseEther("5000");
                const initialBunkerBalance = await bunker.getTokenBalance();
                const initialDeadBalance = await wwiiiToken.balanceOf(await bunker.DEAD_ADDRESS());
                
                // Game contract burns tokens
                await wwiiiToken.connect(gameContract).transferFrom(
                    await bunker.getAddress(),
                    await bunker.DEAD_ADDRESS(),
                    burnAmount
                );
                
                expect(await bunker.getTokenBalance()).to.equal(initialBunkerBalance - burnAmount);
                expect(await wwiiiToken.balanceOf(await bunker.DEAD_ADDRESS())).to.equal(initialDeadBalance + burnAmount);
            });
            
            it("should handle burning entire bunker balance", async function () {
                const bunkerBalance = await bunker.getTokenBalance();
                
                // Burn all tokens
                await wwiiiToken.connect(gameContract).transferFrom(
                    await bunker.getAddress(),
                    await bunker.DEAD_ADDRESS(),
                    bunkerBalance
                );
                
                expect(await bunker.getTokenBalance()).to.equal(0);
            });
        });
    });
    
    describe("Game Contract Management", function () {
        it("should allow owner to update game contract", async function () {
            const newGameContract = player1.address; // Using player1 as new game contract for test
            
            await expect(bunker.connect(owner).updateGameContract(newGameContract))
                .to.emit(bunker, "GameContractUpdated")
                .withArgs(gameContract.address, newGameContract);
            
            expect(await bunker.gameContract()).to.equal(newGameContract);
            
            // Should revoke approval from old contract
            const oldApproval = await wwiiiToken.allowance(await bunker.getAddress(), gameContract.address);
            expect(oldApproval).to.equal(0);
            
            // Should grant max approval to new contract
            const newApproval = await wwiiiToken.allowance(await bunker.getAddress(), newGameContract);
            expect(newApproval).to.equal(ethers.MaxUint256);
        });
        
        it("should prevent non-owner from updating game contract", async function () {
            await expect(
                bunker.connect(unauthorized).updateGameContract(player1.address)
            ).to.be.revertedWithCustomError(bunker, "OwnableUnauthorizedAccount");
        });
        
        it("should reject zero address for new game contract", async function () {
            await expect(
                bunker.connect(owner).updateGameContract(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(bunker, "InvalidAddress");
        });
    });
    
    describe("Emergency Functions", function () {
        beforeEach(async function () {
            // Setup balance for emergency withdrawal test
            const amount = ethers.parseEther("50000");
            await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), amount);
        });
        
        it("should allow owner to perform emergency withdrawal", async function () {
            const bunkerBalance = await bunker.getTokenBalance();
            const receiverInitialBalance = await wwiiiToken.balanceOf(player1.address);
            
            await expect(bunker.connect(owner).emergencyWithdraw(player1.address))
                .to.emit(bunker, "EmergencyWithdrawal")
                .withArgs(player1.address, bunkerBalance);
            
            expect(await bunker.getTokenBalance()).to.equal(0);
            expect(await wwiiiToken.balanceOf(player1.address)).to.equal(receiverInitialBalance + bunkerBalance);
        });
        
        it("should prevent non-owner from emergency withdrawal", async function () {
            await expect(
                bunker.connect(unauthorized).emergencyWithdraw(player1.address)
            ).to.be.revertedWithCustomError(bunker, "OwnableUnauthorizedAccount");
        });
        
        it("should reject zero address for emergency withdrawal", async function () {
            await expect(
                bunker.connect(owner).emergencyWithdraw(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(bunker, "InvalidAddress");
        });
        
        it("should handle emergency withdrawal with zero balance", async function () {
            // Empty the bunker first
            const balance = await bunker.getTokenBalance();
            await wwiiiToken.connect(gameContract).transferFrom(
                await bunker.getAddress(),
                player1.address,
                balance
            );
            
            await expect(bunker.connect(owner).emergencyWithdraw(player2.address))
                .to.emit(bunker, "EmergencyWithdrawal")
                .withArgs(player2.address, 0);
        });
    });
    
    describe("View Functions", function () {
        beforeEach(async function () {
            // Setup test scenario
            const amount = ethers.parseEther("40000");
            await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), amount);
        });
        
        it("should return correct token balance", async function () {
            const expectedBalance = ethers.parseEther("40000");
            expect(await bunker.getTokenBalance()).to.equal(expectedBalance);
        });
        
        it("should return correct bunker public key", async function () {
            const publicKey = await bunker.getBunkerPublicKey();
            expect(publicKey[0]).to.equal(bunkerUser.publicKey[0]);
            expect(publicKey[1]).to.equal(bunkerUser.publicKey[1]);
        });
        
        it("should return complete bunker info", async function () {
            const info = await bunker.getBunkerInfo();
            
            expect(info.id).to.equal(BUNKER_ID);
            expect(info.balance).to.equal(ethers.parseEther("40000"));
            expect(info.publicKey[0]).to.equal(bunkerUser.publicKey[0]);
            expect(info.publicKey[1]).to.equal(bunkerUser.publicKey[1]);
        });
    });
    
    describe("Access Control", function () {
        it("should prevent unauthorized transfers", async function () {
            // Setup balance
            await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), ethers.parseEther("10000"));
            
            // Unauthorized user cannot transfer from bunker
            await expect(
                wwiiiToken.connect(unauthorized).transferFrom(
                    await bunker.getAddress(),
                    player1.address,
                    ethers.parseEther("1000")
                )
            ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InsufficientAllowance");
        });
        
        it("should only allow game contract to use the approval", async function () {
            // Setup balance
            await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), ethers.parseEther("10000"));
            
            // Only game contract can use the max approval
            await wwiiiToken.connect(gameContract).transferFrom(
                await bunker.getAddress(),
                player1.address,
                ethers.parseEther("1000")
            );
            
            // Other accounts cannot
            await expect(
                wwiiiToken.connect(player1).transferFrom(
                    await bunker.getAddress(),
                    player2.address,
                    ethers.parseEther("1000")
                )
            ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InsufficientAllowance");
        });
    });
    
    describe("Gas Cost Analysis", function () {
        it("should measure gas costs for common operations", async function () {
            // Deployment cost is measured automatically
            const deploymentTx = await bunker.deploymentTransaction();
            console.log(`Bunker deployment gas: ${deploymentTx?.gasLimit}`);
            
            // Game contract update
            const updateTx = await bunker.connect(owner).updateGameContract(player1.address);
            const updateReceipt = await updateTx.wait();
            console.log(`Game contract update gas: ${updateReceipt?.gasUsed}`);
            
            // Emergency withdrawal
            await wwiiiToken.connect(gameContract).transfer(await bunker.getAddress(), ethers.parseEther("1000"));
            const emergencyTx = await bunker.connect(owner).emergencyWithdraw(player1.address);
            const emergencyReceipt = await emergencyTx.wait();
            console.log(`Emergency withdrawal gas: ${emergencyReceipt?.gasUsed}`);
            
            // All operations should be reasonable for Avalanche
            expect(updateReceipt?.gasUsed).to.be.lessThan(100000n);
            expect(emergencyReceipt?.gasUsed).to.be.lessThan(100000n);
        });
    });
});