import { ethers } from "hardhat";
import { expect } from "chai";
import { WWIIIToken } from "../generated-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WWIII Token Contract", function () {
    this.timeout(300000); // 5 minutes
    let wwiiiToken: WWIIIToken;
    let owner: SignerWithAddress;
    let addr1: SignerWithAddress;
    let addr2: SignerWithAddress;
    let addrs: SignerWithAddress[];

    const TOTAL_SUPPLY = ethers.parseEther("10000000000"); // 10 billion tokens
    const VAULT_ALLOCATION = ethers.parseEther("6000000000"); // 6 billion for vault
    const TEAM_ALLOCATION = ethers.parseEther("2000000000"); // 2 billion for team
    const CIRCULATION_ALLOCATION = ethers.parseEther("2000000000"); // 2 billion for circulation

    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        
        const WWIIITokenFactory = await ethers.getContractFactory("WWIIIToken");
        wwiiiToken = await WWIIITokenFactory.deploy();
        await wwiiiToken.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should have correct name and symbol", async function () {
            expect(await wwiiiToken.name()).to.equal("WWIII Token");
            expect(await wwiiiToken.symbol()).to.equal("WWIII");
        });

        it("Should have 18 decimals", async function () {
            expect(await wwiiiToken.decimals()).to.equal(18);
        });

        it("Should have total supply of 10 billion tokens", async function () {
            expect(await wwiiiToken.totalSupply()).to.equal(TOTAL_SUPPLY);
        });

        it("Should mint all tokens to deployer initially", async function () {
            expect(await wwiiiToken.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY);
        });

        it("Should have fixed supply (no mint function)", async function () {
            // Verify contract doesn't have mint function
            expect(wwiiiToken.mint).to.be.undefined;
        });
    });

    describe("Initial Distribution", function () {
        it("Should allow distribution to vault, team, and circulation", async function () {
            const vaultAddress = addr1.address;
            const teamAddress = addr2.address;
            const circulationAddress = addrs[0].address;

            // Transfer to vault
            await wwiiiToken.transfer(vaultAddress, VAULT_ALLOCATION);
            expect(await wwiiiToken.balanceOf(vaultAddress)).to.equal(VAULT_ALLOCATION);

            // Transfer to team
            await wwiiiToken.transfer(teamAddress, TEAM_ALLOCATION);
            expect(await wwiiiToken.balanceOf(teamAddress)).to.equal(TEAM_ALLOCATION);

            // Transfer to circulation
            await wwiiiToken.transfer(circulationAddress, CIRCULATION_ALLOCATION);
            expect(await wwiiiToken.balanceOf(circulationAddress)).to.equal(CIRCULATION_ALLOCATION);

            // Owner should have 0 remaining
            expect(await wwiiiToken.balanceOf(owner.address)).to.equal(0);
        });
    });

    describe("Standard ERC20 Functionality", function () {
        beforeEach(async function () {
            // Give addr1 some tokens for testing
            await wwiiiToken.transfer(addr1.address, ethers.parseEther("1000"));
        });

        it("Should transfer tokens correctly", async function () {
            const transferAmount = ethers.parseEther("100");
            
            await wwiiiToken.connect(addr1).transfer(addr2.address, transferAmount);
            
            expect(await wwiiiToken.balanceOf(addr1.address)).to.equal(
                ethers.parseEther("900")
            );
            expect(await wwiiiToken.balanceOf(addr2.address)).to.equal(transferAmount);
        });

        it("Should handle approval and transferFrom", async function () {
            const approvalAmount = ethers.parseEther("500");
            const transferAmount = ethers.parseEther("200");

            // addr1 approves addr2 to spend tokens
            await wwiiiToken.connect(addr1).approve(addr2.address, approvalAmount);
            expect(await wwiiiToken.allowance(addr1.address, addr2.address)).to.equal(approvalAmount);

            // addr2 transfers from addr1 to another address
            await wwiiiToken.connect(addr2).transferFrom(addr1.address, addrs[0].address, transferAmount);

            expect(await wwiiiToken.balanceOf(addr1.address)).to.equal(
                ethers.parseEther("800")
            );
            expect(await wwiiiToken.balanceOf(addrs[0].address)).to.equal(transferAmount);
            expect(await wwiiiToken.allowance(addr1.address, addr2.address)).to.equal(
                approvalAmount - transferAmount
            );
        });

        it("Should emit Transfer events", async function () {
            const transferAmount = ethers.parseEther("100");
            
            await expect(wwiiiToken.connect(addr1).transfer(addr2.address, transferAmount))
                .to.emit(wwiiiToken, "Transfer")
                .withArgs(addr1.address, addr2.address, transferAmount);
        });

        it("Should emit Approval events", async function () {
            const approvalAmount = ethers.parseEther("500");
            
            await expect(wwiiiToken.connect(addr1).approve(addr2.address, approvalAmount))
                .to.emit(wwiiiToken, "Approval")
                .withArgs(addr1.address, addr2.address, approvalAmount);
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should revert transfer to zero address", async function () {
            await expect(
                wwiiiToken.transfer(ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InvalidReceiver");
        });

        it("Should revert transfer exceeding balance", async function () {
            await expect(
                wwiiiToken.connect(addr1).transfer(addr2.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InsufficientBalance");
        });

        it("Should revert transferFrom exceeding allowance", async function () {
            await wwiiiToken.connect(addr1).approve(addr2.address, ethers.parseEther("100"));
            
            await expect(
                wwiiiToken.connect(addr2).transferFrom(addr1.address, addrs[0].address, ethers.parseEther("200"))
            ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InsufficientAllowance");
        });

        it("Should handle approve to zero address", async function () {
            await expect(
                wwiiiToken.approve(ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(wwiiiToken, "ERC20InvalidSpender");
        });

        it("Should not overflow on maximum values", async function () {
            // Test with maximum possible values
            const maxUint256 = ethers.MaxUint256;
            
            // This should not cause overflow (already at max supply)
            expect(await wwiiiToken.totalSupply()).to.be.lte(maxUint256);
        });
    });

    describe("Supply Invariants", function () {
        it("Should maintain constant total supply", async function () {
            const initialSupply = await wwiiiToken.totalSupply();
            
            // Perform various transfers
            await wwiiiToken.transfer(addr1.address, ethers.parseEther("1000"));
            await wwiiiToken.transfer(addr2.address, ethers.parseEther("2000"));
            await wwiiiToken.connect(addr1).transfer(addr2.address, ethers.parseEther("500"));
            
            // Total supply should remain unchanged
            expect(await wwiiiToken.totalSupply()).to.equal(initialSupply);
        });

        it("Should have sum of all balances equal total supply", async function () {
            const totalSupply = await wwiiiToken.totalSupply();
            
            // Distribute tokens to multiple addresses
            await wwiiiToken.transfer(addr1.address, ethers.parseEther("1000"));
            await wwiiiToken.transfer(addr2.address, ethers.parseEther("2000"));
            await wwiiiToken.transfer(addrs[0].address, ethers.parseEther("3000"));
            
            const ownerBalance = await wwiiiToken.balanceOf(owner.address);
            const addr1Balance = await wwiiiToken.balanceOf(addr1.address);
            const addr2Balance = await wwiiiToken.balanceOf(addr2.address);
            const addr3Balance = await wwiiiToken.balanceOf(addrs[0].address);
            
            const sumOfBalances = ownerBalance + addr1Balance + addr2Balance + addr3Balance;
            expect(sumOfBalances).to.equal(totalSupply);
        });
    });

    describe("Gas Cost Analysis", function () {
        it("Should measure gas costs for basic operations", async function () {
            // Transfer gas cost
            const transferTx = await wwiiiToken.transfer(addr1.address, ethers.parseEther("1000"));
            const transferReceipt = await transferTx.wait();
            console.log(`Transfer gas cost: ${transferReceipt?.gasUsed.toString()}`);

            // Approval gas cost
            const approveTx = await wwiiiToken.connect(addr1).approve(addr2.address, ethers.parseEther("500"));
            const approveReceipt = await approveTx.wait();
            console.log(`Approval gas cost: ${approveReceipt?.gasUsed.toString()}`);

            // TransferFrom gas cost
            const transferFromTx = await wwiiiToken.connect(addr2).transferFrom(
                addr1.address, 
                addrs[0].address, 
                ethers.parseEther("100")
            );
            const transferFromReceipt = await transferFromTx.wait();
            console.log(`TransferFrom gas cost: ${transferFromReceipt?.gasUsed.toString()}`);
        });
    });
});