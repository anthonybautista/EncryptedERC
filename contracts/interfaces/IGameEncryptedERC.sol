// SPDX-License-Identifier: MIT
// Copyright 2025, Smolrun LLC

pragma solidity 0.8.27;

import "./IEncryptedERC.sol";
import "../types/Types.sol";

/**
 * @title IGameEncryptedERC
 * @notice Interface for encrypted ERC20 tokens used in WWIII game
 * @dev Extends the base IEncryptedERC interface with game-specific functions
 */
interface IGameEncryptedERC is IEncryptedERC {
    // Use the proper MintProof structure from Types.sol

    /**
     * @notice Privately mints tokens to a user
     * @param user User address
     * @param proof Mint proof data
     */
    function privateMint(
        address user,
        MintProof calldata proof
    ) external;

    /**
     * @notice Transfers ownership of the token contract (Ownable2Step)
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external;

    /**
     * @notice Accepts ownership of the token contract (Ownable2Step)
     */
    function acceptOwnership() external;

    /**
     * @notice Burn all tokens from specified bunkers (clean slate for new round)
     * @param bunkers Array of bunker addresses to clear
     */
    function burnAllTokensFrom(address[] calldata bunkers) external;
}