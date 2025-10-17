// Copyright 2025, Smolrun LLC. All rights reserved.
// See the file LICENSE for licensing terms.

// SPDX-License-Identifier: Ecosystem

pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title WWIIIToken
 * @notice Fixed supply ERC20 token for the WWIII blockchain game
 * @dev Total supply of 10 billion tokens, all pre-minted at deployment
 * 
 * Key features:
 * - Fixed supply of 10,000,000,000 tokens (10 billion)
 * - 18 decimal places
 * - No mint function - supply is fixed forever
 * - All tokens minted to deployer for initial distribution
 * 
 * Intended distribution:
 * - 6 billion tokens → EmissionVault (game rewards)
 * - 2 billion tokens → Team allocation
 * - 2 billion tokens → Initial circulation
 */
contract WWIIIToken is ERC20 {
    
    /// @notice Total supply of WWIII tokens (10 billion with 18 decimals)
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * 10**18;
    
    /**
     * @notice Constructor that mints all tokens to the deployer
     * @dev All 10 billion tokens are minted once at deployment
     */
    constructor() ERC20("WWIII Token", "WWIII") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
    
    // Note: No mint function implemented - supply is fixed at deployment
}