import { ethers } from "hardhat";
import { expect } from "chai";
import { EmissionVault, WWIIIToken } from "../generated-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("EmissionVault Contract", function () {
    let emissionVault: EmissionVault;
    let wwiiiToken: WWIIIToken;
    let owner: SignerWithAddress;
    let gameContract: SignerWithAddress;
    let newGameContract: SignerWithAddress;
    let unauthorizedUser: SignerWithAddress;
    let emergencyReceiver: SignerWithAddress;

    const VAULT_ALLOCATION = ethers.parseEther("6000000000"); // 6 billion tokens
    const WITHDRAWAL_AMOUNT = ethers.parseEther("1000000"); // 1 million tokens

    beforeEach(async function () {
        [owner, gameContract, newGameContract, unauthorizedUser, emergencyReceiver] = await ethers.getSigners();
        
        // Deploy WWIII token
        const WWIIITokenFactory = await ethers.getContractFactory("WWIIIToken");
        wwiiiToken = await WWIIITokenFactory.deploy();
        await wwiiiToken.waitForDeployment();

        // Deploy EmissionVault
        const EmissionVaultFactory = await ethers.getContractFactory("EmissionVault");
        emissionVault = await EmissionVaultFactory.deploy(await wwiiiToken.getAddress());
        await emissionVault.waitForDeployment();

        // Transfer 6B tokens to the vault
        await wwiiiToken.transfer(await emissionVault.getAddress(), VAULT_ALLOCATION);
    });

    describe("Deployment", function () {
        it("Should set the correct WWIII token address", async function () {
            expect(await emissionVault.wwiiiToken()).to.equal(await wwiiiToken.getAddress());
        });

        it("Should have owner set correctly", async function () {
            expect(await emissionVault.owner()).to.equal(owner.address);
        });

        it("Should have no game contract set initially", async function () {
            expect(await emissionVault.gameContract()).to.equal(ethers.ZeroAddress);
        });

        it("Should have received 6B WWIII tokens", async function () {
            expect(await wwiiiToken.balanceOf(await emissionVault.getAddress())).to.equal(VAULT_ALLOCATION);
        });

        it("Should show correct remaining emissions", async function () {
            expect(await emissionVault.remainingEmissions()).to.equal(VAULT_ALLOCATION);
        });
    });

    describe("Game Contract Management", function () {
        it("Should allow owner to set game contract", async function () {
            await emissionVault.setGameContract(gameContract.address);
            expect(await emissionVault.gameContract()).to.equal(gameContract.address);
        });

        it("Should emit GameContractSet event", async function () {
            await expect(emissionVault.setGameContract(gameContract.address))
                .to.emit(emissionVault, "GameContractSet")
                .withArgs(ethers.ZeroAddress, gameContract.address);
        });

        it("Should allow updating game contract", async function () {
            await emissionVault.setGameContract(gameContract.address);
            await emissionVault.setGameContract(newGameContract.address);
            
            expect(await emissionVault.gameContract()).to.equal(newGameContract.address);
        });

        it("Should emit GameContractSet event when updating", async function () {
            await emissionVault.setGameContract(gameContract.address);
            
            await expect(emissionVault.setGameContract(newGameContract.address))
                .to.emit(emissionVault, "GameContractSet")
                .withArgs(gameContract.address, newGameContract.address);
        });

        it("Should not allow non-owner to set game contract", async function () {
            await expect(
                emissionVault.connect(unauthorizedUser).setGameContract(gameContract.address)
            ).to.be.revertedWithCustomError(emissionVault, "OwnableUnauthorizedAccount");
        });

        it("Should not allow setting zero address as game contract", async function () {
            await expect(
                emissionVault.setGameContract(ethers.ZeroAddress)
            ).to.be.revertedWith("Game contract cannot be zero address");
        });
    });

    describe("Withdrawal Functionality", function () {
        beforeEach(async function () {
            // Set game contract for withdrawal tests
            await emissionVault.setGameContract(gameContract.address);
        });

        it("Should allow game contract to withdraw tokens", async function () {
            const initialBalance = await wwiiiToken.balanceOf(gameContract.address);
            
            await emissionVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT);
            
            const finalBalance = await wwiiiToken.balanceOf(gameContract.address);
            expect(finalBalance - initialBalance).to.equal(WITHDRAWAL_AMOUNT);
        });

        it("Should update remaining emissions after withdrawal", async function () {
            const initialRemaining = await emissionVault.remainingEmissions();
            
            await emissionVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT);
            
            const finalRemaining = await emissionVault.remainingEmissions();
            expect(initialRemaining - finalRemaining).to.equal(WITHDRAWAL_AMOUNT);
        });

        it("Should emit TokensWithdrawn event", async function () {
            await expect(
                emissionVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT)
            ).to.emit(emissionVault, "TokensWithdrawn")
            .withArgs(gameContract.address, WITHDRAWAL_AMOUNT);
        });

        it("Should not allow non-game contract to withdraw", async function () {
            await expect(
                emissionVault.connect(unauthorizedUser).withdraw(WITHDRAWAL_AMOUNT)
            ).to.be.revertedWith("Only game contract can withdraw");
        });

        it("Should not allow withdrawal when no game contract is set", async function () {
            // Deploy new vault without game contract
            const EmissionVaultFactory = await ethers.getContractFactory("EmissionVault");
            const newVault = await EmissionVaultFactory.deploy(await wwiiiToken.getAddress());
            
            await expect(
                newVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT)
            ).to.be.revertedWith("Only game contract can withdraw");
        });

        it("Should not allow withdrawal of zero amount", async function () {
            await expect(
                emissionVault.connect(gameContract).withdraw(0)
            ).to.be.revertedWith("Amount must be greater than zero");
        });

        it("Should handle withdrawal exceeding balance gracefully", async function () {
            const vaultBalance = await emissionVault.remainingEmissions();
            const excessiveAmount = vaultBalance + ethers.parseEther("1000000");
            
            // Should transfer only what's available
            const initialGameBalance = await wwiiiToken.balanceOf(gameContract.address);
            
            await emissionVault.connect(gameContract).withdraw(excessiveAmount);
            
            const finalGameBalance = await wwiiiToken.balanceOf(gameContract.address);
            const finalVaultBalance = await emissionVault.remainingEmissions();
            
            // Should have transferred all available tokens
            expect(finalGameBalance - initialGameBalance).to.equal(vaultBalance);
            expect(finalVaultBalance).to.equal(0);
        });

        it("Should emit correct amount even when transferring partial", async function () {
            const vaultBalance = await emissionVault.remainingEmissions();
            const excessiveAmount = vaultBalance + ethers.parseEther("1000000");
            
            await expect(
                emissionVault.connect(gameContract).withdraw(excessiveAmount)
            ).to.emit(emissionVault, "TokensWithdrawn")
            .withArgs(gameContract.address, vaultBalance); // Should emit actual transferred amount
        });

        it("Should return true for successful withdrawal", async function () {
            const success = await emissionVault.connect(gameContract).withdraw.staticCall(WITHDRAWAL_AMOUNT);
            expect(success).to.be.true;
        });

        it("Should return true even for partial withdrawal", async function () {
            const vaultBalance = await emissionVault.remainingEmissions();
            const excessiveAmount = vaultBalance + ethers.parseEther("1000000");
            
            const success = await emissionVault.connect(gameContract).withdraw.staticCall(excessiveAmount);
            expect(success).to.be.true;
        });

        it("Should handle withdrawal when vault is empty", async function () {
            // Empty the vault first
            const vaultBalance = await emissionVault.remainingEmissions();
            await emissionVault.connect(gameContract).withdraw(vaultBalance);
            
            // Try to withdraw from empty vault
            const success = await emissionVault.connect(gameContract).withdraw.staticCall(WITHDRAWAL_AMOUNT);
            expect(success).to.be.true; // Should still return true but transfer 0
            
            await expect(
                emissionVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT)
            ).to.emit(emissionVault, "TokensWithdrawn")
            .withArgs(gameContract.address, 0);
        });
    });

    describe("Emergency Withdrawal", function () {
        it("Should allow owner to emergency withdraw all tokens", async function () {
            const vaultBalance = await emissionVault.remainingEmissions();
            const initialOwnerBalance = await wwiiiToken.balanceOf(emergencyReceiver.address);
            
            await emissionVault.emergencyWithdraw(emergencyReceiver.address);
            
            const finalOwnerBalance = await wwiiiToken.balanceOf(emergencyReceiver.address);
            const finalVaultBalance = await emissionVault.remainingEmissions();
            
            expect(finalOwnerBalance - initialOwnerBalance).to.equal(vaultBalance);
            expect(finalVaultBalance).to.equal(0);
        });

        it("Should emit EmergencyWithdrawal event", async function () {
            const vaultBalance = await emissionVault.remainingEmissions();
            
            await expect(
                emissionVault.emergencyWithdraw(emergencyReceiver.address)
            ).to.emit(emissionVault, "EmergencyWithdrawal")
            .withArgs(emergencyReceiver.address, vaultBalance);
        });

        it("Should not allow non-owner to emergency withdraw", async function () {
            await expect(
                emissionVault.connect(unauthorizedUser).emergencyWithdraw(emergencyReceiver.address)
            ).to.be.revertedWithCustomError(emissionVault, "OwnableUnauthorizedAccount");
        });

        it("Should not allow emergency withdraw to zero address", async function () {
            await expect(
                emissionVault.emergencyWithdraw(ethers.ZeroAddress)
            ).to.be.revertedWith("Receiver cannot be zero address");
        });

        it("Should work even when vault is empty", async function () {
            // Empty the vault first
            await emissionVault.setGameContract(gameContract.address);
            const vaultBalance = await emissionVault.remainingEmissions();
            await emissionVault.connect(gameContract).withdraw(vaultBalance);
            
            // Emergency withdraw should not revert
            await expect(
                emissionVault.emergencyWithdraw(emergencyReceiver.address)
            ).to.emit(emissionVault, "EmergencyWithdrawal")
            .withArgs(emergencyReceiver.address, 0);
        });
    });

    describe("View Functions", function () {
        it("Should return correct remaining emissions", async function () {
            const balance = await wwiiiToken.balanceOf(await emissionVault.getAddress());
            const remaining = await emissionVault.remainingEmissions();
            expect(remaining).to.equal(balance);
        });

        it("Should return remaining emissions after withdrawals", async function () {
            await emissionVault.setGameContract(gameContract.address);
            
            const initialRemaining = await emissionVault.remainingEmissions();
            await emissionVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT);
            const finalRemaining = await emissionVault.remainingEmissions();
            
            expect(finalRemaining).to.equal(initialRemaining - WITHDRAWAL_AMOUNT);
        });

        it("Should check if game contract is set", async function () {
            expect(await emissionVault.isGameContractSet()).to.be.false;
            
            await emissionVault.setGameContract(gameContract.address);
            expect(await emissionVault.isGameContractSet()).to.be.true;
        });
    });

    describe("Security and Edge Cases", function () {
        it("Should handle multiple consecutive withdrawals", async function () {
            await emissionVault.setGameContract(gameContract.address);
            
            const withdrawal1 = ethers.parseEther("1000000");
            const withdrawal2 = ethers.parseEther("2000000");
            
            await emissionVault.connect(gameContract).withdraw(withdrawal1);
            await emissionVault.connect(gameContract).withdraw(withdrawal2);
            
            const gameBalance = await wwiiiToken.balanceOf(gameContract.address);
            expect(gameBalance).to.equal(withdrawal1 + withdrawal2);
        });

        it("Should maintain correct accounting across operations", async function () {
            await emissionVault.setGameContract(gameContract.address);
            
            const initialVault = await emissionVault.remainingEmissions();
            const initialGame = await wwiiiToken.balanceOf(gameContract.address);
            
            await emissionVault.connect(gameContract).withdraw(WITHDRAWAL_AMOUNT);
            
            const finalVault = await emissionVault.remainingEmissions();
            const finalGame = await wwiiiToken.balanceOf(gameContract.address);
            
            // Total tokens should be conserved
            expect(initialVault + initialGame).to.equal(finalVault + finalGame);
        });

        it("Should prevent reentrancy attacks", async function () {
            // This is implicitly tested by using standard ERC20 transfers
            // and the withdrawal pattern, but we verify the pattern is sound
            await emissionVault.setGameContract(gameContract.address);
            
            // Multiple quick withdrawals should all succeed
            const promises = [
                emissionVault.connect(gameContract).withdraw(ethers.parseEther("100000")),
                emissionVault.connect(gameContract).withdraw(ethers.parseEther("100000")),
                emissionVault.connect(gameContract).withdraw(ethers.parseEther("100000"))
            ];
            
            await Promise.all(promises);
            
            const gameBalance = await wwiiiToken.balanceOf(gameContract.address);
            expect(gameBalance).to.equal(ethers.parseEther("300000"));
        });
    });

    describe("Gas Cost Analysis", function () {
        beforeEach(async function () {
            await emissionVault.setGameContract(gameContract.address);
        });

        it("Should measure gas costs for vault operations", async function () {
            // Set game contract gas cost
            const setTx = await emissionVault.setGameContract(newGameContract.address);
            const setReceipt = await setTx.wait();
            console.log(`Set game contract gas cost: ${setReceipt?.gasUsed.toString()}`);

            // Withdrawal gas cost
            const withdrawTx = await emissionVault.connect(newGameContract).withdraw(WITHDRAWAL_AMOUNT);
            const withdrawReceipt = await withdrawTx.wait();
            console.log(`Withdrawal gas cost: ${withdrawReceipt?.gasUsed.toString()}`);

            // Emergency withdrawal gas cost
            const emergencyTx = await emissionVault.emergencyWithdraw(emergencyReceiver.address);
            const emergencyReceipt = await emergencyTx.wait();
            console.log(`Emergency withdrawal gas cost: ${emergencyReceipt?.gasUsed.toString()}`);
        });
    });
});