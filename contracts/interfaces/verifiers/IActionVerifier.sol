// SPDX-License-Identifier: UNLICENSED
// Copyright 2025, Smolrun LLC

pragma solidity 0.8.27;

/**
 * @title IActionVerifier
 * @dev Interface for verifying action proofs in the WWIII game
 */
interface IActionVerifier {
    /**
     * @dev Verify an action proof using Groth16 verification
     * @param pointA Point A of the proof
     * @param pointB Point B of the proof  
     * @param pointC Point C of the proof
     * @param publicSignals The 70 public signals:
     *   [0] serverPublicKeyHash: Hash of server private key (authentication)
     *   [1-8] rocketProofOut: ROCKET mint proof points [8]
     *   [9-32] rocketPublicSignalsOut: ROCKET mint public signals [24]
     *   [33-40] shieldProofOut: SHIELD mint proof points [8]  
     *   [41-64] shieldPublicSignalsOut: SHIELD mint public signals [24]
     *   [65] currentBunker: Player's current bunker ID (1-5)
     *   [66] targetBunkerId: Target bunker for ROCKET tokens (1-5)
     *   [67] playerAddress: Player's Ethereum address (security binding)
     *   [68] currentRound: Current round number (replay protection)
     *   [69] deployedAmount: Player's deployment amount (validation)
     * @return true if the proof is valid
     * @notice Complete mint proof data embedded for privateMint operations
     */
    function verifyProof(
        uint256[2] memory pointA,
        uint256[2][2] memory pointB,
        uint256[2] memory pointC,
        uint256[70] memory publicSignals
    ) external view returns (bool);
}