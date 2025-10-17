// Copyright 2025, Smolrun LLC. All rights reserved.
// See the file LICENSE for licensing terms.

// SPDX-License-Identifier: Ecosystem

pragma solidity 0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IRegistrarExtended.sol";
import "./types/Types.sol";

/**
 * @title Bunker
 * @notice Simple token vault for WWIII game - grants max approval to game contract for efficient token management
 * @dev Each bunker is a registered eERC20 user that can receive encrypted ROCKET/SHIELD tokens
 * 
 * Key features:
 * - Grants unlimited WWIII token approval to game contract in constructor
 * - Game contract can directly move tokens to/from this bunker via transferFrom
 * - Receives encrypted ROCKET/SHIELD tokens (no tracking to preserve fog of war)
 * - Emergency withdrawal function for owner in case of issues
 * - Extremely simple vault design - all logic is in the main game contract
 * 
 * Token Flow: 
 * - Deposits: Game contract calls wwiiiToken.transferFrom(player, bunker, amount)
 * - Moves: Game contract calls wwiiiToken.transferFrom(bunker, targetBunker, amount)
 * - Withdrawals: Game contract calls wwiiiToken.transferFrom(bunker, player, amount)
 * - Burns: Game contract calls wwiiiToken.transferFrom(bunker, DEAD_ADDRESS, amount)
 */
contract Bunker is Ownable {
    using SafeERC20 for IERC20;
    
    ///////////////////////////////////////////////////
    ///                Custom Errors                ///
    ///////////////////////////////////////////////////
    
    error InvalidAmount();
    error InvalidAddress();
    error BunkerKeyAlreadySet();
    error InvalidBunkerKey();
    
    ///////////////////////////////////////////////////
    ///                   Constants                 ///
    ///////////////////////////////////////////////////
    
    /// @notice Dead address for burning tokens
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    ///////////////////////////////////////////////////
    ///                   State Variables           ///
    ///////////////////////////////////////////////////
    
    /// @notice Unique identifier for this bunker (1-5)
    uint8 public immutable bunkerId;
    
    /// @notice Address of the authorized game contract (updatable)
    address public gameContract;
    
    /// @notice WWIII token contract
    IERC20 public immutable wwiiiToken;
    
    /// @notice Bunker's BabyJubJub public key for eERC20 registration
    uint256[2] public bunkerPublicKey;
    
    ///////////////////////////////////////////////////
    ///                    Events                   ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Emitted when game contract is updated
     * @param oldGameContract Previous game contract
     * @param newGameContract New game contract
     */
    event GameContractUpdated(address indexed oldGameContract, address indexed newGameContract);
    
    /**
     * @notice Emitted when emergency withdrawal is performed
     * @param receiver Address that received the tokens
     * @param amount Amount of tokens withdrawn
     */
    event EmergencyWithdrawal(address indexed receiver, uint256 amount);
    
    /**
     * @notice Emitted when bunker public key is set
     * @param bunkerPublicKey The BabyJubJub public key [x, y]
     */
    event BunkerPublicKeySet(uint256[2] bunkerPublicKey);
    
    ///////////////////////////////////////////////////
    ///                  Constructor                ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Constructor for Bunker contract
     * @param _bunkerId Unique identifier for this bunker (1-5)
     * @param _wwiiiToken Address of the WWIII token contract
     */
    constructor(
        uint8 _bunkerId,
        address _wwiiiToken
    ) Ownable(msg.sender) {
        if (_bunkerId == 0 || _bunkerId > 5) revert InvalidAmount();
        if (_wwiiiToken == address(0)) revert InvalidAddress();
        
        bunkerId = _bunkerId;
        wwiiiToken = IERC20(_wwiiiToken);
        
        // Bunker public key and game contract will be set after deployment
    }
    
    ///////////////////////////////////////////////////
    ///            Contract Management              ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Update game contract address and transfer approval
     * @param newGameContract New game contract address
     * @dev Only owner can update for migration scenarios
     *      Revokes approval from old contract and grants to new contract
     */
    function updateGameContract(address newGameContract) external onlyOwner {
        if (newGameContract == address(0)) revert InvalidAddress();
        
        address oldGameContract = gameContract;
        
        // Revoke approval from old game contract
        if (oldGameContract != address(0)) {
            wwiiiToken.approve(oldGameContract, 0);
        }
        
        // Grant unlimited approval to new game contract
        wwiiiToken.approve(newGameContract, type(uint256).max);
        
        gameContract = newGameContract;
        emit GameContractUpdated(oldGameContract, newGameContract);
    }
    
    /**
     * @notice Set bunker's BabyJubJub public key for eERC20 registration
     * @param _bunkerPublicKey The BabyJubJub public key [x, y]
     * @dev Only owner can set this, and only once for security
     */
    function setBunkerPublicKey(uint256[2] memory _bunkerPublicKey) external onlyOwner {
        if (bunkerPublicKey[0] != 0 || bunkerPublicKey[1] != 0) revert BunkerKeyAlreadySet();
        if (_bunkerPublicKey[0] == 0 && _bunkerPublicKey[1] == 0) revert InvalidBunkerKey();
        
        bunkerPublicKey = _bunkerPublicKey;
        emit BunkerPublicKeySet(_bunkerPublicKey);
    }
    
    /**
     * @notice Register this bunker with the eERC20 registrar
     * @param registrar Address of the registrar contract
     * @param proof Registration proof generated off-chain
     * @dev Only owner can register, and proof must be for this contract's address
     */
    function registerWithEERC20(
        address registrar,
        RegisterProof calldata proof
    ) external onlyOwner {
        if (registrar == address(0)) revert InvalidAddress();
        
        // Call the registrar's register function
        // The proof must have been generated for this contract's address
        IRegistrarExtended(registrar).register(proof);
    }
    
    ///////////////////////////////////////////////////
    ///              Emergency Functions            ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Emergency withdrawal of WWIII tokens - only callable by owner
     * @param receiver Address to receive the tokens
     * @dev Used in case of emergency or game contract issues
     */
    function emergencyWithdraw(address receiver) external onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        
        uint256 balance = wwiiiToken.balanceOf(address(this));
        
        if (balance > 0) {
            wwiiiToken.safeTransfer(receiver, balance);
        }
        
        emit EmergencyWithdrawal(receiver, balance);
    }
    
    ///////////////////////////////////////////////////
    ///                View Functions               ///
    ///////////////////////////////////////////////////
    
    /**
     * @notice Get current WWIII token balance held by bunker
     * @return Balance of WWIII tokens
     */
    function getTokenBalance() external view returns (uint256) {
        return wwiiiToken.balanceOf(address(this));
    }
    
    /**
     * @notice Get bunker's public key for eERC20 operations
     * @return Public key as [x, y] coordinates
     */
    function getBunkerPublicKey() external view returns (uint256[2] memory) {
        return bunkerPublicKey;
    }
    
    /**
     * @notice Get bunker information
     * @return id Bunker ID
     * @return balance Current WWIII token balance
     * @return publicKey Bunker's BabyJubJub public key for eERC20 operations
     */
    function getBunkerInfo() external view returns (
        uint8 id,
        uint256 balance,
        uint256[2] memory publicKey
    ) {
        return (
            bunkerId,
            wwiiiToken.balanceOf(address(this)),
            bunkerPublicKey
        );
    }
}