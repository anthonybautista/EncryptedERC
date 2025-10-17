#!/usr/bin/env node

const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { ethers } = require("ethers");

// Test address for demonstration (valid checksum)
const testAddress = "0x742d35Cc6cF4c51c51935d7b4B3b92f8f5e8c8aA";

console.log("=== Understanding Address Encoding Differences ===\n");
console.log("Test Address:", testAddress);
console.log();

// 1. How StandardMerkleTree encodes addresses
console.log("1. StandardMerkleTree.of(leafs, [\"address\"]) encoding:");
console.log("   - Uses standard ABI encoding for addresses");

const leafs = [[testAddress]];
const tree = StandardMerkleTree.of(leafs, ["address"]);

// Find the leaf hash that the tree generates
let leafHash;
for (const [i, v] of tree.entries()) {
    if (v[0] === testAddress) {
        const proof = tree.getProof(i);
        console.log("   - Leaf index:", i);
        console.log("   - Merkle root:", tree.root);
        
        // StandardMerkleTree internally uses ethers.AbiCoder.encode for leaf hashing
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encodedAddress = abiCoder.encode(["address"], [testAddress]);
        const computedLeafHash = ethers.keccak256(encodedAddress);
        
        console.log("   - ABI encoded address:", encodedAddress);
        console.log("   - Computed leaf hash:", computedLeafHash);
        break;
    }
}

console.log();

// 2. How Solidity abi.encodePacked works
console.log("2. Solidity abi.encodePacked(address) encoding:");
console.log("   - Packs address without padding (20 bytes exactly)");

// In Solidity: keccak256(abi.encodePacked(address)) 
// abi.encodePacked removes the 0x00000000000000000000000 padding

// Remove 0x prefix and convert to bytes
const addressBytes = testAddress.slice(2);
const packedEncoding = "0x" + addressBytes;
const packedLeafHash = ethers.keccak256(packedEncoding);

console.log("   - Packed address (no padding):", packedEncoding);
console.log("   - Computed leaf hash:", packedLeafHash);

console.log();

// 3. The difference
console.log("3. The Key Difference:");
console.log("   ABI encoding (StandardMerkleTree):");
console.log("   - Pads address to 32 bytes (64 hex chars)");
console.log("   - Format: 0x000000000000000000000000" + addressBytes);

console.log();
console.log("   Packed encoding (Solidity):");
console.log("   - Uses address as-is (20 bytes, 40 hex chars)");
console.log("   - Format: 0x" + addressBytes);

console.log();

// 4. Show the actual encoding difference
const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const abiEncoded = abiCoder.encode(["address"], [testAddress]);
const abiLeafHash = ethers.keccak256(abiEncoded);

console.log("4. Actual Encoding Comparison:");
console.log("   ABI encoded:    ", abiEncoded);
console.log("   Packed encoded: ", packedEncoding);
console.log("   ABI leaf hash:  ", abiLeafHash);
console.log("   Packed leaf hash:", packedLeafHash);
console.log("   Hashes match:   ", abiLeafHash === packedLeafHash ? "✅ YES" : "❌ NO");

console.log();

// 5. Solution
console.log("5. Solutions:");
console.log("   A) Change Solidity contract to use abi.encode instead of abi.encodePacked:");
console.log("      bytes32 leaf = keccak256(abi.encode(msg.sender));");
console.log();
console.log("   B) Or create custom JavaScript function to match Solidity's encodePacked:");
console.log("      function createPackedLeaf(address) {");
console.log("        return ethers.keccak256(address); // address is already 20 bytes");
console.log("      }");

console.log("\n=== Analysis Complete ===");