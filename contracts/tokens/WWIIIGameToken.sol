// Copyright 2025, Smolrun LLC. All rights reserved.
// See the file LICENSE for licensing terms.

// SPDX-License-Identifier: Ecosystem

pragma solidity 0.8.27;

import "../EncryptedERC.sol";
import {CreateEncryptedERCParams, EGCT, Point} from "../types/Types.sol";

/**
 * @title WWIIIGameToken
 * @notice Unified game token for WWIII game - used for both ROCKET and SHIELD tokens
 * @dev Extends eERC20 with owner-controlled burning for clean slate between rounds
 * 
 * Key features:
 * - Inherits all eERC20 privacy-preserving functionality
 * - Owner can burn all tokens from specified bunkers after round resolution
 * - Encrypted balances are zeroed out after burning (clean slate each round)
 * - Single contract deployed twice (once for ROCKET, once for SHIELD)
 */
contract WWIIIGameToken is EncryptedERC {
    
    ///////////////////////////////////////////////////
    ///                    Events                   ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Emitted when tokens are burned from multiple bunkers
     * @param bunkers Array of bunker addresses whose tokens were burned
     */
    event AllTokensBurned(address[] bunkers);
    
    ///////////////////////////////////////////////////
    ///                  Constructor                ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Constructor for WWIIIGameToken
     * @param params Parameters for EncryptedERC initialization
     */
    constructor(CreateEncryptedERCParams memory params) EncryptedERC(params) {
        // Constructor inherits from EncryptedERC
    }
    
    ///////////////////////////////////////////////////
    ///                Burn Functions               ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Burn all tokens from specified bunkers - only callable by owner (game contract)
     * @param bunkers Array of bunker addresses to clear tokens from
     * @dev Called by game contract after round resolution to create clean slate for next round
     *      This zeros out all bunkers' encrypted balances
     */
    function burnAllTokensFrom(address[] calldata bunkers) external onlyOwner {
        for (uint256 i = 0; i < bunkers.length; i++) {
            address bunker = bunkers[i];
            if (bunker != address(0)) {
                _burnAllTokensInternal(bunker);
            }
        }
        
        emit AllTokensBurned(bunkers);
    }
    
    /**
     * @notice Internal function to burn all tokens from a single bunker
     * @param bunker Bunker address to clear tokens from
     * @dev Zeros out the bunker's encrypted balance and resets all tracking fields
     */
    function _burnAllTokensInternal(address bunker) internal {
        // Zero out the bunker's encrypted balance (clean slate for next round)
        // For standalone mode, tokenId is always 0
        balances[bunker][0].eGCT = _getEncryptedZero();
        
        // Reset balance tracking fields to clean state
        balances[bunker][0].nonce = 0;
        balances[bunker][0].transactionIndex = 0;
        
        // Clear balance PCT arrays
        delete balances[bunker][0].balancePCT;
        delete balances[bunker][0].amountPCTs;
    }
    
    /**
     * @notice Returns the encrypted zero value for resetting balances
     * @return EGCT representing encrypted zero
     * @dev Uses identity points on the elliptic curve to represent zero
     */
    function _getEncryptedZero() internal pure returns (EGCT memory) {
        return EGCT({
            c1: Point({x: 0, y: 1}), // Identity point on elliptic curve
            c2: Point({x: 0, y: 1})  // Identity point on elliptic curve
        });
    }
}