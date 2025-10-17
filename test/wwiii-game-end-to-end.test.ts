// WWIII Game End-to-End Integration Test
// Tests the complete production flow: registration → attack → mint → decrypt → burn

import { expect } from "chai";
import { ethers, zkit } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { WWIIIGame, WWIIIToken, EmissionVault, WWIIIGameToken, Registrar } from "../typechain-types";
import { deployGameVerifiers, deployLibrary, getFutureTimestamp, privateMint, getDecryptedBalance } from "./helpers";
import { poseidon } from "maci-crypto/build/ts/hashing";
import { User } from "./user";
// Server authentication data (matches action-circuit.test.ts)
const serverPrivateKey = 12345678901234567890n;
const serverPublicKeyHash = poseidon([serverPrivateKey]);

describe("WWIII Game End-to-End Production Flow", function () {
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
    let bunkerAddresses: string[];
    let game: WWIIIGame;
    let bunkerUsers: User[];
    let tenK: bigint;
    let verifiers: any;

    before(async function () {
        console.log("🚀 Starting End-to-End Production Flow Test");
        
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
        registrar = await RegistrarFactory.deploy(verifiers.registrationVerifier) as Registrar;
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
        
        // Deploy bunkers with new pattern
        const BunkerFactory = await ethers.getContractFactory("Bunker");
        bunkerAddresses = [];
        
        for (let i = 1; i <= 5; i++) {
            const bunker = await BunkerFactory.deploy(
                i,
                wwiii.target
            );
            await bunker.waitForDeployment();
            bunkerAddresses.push(bunker.target.toString());
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
        
        // Register owner as auditor
        const ownerUser = new User(owner);
        const chainId = await ethers.provider.getNetwork().then((network) => network.chainId);
        const registrationCircuit = await zkit.getCircuit("RegistrationCircuit");
        
        const ownerRegistrationHash = ownerUser.genRegistrationHash(chainId);
        const ownerInput = {
            SenderPrivateKey: ownerUser.formattedPrivateKey,
            SenderPublicKey: ownerUser.publicKey,
            SenderAddress: BigInt(owner.address),
            ChainID: chainId,
            RegistrationHash: ownerRegistrationHash,
        };
        
        const ownerProof = await registrationCircuit.generateProof(ownerInput);
        const ownerCalldata = await registrationCircuit.generateCalldata(ownerProof);
        
        await registrar.connect(owner).register({
            proofPoints: {
                a: [(ownerCalldata.proofPoints as any).a[0], (ownerCalldata.proofPoints as any).a[1]],
                b: [
                    [(ownerCalldata.proofPoints as any).b[0][0], (ownerCalldata.proofPoints as any).b[0][1]],
                    [(ownerCalldata.proofPoints as any).b[1][0], (ownerCalldata.proofPoints as any).b[1][1]]
                ],
                c: [(ownerCalldata.proofPoints as any).c[0], (ownerCalldata.proofPoints as any).c[1]]
            },
            publicSignals: [
                ownerCalldata.publicSignals[0],
                ownerCalldata.publicSignals[1], 
                ownerCalldata.publicSignals[2],
                ownerCalldata.publicSignals[3],
                ownerCalldata.publicSignals[4]
            ],
        });
        
        // Set auditor and transfer ownership
        await rocket.setAuditorPublicKey(owner.address);
        await shield.setAuditorPublicKey(owner.address);
        await rocket.transferOwnership(game.target);
        await shield.transferOwnership(game.target);
        await game.acceptTokenOwnership(rocket.target);
        await game.acceptTokenOwnership(shield.target);
        
        // Set server public key hash for action proof validation
        await game.setServerPublicKeyHash(serverPublicKeyHash);
        
        console.log("📦 Phase 1: Infrastructure deployed");
        
        // CRITICAL: Register bunkers with eERC20 system using their contract addresses
        console.log("🔐 Phase 2: Registering bunkers with eERC20...");
        bunkerUsers = [];
        for (let i = 0; i < 5; i++) {
            // Generate unique keys for each bunker
            const bunkerUser = new User(others[i]);
            bunkerUsers.push(bunkerUser);
            
            const bunkerAddress = bunkerAddresses[i];
            const bunker = await ethers.getContractAt("Bunker", bunkerAddress);
            
            // Generate registration hash using bunker contract address
            const registrationHash = poseidon([
                chainId,
                bunkerUser.formattedPrivateKey,
                BigInt(bunkerAddress)
            ]);
            
            const input = {
                SenderPrivateKey: bunkerUser.formattedPrivateKey,
                SenderPublicKey: bunkerUser.publicKey,
                SenderAddress: BigInt(bunkerAddress), // Use bunker contract address
                ChainID: chainId,
                RegistrationHash: registrationHash,
            };
            
            const proof = await registrationCircuit.generateProof(input);
            const calldata = await registrationCircuit.generateCalldata(proof);
            
            // Register bunker contract address with eERC20 system
            await bunker.registerWithEERC20(registrar.target, {
                proofPoints: {
                    a: [(calldata.proofPoints as any).a[0], (calldata.proofPoints as any).a[1]],
                    b: [
                        [(calldata.proofPoints as any).b[0][0], (calldata.proofPoints as any).b[0][1]],
                        [(calldata.proofPoints as any).b[1][0], (calldata.proofPoints as any).b[1][1]]
                    ],
                    c: [(calldata.proofPoints as any).c[0], (calldata.proofPoints as any).c[1]]
                },
                publicSignals: [
                    calldata.publicSignals[0],
                    calldata.publicSignals[1], 
                    calldata.publicSignals[2],
                    calldata.publicSignals[3],
                    calldata.publicSignals[4]
                ],
            });
            
            // Set the public key on the bunker contract
            await bunker.setBunkerPublicKey([bunkerUser.publicKey[0], bunkerUser.publicKey[1]]);
            
            // Verify registration
            const isRegistered = await registrar.isUserRegistered(bunkerAddress);
            expect(isRegistered).to.be.true;
            console.log(`   ✅ Bunker ${i + 1} registered: ${bunkerAddress}`);
        }
        
        // Distribute tokens
        tenK = ethers.parseEther("10000");
        const hundredK = ethers.parseEther("100000");
        await wwiii.transfer(player1.address, hundredK);
        await wwiii.transfer(player2.address, hundredK);
        
        console.log("✅ Setup complete - Ready for end-to-end test");
    });

    describe("Complete Production Flow", function () {
        it("Should execute full attack → mint → decrypt → burn cycle", async function () {
            console.log("\n🎯 PHASE 1: Game Setup");
            
            // Start game and round
            const combatStartTime = await getFutureTimestamp(100);
            await game.connect(owner).startGame(combatStartTime);
            
            await ethers.provider.send("evm_increaseTime", [200]);
            await ethers.provider.send("evm_mine", []);
            
            await game.connect(waracle).startNewRound();
            
            // Deploy players
            await wwiii.connect(player1).approve(game.target, tenK);
            await game.connect(player1).deploy(1, tenK);
            
            await wwiii.connect(player2).approve(game.target, tenK);
            await game.connect(player2).deploy(2, tenK);
            
            console.log("   ✅ Game started, players deployed");
            
            console.log("\n⚔️  PHASE 2: Players Attack");
            
            // Generate valid attack proofs and execute attacks
            const rocketAmount = ethers.parseEther("3000");
            const shieldAmount = ethers.parseEther("7000");
            
            // Player1 attacks Bunker 2 (where player2 is)
            const targetBunkerKey = bunkerUsers[1].publicKey; // Bunker 2 - should receive ROCKET
            const currentBunkerKey = bunkerUsers[0].publicKey; // Bunker 1 - should receive SHIELD
            
            // Get the actual auditor public keys from the contracts
            const rocketAuditorKey = await rocket.auditorPublicKey();
            const shieldAuditorKey = await shield.auditorPublicKey();
            const rocketAuditorPublicKey = [rocketAuditorKey.x, rocketAuditorKey.y];
            const shieldAuditorPublicKey = [shieldAuditorKey.x, shieldAuditorKey.y];
            
            // Generate ROCKET mint proof (to target bunker)
            const rocketMintCalldata = await privateMint(rocketAmount, targetBunkerKey, rocketAuditorPublicKey);
            
            // Generate SHIELD mint proof (to current bunker)
            const shieldMintCalldata = await privateMint(shieldAmount, currentBunkerKey, shieldAuditorPublicKey);
            
            // Create action proof
            const actionCircuit = await zkit.getCircuit("ActionCircuit");
            
            const inputs = {
                serverPrivateKey: serverPrivateKey,
                rocketAmount: rocketAmount,
                shieldAmount: shieldAmount,
                rocketMintProof: [
                    BigInt(rocketMintCalldata.proofPoints.a[0]), BigInt(rocketMintCalldata.proofPoints.a[1]),
                    BigInt(rocketMintCalldata.proofPoints.b[0][0]), BigInt(rocketMintCalldata.proofPoints.b[0][1]),
                    BigInt(rocketMintCalldata.proofPoints.b[1][0]), BigInt(rocketMintCalldata.proofPoints.b[1][1]),
                    BigInt(rocketMintCalldata.proofPoints.c[0]), BigInt(rocketMintCalldata.proofPoints.c[1])
                ],
                rocketChainID: BigInt(rocketMintCalldata.publicSignals[0]),
                rocketNullifierHash: BigInt(rocketMintCalldata.publicSignals[1]),
                rocketReceiverPublicKey: [BigInt(rocketMintCalldata.publicSignals[2]), BigInt(rocketMintCalldata.publicSignals[3])],
                rocketReceiverVTTC1: [BigInt(rocketMintCalldata.publicSignals[4]), BigInt(rocketMintCalldata.publicSignals[5])],
                rocketReceiverVTTC2: [BigInt(rocketMintCalldata.publicSignals[6]), BigInt(rocketMintCalldata.publicSignals[7])],
                rocketReceiverPCT: [BigInt(rocketMintCalldata.publicSignals[8]), BigInt(rocketMintCalldata.publicSignals[9]), BigInt(rocketMintCalldata.publicSignals[10]), BigInt(rocketMintCalldata.publicSignals[11])],
                rocketReceiverPCTAuthKey: [BigInt(rocketMintCalldata.publicSignals[12]), BigInt(rocketMintCalldata.publicSignals[13])],
                rocketReceiverPCTNonce: BigInt(rocketMintCalldata.publicSignals[14]),
                rocketAuditorPublicKey: [BigInt(rocketMintCalldata.publicSignals[15]), BigInt(rocketMintCalldata.publicSignals[16])],
                rocketAuditorPCT: [BigInt(rocketMintCalldata.publicSignals[17]), BigInt(rocketMintCalldata.publicSignals[18]), BigInt(rocketMintCalldata.publicSignals[19]), BigInt(rocketMintCalldata.publicSignals[20])],
                rocketAuditorPCTAuthKey: [BigInt(rocketMintCalldata.publicSignals[21]), BigInt(rocketMintCalldata.publicSignals[22])],
                rocketAuditorPCTNonce: BigInt(rocketMintCalldata.publicSignals[23]),
                shieldMintProof: [
                    BigInt(shieldMintCalldata.proofPoints.a[0]), BigInt(shieldMintCalldata.proofPoints.a[1]),
                    BigInt(shieldMintCalldata.proofPoints.b[0][0]), BigInt(shieldMintCalldata.proofPoints.b[0][1]),
                    BigInt(shieldMintCalldata.proofPoints.b[1][0]), BigInt(shieldMintCalldata.proofPoints.b[1][1]),
                    BigInt(shieldMintCalldata.proofPoints.c[0]), BigInt(shieldMintCalldata.proofPoints.c[1])
                ],
                shieldChainID: BigInt(shieldMintCalldata.publicSignals[0]),
                shieldNullifierHash: BigInt(shieldMintCalldata.publicSignals[1]),
                shieldReceiverPublicKey: [BigInt(shieldMintCalldata.publicSignals[2]), BigInt(shieldMintCalldata.publicSignals[3])],
                shieldReceiverVTTC1: [BigInt(shieldMintCalldata.publicSignals[4]), BigInt(shieldMintCalldata.publicSignals[5])],
                shieldReceiverVTTC2: [BigInt(shieldMintCalldata.publicSignals[6]), BigInt(shieldMintCalldata.publicSignals[7])],
                shieldReceiverPCT: [BigInt(shieldMintCalldata.publicSignals[8]), BigInt(shieldMintCalldata.publicSignals[9]), BigInt(shieldMintCalldata.publicSignals[10]), BigInt(shieldMintCalldata.publicSignals[11])],
                shieldReceiverPCTAuthKey: [BigInt(shieldMintCalldata.publicSignals[12]), BigInt(shieldMintCalldata.publicSignals[13])],
                shieldReceiverPCTNonce: BigInt(shieldMintCalldata.publicSignals[14]),
                shieldAuditorPublicKey: [BigInt(shieldMintCalldata.publicSignals[15]), BigInt(shieldMintCalldata.publicSignals[16])],
                shieldAuditorPCT: [BigInt(shieldMintCalldata.publicSignals[17]), BigInt(shieldMintCalldata.publicSignals[18]), BigInt(shieldMintCalldata.publicSignals[19]), BigInt(shieldMintCalldata.publicSignals[20])],
                shieldAuditorPCTAuthKey: [BigInt(shieldMintCalldata.publicSignals[21]), BigInt(shieldMintCalldata.publicSignals[22])],
                shieldAuditorPCTNonce: BigInt(shieldMintCalldata.publicSignals[23]),
                currentBunker: BigInt(1),
                targetBunkerId: BigInt(2),
                
                // NEW: Security binding parameters
                playerAddress: BigInt(player1.address),
                currentRound: BigInt(1),
                deployedAmount: tenK,
            };
            
            const proof = await actionCircuit.generateProof(inputs);
            const calldata = await actionCircuit.generateCalldata(proof);
            
            const proofArray: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
                BigInt((calldata.proofPoints as any).a[0]), BigInt((calldata.proofPoints as any).a[1]),
                BigInt((calldata.proofPoints as any).b[0][0]), BigInt((calldata.proofPoints as any).b[0][1]),
                BigInt((calldata.proofPoints as any).b[1][0]), BigInt((calldata.proofPoints as any).b[1][1]),
                BigInt((calldata.proofPoints as any).c[0]), BigInt((calldata.proofPoints as any).c[1])
            ];
            
            const publicSignalsArray = Array.from(calldata.publicSignals).map((x: any) => BigInt(x));
            
            console.log("   🏹 Player1 attacks Bunker 2 with valid proof...");
            
            // Execute attack - this should mint ROCKET to bunker 2 and SHIELD to bunker 1
            try {
                const tx = await game.connect(player1).attackOrDefend(proofArray, publicSignalsArray);
                await tx.wait();
                console.log("   ✅ Attack successful - tokens minted to bunkers");
            } catch (error: any) {
                console.log("   ❌ Attack failed with error:");
                console.log("   Error:", error.message);
                if (error.reason) {
                    console.log("   Reason:", error.reason);
                }
                if (error.data) {
                    console.log("   Data:", error.data);
                }
                if (error.code) {
                    console.log("   Code:", error.code);
                }
                
                // Try to decode the error if it's a custom error
                try {
                    const gameInterface = game.interface;
                    const decodedError = gameInterface.parseError(error.data);
                    console.log("   Decoded Error:", decodedError);
                } catch (decodeError) {
                    console.log("   Could not decode error data");
                }
                
                throw error; // Re-throw to fail the test
            }
            
            // SECURITY TEST 1: Proof sharing protection
            console.log("   🛡️  Testing proof sharing protection...");
            try {
                await game.connect(player2).attackOrDefend(proofArray, publicSignalsArray);
                console.log("   ❌ ERROR: Player2 was able to use Player1's proof!");
                throw new Error("Proof sharing should have been rejected");
            } catch (error: any) {
                if (error.message.includes("InvalidActionProof")) {
                    console.log("   ✅ Proof sharing correctly rejected");
                } else {
                    throw error;
                }
            }
            
            console.log("\n🔍 PHASE 3: Waracle Decrypts Balances");
            
            // Waracle reads encrypted balances from bunkers
            const rocketBalances: bigint[] = [];
            const shieldBalances: bigint[] = [];
            
            for (let i = 0; i < 5; i++) {
                const bunkerAddress = bunkerAddresses[i];
                const bunkerUser = bunkerUsers[i];
                
                // Get ROCKET balance
                const rocketBalance = await rocket.balanceOfStandalone(bunkerAddress);
                
                let rocketDecrypted = 0n;
                if (rocketBalance.eGCT.c1.x !== 0n || rocketBalance.eGCT.c2.x !== 0n) {
                    try {
                        // Use same format as EncryptedERC-Standalone: privateKey (not formatted) and eGCT directly
                        rocketDecrypted = await getDecryptedBalance(
                            bunkerUser.privateKey,
                            rocketBalance.amountPCTs,
                            rocketBalance.balancePCT,
                            rocketBalance.eGCT
                        );
                    } catch (error: any) {
                        console.log(`     ❌ ROCKET getDecryptedBalance failed: ${error.message}`);
                        rocketDecrypted = 0n;
                    }
                }
                rocketBalances.push(rocketDecrypted);
                
                // Get SHIELD balance  
                const shieldBalance = await shield.balanceOfStandalone(bunkerAddress);
                console.log(`     - SHIELD eGCT: c1=(${shieldBalance.eGCT.c1.x}, ${shieldBalance.eGCT.c1.y}), c2=(${shieldBalance.eGCT.c2.x}, ${shieldBalance.eGCT.c2.y})`);
                console.log(`     - SHIELD amountPCTs count: ${shieldBalance.amountPCTs.length}`);
                console.log(`     - SHIELD balancePCT: [${shieldBalance.balancePCT.join(', ')}]`);
                
                let shieldDecrypted = 0n;
                if (shieldBalance.eGCT.c1.x !== 0n || shieldBalance.eGCT.c2.x !== 0n) {
                    try {
                        // Use same format as EncryptedERC-Standalone: privateKey (not formatted) and eGCT directly
                        shieldDecrypted = await getDecryptedBalance(
                            bunkerUser.privateKey,
                            shieldBalance.amountPCTs,
                            shieldBalance.balancePCT,
                            shieldBalance.eGCT
                        );
                    } catch (error: any) {
                        console.log(`     ❌ SHIELD getDecryptedBalance failed: ${error.message}`);
                        shieldDecrypted = 0n;
                    }
                }
                shieldBalances.push(shieldDecrypted);
            }
            
            console.log("   🔓 Decrypted ROCKET balances:", rocketBalances.map(b => ethers.formatEther(b)));
            console.log("   🔓 Decrypted SHIELD balances:", shieldBalances.map(b => ethers.formatEther(b)));
            
            // Verify correct allocation
            expect(rocketBalances[0]).to.equal(0n); // Bunker 1: no ROCKET
            expect(rocketBalances[1]).to.equal(rocketAmount); // Bunker 2: received ROCKET attack
            expect(shieldBalances[0]).to.equal(shieldAmount); // Bunker 1: received SHIELD defense
            expect(shieldBalances[1]).to.equal(0n); // Bunker 2: no SHIELD
            
            console.log("   ✅ Balances correctly decrypted and verified");
            
            console.log("\n🔥 PHASE 4: Round Resolution & Token Burning");
            
            // End round
            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // Waracle processes round with decrypted balances
            await expect(game.connect(waracle).WWIIInu(
                [rocketBalances[0], rocketBalances[1], rocketBalances[2], rocketBalances[3], rocketBalances[4]] as [bigint, bigint, bigint, bigint, bigint],
                [shieldBalances[0], shieldBalances[1], shieldBalances[2], shieldBalances[3], shieldBalances[4]] as [bigint, bigint, bigint, bigint, bigint]
            )).to.not.be.reverted;
            
            console.log("   ✅ Round resolved with combat calculations");
            
            console.log("\n🧹 PHASE 5: Verify Complete Token Cleanup");
            
            // Verify all ROCKET/SHIELD tokens are burned from bunkers
            for (let i = 0; i < 5; i++) {
                const bunkerAddress = bunkerAddresses[i];
                
                const rocketEncryptedAfter = await rocket.balanceOfStandalone(bunkerAddress);
                const shieldEncryptedAfter = await shield.balanceOfStandalone(bunkerAddress);
                
                console.log(`   🔍 Bunker ${i + 1} post-burn verification:`);
                console.log(`     - ROCKET eGCT: c1=(${rocketEncryptedAfter.eGCT.c1.x}, ${rocketEncryptedAfter.eGCT.c1.y}), c2=(${rocketEncryptedAfter.eGCT.c2.x}, ${rocketEncryptedAfter.eGCT.c2.y})`);
                console.log(`     - SHIELD eGCT: c1=(${shieldEncryptedAfter.eGCT.c1.x}, ${shieldEncryptedAfter.eGCT.c1.y}), c2=(${shieldEncryptedAfter.eGCT.c2.x}, ${shieldEncryptedAfter.eGCT.c2.y})`);
                
                // After burning, encrypted balances should be identity points (encrypted zero)
                // Identity points on elliptic curve: (0, 1)
                expect(rocketEncryptedAfter.eGCT.c1.x).to.equal(0n);
                expect(rocketEncryptedAfter.eGCT.c1.y).to.equal(1n);
                expect(rocketEncryptedAfter.eGCT.c2.x).to.equal(0n);
                expect(rocketEncryptedAfter.eGCT.c2.y).to.equal(1n);
                expect(shieldEncryptedAfter.eGCT.c1.x).to.equal(0n);
                expect(shieldEncryptedAfter.eGCT.c1.y).to.equal(1n);
                expect(shieldEncryptedAfter.eGCT.c2.x).to.equal(0n);
                expect(shieldEncryptedAfter.eGCT.c2.y).to.equal(1n);
            }
            
            console.log("   ✅ All combat tokens burned - bunkers clean for next round");
            
            // SECURITY TEST 2: Proof replay protection
            console.log("\n🔄 Testing proof replay protection...");
            await game.connect(waracle).startNewRound();
            console.log("   ✅ New round started");
            
            try {
                await game.connect(player1).attackOrDefend(proofArray, publicSignalsArray);
                console.log("   ❌ ERROR: Player1 was able to reuse old proof!");
                throw new Error("Proof replay should have been rejected");
            } catch (error: any) {
                if (error.message.includes("InvalidActionProof")) {
                    console.log("   ✅ Proof replay correctly rejected");
                } else {
                    throw error;
                }
            }
            
            console.log("\n🎉 END-TO-END TEST COMPLETE");
            console.log("✅ Full production flow validated:");
            console.log("   • Bunker registration with eERC20 ✓");
            console.log("   • Player attacks with valid proofs ✓"); 
            console.log("   • ROCKET/SHIELD minted to correct bunkers ✓");
            console.log("   • Waracle decryption using bunker private keys ✓");
            console.log("   • Combat resolution and token burning ✓");
            console.log("   • Clean state for next round ✓");
            console.log("   • Security: Proof sharing protection ✓");
            console.log("   • Security: Proof replay protection ✓");
        });
    });
});