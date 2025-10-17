const { ethers } = require("ethers");

const address = "0xc03B9483B53c5b000Fa073D3C4549E0aEE6e2E8e";

console.log("Address:", address);
console.log("Checksummed:", ethers.getAddress(address));

// Contract method: abi.encodePacked(address)
const contractLeaf = ethers.solidityPackedKeccak256(["address"], [address]);
console.log("Contract leaf (abi.encodePacked):", contractLeaf);

// Alternative: abi.encode(address) - with padding
const contractLeafPadded = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [address]));
console.log("Contract leaf (abi.encode):", contractLeafPadded);

// StandardMerkleTree method
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const tree = StandardMerkleTree.of([[address]], ["address"]);
console.log("StandardMerkleTree root:", tree.root);

// Let's see the actual leaf value StandardMerkleTree generates
for (const [i, v] of tree.entries()) {
    console.log("StandardMerkleTree leaf hash:", tree.leafHash(v));
    break;
}