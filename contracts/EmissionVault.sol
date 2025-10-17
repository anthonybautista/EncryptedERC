// Copyright 2025, Smolrun LLC. All rights reserved.
// See the file LICENSE for licensing terms.

// SPDX-License-Identifier: Ecosystem

pragma solidity 0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EmissionVault
 * @notice Vault contract that holds WWIII tokens for game emissions over 3 years
 * @dev Manages the distribution of 6 billion WWIII tokens to the game contract
 * 
 * Key features:
 * - Holds 6B WWIII tokens for game rewards
 * - Only authorized game contract can withdraw tokens
 * - Handles endgame gracefully when vault balance is insufficient
 * - Emergency withdrawal for admin in case of issues
 * - One-time game contract setup with update capability
 */
contract EmissionVault is Ownable {
    using SafeERC20 for IERC20;
    
    ///////////////////////////////////////////////////
    ///                   State Variables           ///
    ///////////////////////////////////////////////////
    
    /// @notice The WWIII token contract
    IERC20 public immutable wwiiiToken;
    
    /// @notice Address of the authorized game contract
    address public gameContract;
    
    ///////////////////////////////////////////////////
    ///                    Events                   ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Emitted when game contract is set or updated
     * @param oldGameContract Previous game contract address (zero for initial setup)
     * @param newGameContract New game contract address
     */
    event GameContractSet(address indexed oldGameContract, address indexed newGameContract);
    
    /**
     * @notice Emitted when tokens are withdrawn by game contract
     * @param gameContract Address of the game contract
     * @param amount Amount of tokens withdrawn
     */
    event TokensWithdrawn(address indexed gameContract, uint256 amount);
    
    /**
     * @notice Emitted when emergency withdrawal is performed
     * @param receiver Address that received the tokens
     * @param amount Amount of tokens withdrawn
     */
    event EmergencyWithdrawal(address indexed receiver, uint256 amount);
    
    ///////////////////////////////////////////////////
    ///                   Modifiers                 ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Modifier to restrict access to game contract only
     */
    modifier onlyGameContract() {
        require(msg.sender == gameContract, "Only game contract can withdraw");
        _;
    }
    
    ///////////////////////////////////////////////////
    ///                  Constructor                ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Constructor for EmissionVault
     * @param _wwiiiToken Address of the WWIII token contract
     */
    constructor(address _wwiiiToken) Ownable(msg.sender) {
        require(_wwiiiToken != address(0), "WWIII token cannot be zero address");
        wwiiiToken = IERC20(_wwiiiToken);
    }
    
    ///////////////////////////////////////////////////
    ///              Game Contract Management       ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Set or update the game contract address
     * @param _gameContract Address of the game contract
     * @dev Only owner can set/update this. Can be called multiple times if game contract needs updating
     */
    function setGameContract(address _gameContract) external onlyOwner {
        require(_gameContract != address(0), "Game contract cannot be zero address");
        
        address oldGameContract = gameContract;
        gameContract = _gameContract;
        emit GameContractSet(oldGameContract, _gameContract);
    }
    
    ///////////////////////////////////////////////////
    ///              Withdrawal Functions           ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Withdraw tokens for game emissions - only callable by game contract
     * @param amount Amount of tokens to withdraw
     * @return success True if withdrawal completed (always returns true for endgame handling)
     * @dev Handles insufficient balance gracefully by transferring only what's available
     *      This prevents the game from reverting due to vault depletion near endgame
     */
    function withdraw(uint256 amount) external onlyGameContract returns (bool success) {
        require(amount > 0, "Amount must be greater than zero");
        
        uint256 vaultBalance = wwiiiToken.balanceOf(address(this));
        uint256 toTransfer = amount;
        
        // Handle endgame: transfer only what's available if requesting more than vault balance
        if (amount > vaultBalance) {
            toTransfer = vaultBalance;
        }
        
        // Transfer tokens (even if amount is 0 - allows game to continue gracefully)
        if (toTransfer > 0) {
            wwiiiToken.safeTransfer(gameContract, toTransfer);
        }
        
        emit TokensWithdrawn(gameContract, toTransfer);
        return true;
    }
    
    /**
     * @notice Emergency withdrawal of all tokens - only callable by owner
     * @param receiver Address to receive the tokens
     * @dev Used in case of emergency or game contract issues
     */
    function emergencyWithdraw(address receiver) external onlyOwner {
        require(receiver != address(0), "Receiver cannot be zero address");
        
        uint256 vaultBalance = wwiiiToken.balanceOf(address(this));
        
        if (vaultBalance > 0) {
            wwiiiToken.safeTransfer(receiver, vaultBalance);
        }
        
        emit EmergencyWithdrawal(receiver, vaultBalance);
    }
    
    ///////////////////////////////////////////////////
    ///                View Functions               ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Get remaining tokens available for emission
     * @return Amount of WWIII tokens remaining in the vault
     */
    function remainingEmissions() external view returns (uint256) {
        return wwiiiToken.balanceOf(address(this));
    }
    
    /**
     * @notice Check if game contract has been set
     * @return True if game contract address is set
     */
    function isGameContractSet() external view returns (bool) {
        return gameContract != address(0);
    }
    
    /**
     * @notice Get the current game contract address
     * @return Address of the current game contract
     */
    function getGameContract() external view returns (address) {
        return gameContract;
    }
}