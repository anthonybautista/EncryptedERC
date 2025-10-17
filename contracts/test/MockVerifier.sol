// Copyright 2025, Smolrun LLC. All rights reserved.
// See the file LICENSE for licensing terms.

// SPDX-License-Identifier: Ecosystem

pragma solidity 0.8.27;

/**
 * @title MockVerifier
 * @notice Mock verifier contract for testing purposes
 * @dev Always returns true for verification - DO NOT USE IN PRODUCTION
 */
contract MockVerifier {
    /**
     * @notice Mock verification function that always returns true
     * @dev This is for testing only - real verifiers validate zk-SNARK proofs
     */
    function verifyProof(
        uint256[2] memory, // a
        uint256[2][2] memory, // b  
        uint256[2] memory, // c
        uint256[] memory // publicSignals
    ) public pure returns (bool) {
        return true;
    }
}