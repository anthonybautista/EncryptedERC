// SPDX-License-Identifier: MIT
// Copyright 2025, Smolrun LLC
pragma solidity 0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IGameEncryptedERC.sol";
import "./interfaces/IRegistrar.sol";
import "./interfaces/verifiers/IActionVerifier.sol";
import "./EmissionVault.sol";
import "./Bunker.sol";

/**
 * @title WWIIIGame
 * @notice Main game contract for WWIII blockchain game using eERC20 protocol
 * @dev Implements strategic warfare with encrypted token mechanics and ZK proofs
 */
contract WWIIIGame is Ownable, ReentrancyGuard {
    using Math for uint256;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Base index for all bunkers (10,000 * 1e18)
    uint256 public constant BASE_INDEX = 10000 * 1e18;
    
    /// @notice Round duration (8 hours)
    uint256 public constant ROUND_DURATION = 8 hours;
    
    /// @notice Dead address for burning tokens
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /*//////////////////////////////////////////////////////////////
                                GAME STATE
    //////////////////////////////////////////////////////////////*/
    
    enum GamePhase { DEPLOYMENT, ACTIVE, HALTED, ENDED }
    
    /// @notice Current game phase
    GamePhase public gamePhase = GamePhase.DEPLOYMENT;
    
    /// @notice Current round number (0 = deployment phase)
    uint256 public currentRound;
    
    /// @notice Minimum deposit required to play
    uint256 public minimumDeposit = 100000 ether;
    
    /// @notice Whether game is halted
    bool public gameHalted;
    
    /// @notice When combat will begin
    uint256 public combatStartTime;

    /*//////////////////////////////////////////////////////////////
                            CONTRACT REFERENCES
    //////////////////////////////////////////////////////////////*/
    
    /// @notice WWIII token contract
    IERC20 public immutable WWIII;
    
    /// @notice Emission vault contract (changeable for migration)
    EmissionVault public emissionVault;
    
    /// @notice ROCKET token contract (eERC20)
    IGameEncryptedERC public immutable ROCKET;
    
    /// @notice SHIELD token contract (eERC20)
    IGameEncryptedERC public immutable SHIELD;
    
    /// @notice Registrar contract for eERC20
    IRegistrar public immutable registrar;
    
    /// @notice Action verifier contract for ZK proofs
    IActionVerifier public immutable actionVerifier;
    
    /// @notice Trusted Waracle address (changeable for security)
    address public trustedWaracle;
    
    /// @notice Server public key hash for action proof validation
    uint256 public serverPublicKeyHash;
    
    /// @notice Bunker contract addresses (1-5)
    mapping(uint8 => address) public bunkerContracts;
    
    /*//////////////////////////////////////////////////////////////
                          FLEXIBLE EMISSIONS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Current round emission amount (set by owner)
    uint256 public currentRoundEmission;
    
    /// @notice Whether emissions are set manually (true) or use legacy calculation (false)  
    bool public useManualEmissions;
    
    /// @notice Last round when emissions were updated
    uint256 public lastEmissionUpdateRound;

    /*//////////////////////////////////////////////////////////////
                                STRUCTS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Player state information
    struct Player {
        uint8 currentBunker;           // 0 = not deployed, 1-5 = bunker ID
        uint256 deployedAmount;        // Original deployment amount
        uint256 depositIndex;          // Index when player deposited
        uint256 deploymentTimestamp;   // For prestige calculation
        uint256 lastActionRound;       // Last round player took action
    }
    
    /// @notice Round information
    struct Round {
        uint256 startTime;             // When round started
        uint256 endTime;               // When round ends
        uint256 totalEmission;         // Total tokens to distribute
        bool resolved;                 // Whether round has been resolved
    }
    
    /// @notice Combined bunker information
    struct BunkerState {
        uint256 totalDeployed;         // Total WWIII tokens in bunker
        uint256 index;                 // Current index with PRECISION
        uint256 lastUpdateRound;       // Last round this was updated
        address[] players;             // Players in this bunker
    }

    /*//////////////////////////////////////////////////////////////
                                MAPPINGS
    //////////////////////////////////////////////////////////////*/
    
    /// @notice Player information
    mapping(address => Player) public players;
    
    /// @notice Round information
    mapping(uint256 => Round) public rounds;

    /// @notice WWIIInu function processed by Waracle
    mapping(uint256 => bool) public wwiiinuProcessed;
    
    /// @notice Bunker information
    mapping(uint8 => BunkerState) public bunkers;
    
    /// @notice Track next player index to process for each bunker reset
    mapping(uint8 => uint256) public bunkerResetNextIndex;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/
    
    error OnlyWaracle();
    error NotDeployed();
    error InvalidBunkerId();
    error NoActiveRound();
    error RoundEnded();
    error RoundAlreadyResolved();
    error CannotActDuringTransition();
    error InvalidTokenAddress();
    error InvalidVaultAddress();
    error InvalidRegistrarAddress();
    error InvalidVerifierAddress();
    error InvalidWaracleAddress();
    error InvalidBunkerCount();
    error InvalidBunkerAddress();
    error BelowMinimumDeposit();
    error AlreadyDeployed();
    error ZeroAmount();
    error AlreadyActedThisRound();
    error InvalidMove();
    error NoTokensToMove();
    error InvalidActionProof();
    error RocketMintFailed();
    error ShieldMintFailed();
    error CannotRetreatDuringTransition();
    error GameAlreadyStarted();
    error InvalidStartTime();
    error GameNotActive();
    error TooEarlyForFirstRound();
    error RoundNotEnded();
    error BunkerNotMarkedForDestruction();
    error AlreadyHalted();
    error MustWait24Hours();
    error InvalidRecipient();
    error CannotWithdrawGameToken();
    error BunkerAlreadyDestroyed();
    error GameIsHalted();
    error GameIsEnded();
    error BunkerResetInProgress();
    error DestroyedBunkersNeedCleanup();
    error ResetAlreadyCompleted();
    error IndexResetNotNeeded();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    
    event PlayerDeployed(address indexed player, uint8 indexed bunker, uint256 amount, uint256 timestamp);
    event PlayerAddedTokens(address indexed player, uint8 indexed bunker, uint256 amount, uint256 newTotal);
    event PlayerMoved(address indexed player, uint8 indexed fromBunker, uint8 indexed toBunker, uint256 amount, uint256 round);
    event PlayerRetreated(address indexed player, uint8 fromBunker, uint256 amount, uint256 deploymentDuration);
    event PlayerAttacked(address indexed player, uint8 fromBunker, uint8 targetBunker, uint256 totalDeployed);

    event GameStarted(uint256 combatStartTime);
    event RoundStarted(uint256 indexed round, uint256 startTime, uint256 endTime, uint256 emission);
    event RoundResolved(uint256 indexed round, uint256 timestamp);
    
    event BunkerDamaged(uint8 indexed bunker, uint256 damage, uint256 remainingWWIII, uint256 newIndex);
    event BunkerDestroyed(uint8 indexed bunker, uint256 round, uint256 totalLost);
    
    event ResourcesDistributed(uint8 indexed bunker, uint256 amount, uint256 round);
    event ResourcesSpoiled(uint8 indexed bunker, uint256 amount, uint256 round);
    
    event GameHalted(uint256 atRound, uint256 timestamp);
    event EmergencyHalt(uint256 atRound, uint256 timestamp, address triggeredBy);
    event GameEnded(uint256 finalRound, uint256 timestamp, uint256 totalDistributed);
    
    event MinimumDepositUpdated(uint256 oldMinimum, uint256 newMinimum);
    event BunkerIndexReset(uint8 indexed bunker, uint256 oldIndex, uint256 playersReset);
    event WaracleUpdated(address oldWaracle, address newWaracle);
    event VaultUpdated(address oldVault, address newVault);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);
    
    /// @notice Emitted when owner updates round emissions
    event EmissionsUpdated(uint256 newAmount, uint256 atRound, address indexed updatedBy);
    
    /// @notice Emitted when owner reverts to legacy emissions
    event EmissionsReverted(uint256 atRound, address indexed revertedBy);
    
    /// @notice Comprehensive Waracle submission event for transparency
    event WaracleSubmission(
        uint256 indexed round,
        uint256[5] rocketBalances,
        uint256[5] shieldBalances,
        uint256[5] damages
    );

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    
    modifier onlyWaracle() {
        if (msg.sender != trustedWaracle) revert OnlyWaracle();
        _;
    }
    
    modifier gameActive() {
        if (gameHalted) revert GameIsHalted();
        if (gamePhase == GamePhase.ENDED) revert GameIsEnded();
        _;
    }
    
    /// @notice Validates player is deployed and bunker is not destroyed
    modifier validBunker(address player) {
        uint8 bunker = players[player].currentBunker;
        if (bunker == 0) revert NotDeployed();
        if (bunkers[bunker].index == 0) revert BunkerAlreadyDestroyed();
        _;
    }
    
    modifier validBunkerId(uint8 bunkerId) {
        if (bunkerId < 1 || bunkerId > 5) revert InvalidBunkerId();
        _;
    }
    
    modifier roundActive() {
        if (currentRound == 0) revert NoActiveRound();
        if (block.timestamp >= rounds[currentRound].endTime) revert RoundEnded();
        if (rounds[currentRound].resolved) revert RoundAlreadyResolved();
        _;
    }
    
    /// @notice Prevents actions during round transition (after round ends but before next starts)
    modifier notDuringTransition() {
        if (currentRound > 0 && 
            block.timestamp >= rounds[currentRound].endTime && 
            !rounds[currentRound].resolved) {
            revert CannotActDuringTransition();
        }
        _;
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    
    constructor(
        address _wwiii,
        address _vault,
        address _rocket,
        address _shield,
        address _registrar,
        address _actionVerifier,
        address[] memory _bunkerAddresses,
        address _waracle
    ) Ownable(msg.sender) {
        if (_wwiii == address(0)) revert InvalidTokenAddress();
        if (_vault == address(0)) revert InvalidVaultAddress();
        if (_rocket == address(0)) revert InvalidTokenAddress();
        if (_shield == address(0)) revert InvalidTokenAddress();
        if (_registrar == address(0)) revert InvalidRegistrarAddress();
        if (_actionVerifier == address(0)) revert InvalidVerifierAddress();
        if (_waracle == address(0)) revert InvalidWaracleAddress();
        if (_bunkerAddresses.length != 5) revert InvalidBunkerCount();
        
        WWIII = IERC20(_wwiii);
        emissionVault = EmissionVault(_vault);
        ROCKET = IGameEncryptedERC(_rocket);
        SHIELD = IGameEncryptedERC(_shield);
        registrar = IRegistrar(_registrar);
        actionVerifier = IActionVerifier(_actionVerifier);
        trustedWaracle = _waracle;
        
        // Initialize bunker contracts and indices
        for (uint8 i = 1; i <= 5; i++) {
            if (_bunkerAddresses[i-1] == address(0)) revert InvalidBunkerAddress();
            bunkerContracts[i] = _bunkerAddresses[i-1];
            
            // Initialize bunker with base index
            bunkers[i].index = BASE_INDEX;
            bunkers[i].lastUpdateRound = 0;
        }
    }

    /*//////////////////////////////////////////////////////////////
                            PLAYER FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Deploy tokens to a bunker to join the game
     * @param bunker Bunker ID (1-5) to deploy to
     * @param amount Amount of WWIII tokens to deploy (minimum 10,000)
     */
    function deploy(uint8 bunker, uint256 amount) 
        external 
        nonReentrant 
        gameActive 
        notDuringTransition
        validBunkerId(bunker) 
    {
        Player storage p = players[msg.sender];
        if (amount < minimumDeposit) revert BelowMinimumDeposit();
        if (p.currentBunker != 0) revert AlreadyDeployed();
        if (bunkers[bunker].index == 0) revert BunkerAlreadyDestroyed();
        
        // Transfer tokens to bunker contract
        WWIII.transferFrom(msg.sender, bunkerContracts[bunker], amount);
        
        // Update player state
        p.currentBunker = bunker;
        p.deployedAmount = amount;
        p.depositIndex = bunkers[bunker].index;
        p.deploymentTimestamp = block.timestamp;
        p.lastActionRound = 0;
        
        // Update bunker state
        bunkers[bunker].players.push(msg.sender);
        bunkers[bunker].totalDeployed += amount;
        
        emit PlayerDeployed(msg.sender, bunker, amount, block.timestamp);
    }
    
    /**
     * @notice Add more tokens to current deployment
     * @param amount Additional WWIII tokens to add
     * @dev Calculates current deployment with index, adds new tokens, updates index
     */
    function addTokens(uint256 amount) 
        external 
        nonReentrant 
        gameActive 
        notDuringTransition
        validBunker(msg.sender) 
    {
        Player storage p = players[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (p.lastActionRound >= currentRound && currentRound > 0) {
            revert AlreadyActedThisRound();
        }
        
        uint8 bunker = p.currentBunker;
        
        // Calculate current deployment amount (affected by index)
        uint256 currentDeployment = getCurrentDeployment(msg.sender);
        
        // Transfer additional tokens
        WWIII.transferFrom(msg.sender, bunkerContracts[bunker], amount);
        
        // Update player state - new total and reset index to current
        uint256 newTotalDeployment = currentDeployment + amount;
        p.deployedAmount = newTotalDeployment;
        p.depositIndex = bunkers[bunker].index; // Reset to current index
        
        // Update bunker state
        bunkers[bunker].totalDeployed += amount;
        
        emit PlayerAddedTokens(msg.sender, bunker, amount, newTotalDeployment);
    }
    
    /**
     * @notice Move to a connected bunker
     * @param newBunker Target bunker ID (1-5)
     */
    function move(uint8 newBunker) 
        external 
        nonReentrant 
        gameActive 
        roundActive
        validBunker(msg.sender) 
        validBunkerId(newBunker)
    {
        Player storage p = players[msg.sender];
        uint8 currentBunker = p.currentBunker;
        if (!canMove(currentBunker, newBunker)) revert InvalidMove();
        if (p.lastActionRound >= currentRound) revert AlreadyActedThisRound();
        if (bunkers[newBunker].index == 0) revert BunkerAlreadyDestroyed();
        
        // Calculate current deployment with precision handling
        uint256 currentAmount = getCurrentDeployment(msg.sender);
        if (currentAmount == 0) revert NoTokensToMove();

        bool _onlyPlayer;
        if (bunkers[currentBunker].players.length == 1) {
            currentAmount = WWIII.balanceOf(bunkerContracts[currentBunker]);
            _onlyPlayer = true;
        }
        
        // Update bunker states
        if (_onlyPlayer) {
            bunkers[currentBunker].totalDeployed = 0;
        } else {
            bunkers[currentBunker].totalDeployed = 
            bunkers[currentBunker].totalDeployed > currentAmount 
                ? bunkers[currentBunker].totalDeployed - currentAmount 
                : 0;
        }
        
        bunkers[newBunker].totalDeployed += currentAmount;
        
        // Transfer tokens between bunker contracts using transferFrom
        WWIII.transferFrom(
            bunkerContracts[currentBunker], 
            bunkerContracts[newBunker], 
            currentAmount
        );
        
        // Update player state
        p.currentBunker = newBunker;
        p.deployedAmount = currentAmount;
        p.depositIndex = bunkers[newBunker].index;
        p.lastActionRound = currentRound;
        
        // Update bunker player arrays
        _removePlayerFromBunker(currentBunker, msg.sender);
        bunkers[newBunker].players.push(msg.sender);
        
        emit PlayerMoved(msg.sender, currentBunker, newBunker, currentAmount, currentRound);
    }
    
    /**
     * @notice Attack or defend using action proof with mint proof validation
     * @param proof ZK proof validating allocation constraints and server authentication
     * @param publicSignals Public signals from the action circuit
     * @dev Action proof validates constraints but actual mints use embedded mint proofs
     */
    function attackOrDefend(
        uint256[8] calldata proof,
        uint256[] calldata publicSignals
    )
        external
        nonReentrant
        gameActive
        roundActive
        validBunker(msg.sender)
    {
        Player storage p = players[msg.sender];
        if (p.deployedAmount == 0) revert NotDeployed();
        if (p.lastActionRound >= currentRound) revert AlreadyActedThisRound();
        
        // Updated action circuit has 70 public signals:
        // [0] serverPublicKeyHash, [1-8] rocketProofOut, [9-32] rocketPublicSignalsOut, 
        // [33-40] shieldProofOut, [41-64] shieldPublicSignalsOut, [65] currentBunker, [66] targetBunkerId
        // [67] playerAddress, [68] currentRound, [69] deployedAmount
        if (publicSignals.length != 70) revert InvalidActionProof();
        
        // Verify server authentication - only backend can generate valid proofs
        if (publicSignals[0] != serverPublicKeyHash) revert InvalidActionProof();
        
        // Verify current bunker matches player's actual bunker
        uint8 currentBunker = p.currentBunker;
        if (publicSignals[65] != currentBunker) revert InvalidActionProof();
        
        // Validate player address matches sender (prevents proof sharing)
        if (publicSignals[67] != uint256(uint160(msg.sender))) revert InvalidActionProof();
        
        // Validate round number matches current round (prevents replay)
        if (publicSignals[68] != currentRound) revert InvalidActionProof();
        
        // Validate deployment amount matches current deployment (prevents stale proofs)
        uint256 currentDeployment = getCurrentDeployment(msg.sender);
        if (publicSignals[69] > currentDeployment) revert InvalidActionProof();
        
        // Block scope for proof verification to reduce stack depth
        {
            // Convert action proof format for Groth16 verifier
            uint256[2] memory pointA = [proof[0], proof[1]];
            uint256[2][2] memory pointB = [[proof[2], proof[3]], [proof[4], proof[5]]];
            uint256[2] memory pointC = [proof[6], proof[7]];
            uint256[70] memory signals;
            for (uint256 i = 0; i < 70; i++) {
                signals[i] = publicSignals[i];
            }
            
            // Verify action proof validates all allocation constraints
            if (!actionVerifier.verifyProof(pointA, pointB, pointC, signals)) {
                revert InvalidActionProof();
            }
        }
        
        // Extract complete mint proof data from public signals
        uint256[8] memory rocketMintProof;
        uint256[24] memory rocketPublicSignals;
        uint256[8] memory shieldMintProof;  
        uint256[24] memory shieldPublicSignals;
        
        // Extract ROCKET mint proof (indices 1-8)
        for (uint256 i = 0; i < 8; i++) {
            rocketMintProof[i] = publicSignals[1 + i];
        }
        
        // Extract ROCKET public signals (indices 9-32)
        for (uint256 i = 0; i < 24; i++) {
            rocketPublicSignals[i] = publicSignals[9 + i];
        }
        
        // Extract SHIELD mint proof (indices 33-40)
        for (uint256 i = 0; i < 8; i++) {
            shieldMintProof[i] = publicSignals[33 + i];
        }
        
        // Extract SHIELD public signals (indices 41-64)
        for (uint256 i = 0; i < 24; i++) {
            shieldPublicSignals[i] = publicSignals[41 + i];
        }
        
        // Get target bunker address from public signals
        uint8 targetBunker = uint8(publicSignals[66]);  // targetBunkerId at index 66
        
        // Create ROCKET mint data with proper ProofPoints structure
        MintProof memory rocketMintData = MintProof({
            proofPoints: ProofPoints({
                a: [rocketMintProof[0], rocketMintProof[1]],
                b: [[rocketMintProof[2], rocketMintProof[3]], [rocketMintProof[4], rocketMintProof[5]]],
                c: [rocketMintProof[6], rocketMintProof[7]]
            }),
            publicSignals: rocketPublicSignals
        });
        
        // Create SHIELD mint data with proper ProofPoints structure  
        MintProof memory shieldMintData = MintProof({
            proofPoints: ProofPoints({
                a: [shieldMintProof[0], shieldMintProof[1]],
                b: [[shieldMintProof[2], shieldMintProof[3]], [shieldMintProof[4], shieldMintProof[5]]],
                c: [shieldMintProof[6], shieldMintProof[7]]
            }),
            publicSignals: shieldPublicSignals
        });
        
        // Mint ROCKET tokens to target bunker using embedded mint proof
        try ROCKET.privateMint(bunkerContracts[targetBunker], rocketMintData) {
            // ROCKET mint successful
        } catch {
            revert RocketMintFailed();
        }
        
        // Mint SHIELD tokens to player's current bunker using embedded mint proof
        try SHIELD.privateMint(bunkerContracts[currentBunker], shieldMintData) {
            // SHIELD mint successful  
        } catch {
            revert ShieldMintFailed();
        }
        
        p.lastActionRound = currentRound;
        
        emit PlayerAttacked(msg.sender, currentBunker, targetBunker, currentDeployment);
    }
    
    /**
     * @notice Retreat from the game and withdraw all tokens
     * @dev Has special transition logic, cannot use roundActive modifier
     */
    function retreat() external nonReentrant {
        if (players[msg.sender].currentBunker == 0) revert NotDeployed();
        
        // Don't allow retreat during round transition (when round ended but not resolved)
        if (currentRound > 0 && 
            block.timestamp >= rounds[currentRound].endTime && 
            !rounds[currentRound].resolved) {
            revert CannotRetreatDuringTransition();
        }
        
        uint8 currentBunker = players[msg.sender].currentBunker;
        uint256 currentAmount = getCurrentDeployment(msg.sender);
        uint256 deploymentDuration = block.timestamp - players[msg.sender].deploymentTimestamp;

        bool _onlyPlayer;
        if (bunkers[currentBunker].players.length == 1) {
            currentAmount = WWIII.balanceOf(bunkerContracts[currentBunker]);
            _onlyPlayer = true;
        }
        
        // Update bunker states
        if (_onlyPlayer) {
            bunkers[currentBunker].totalDeployed = 0;
        } else {
            bunkers[currentBunker].totalDeployed = 
            bunkers[currentBunker].totalDeployed > currentAmount 
                ? bunkers[currentBunker].totalDeployed - currentAmount 
                : 0;
        }
        
        // Reset player state
        players[msg.sender] = Player({
            currentBunker: 0,
            deployedAmount: 0,
            depositIndex: 0,
            deploymentTimestamp: 0,
            lastActionRound: 0
        });
        
        // Remove from bunker player array
        _removePlayerFromBunker(currentBunker, msg.sender);
        
        // Transfer tokens back to player using transferFrom
        if (currentAmount > 0) {
            WWIII.transferFrom(bunkerContracts[currentBunker], msg.sender, currentAmount);
        }
        
        emit PlayerRetreated(msg.sender, currentBunker, currentAmount, deploymentDuration);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Get current deployment amount with precision handling
     * @param player Player address
     * @return Current deployment amount, handling precision loss
     */
    function getCurrentDeployment(address player) public view returns (uint256) {
        Player memory p = players[player];
        if (p.currentBunker == 0) return 0;
        
        uint256 currentIndex = bunkers[p.currentBunker].index;
        if (currentIndex == 0) return 0; // Bunker destroyed
        if (p.depositIndex == 0) return 0;
        
        // Calculate proportional amount
        uint256 calculatedAmount = (p.deployedAmount * currentIndex) / p.depositIndex;
        
        // Handle precision loss - can't withdraw more than bunker has
        uint256 bunkerBalance = WWIII.balanceOf(bunkerContracts[p.currentBunker]);
        return calculatedAmount.min(bunkerBalance);
    }
    
    /**
     * @notice Check if move is valid between bunkers
     * @param from Source bunker ID
     * @param to Target bunker ID  
     * @return Whether move is allowed
     */
    function canMove(uint8 from, uint8 to) public pure returns (bool) {
        if (from == to) return false;
        if (from < 1 || from > 5 || to < 1 || to > 5) return false;
        
        // Bunker 3 connects to all others
        if (from == 3 || to == 3) return true;
        
        // Check specific connections
        if (from == 1) return (to == 2 || to == 4);
        if (from == 2) return (to == 1 || to == 5);
        if (from == 4) return (to == 1 || to == 5);
        if (from == 5) return (to == 2 || to == 4);
        
        return false;
    }
    
    /**
     * @notice Get comprehensive player information
     */
    function getPlayerInfo(address player) external view returns (
        uint8 currentBunker,
        uint256 deployedAmount,
        uint256 currentDeployment,
        uint256 deploymentTimestamp,
        bool hasActedThisRound,
        bool canAddTokens,
        bool canAct
    ) {
        Player memory p = players[player];
        bool hasActed = p.lastActionRound >= currentRound && currentRound > 0;
        bool isDeployed = p.currentBunker != 0;
        
        return (
            p.currentBunker,
            p.deployedAmount,
            getCurrentDeployment(player),
            p.deploymentTimestamp,
            hasActed,
            isDeployed && !hasActed,
            isDeployed && !hasActed
        );
    }
    
    /**
     * @notice Get bunker information
     */
    function getBunkerInfo(uint8 bunker) external view validBunkerId(bunker) returns (
        address bunkerContract,
        BunkerState memory bunkerState,
        bool isDestroyed
    ) {
        return (
            bunkerContracts[bunker],
            bunkers[bunker],
            bunkers[bunker].index == 0
        );
    }
    
    /**
     * @notice Check if any bunkers are in reset process
     */
    function hasActiveBunkerResets() public view returns (bool) {
        for (uint8 i = 1; i <= 5; i++) {
            if (bunkerResetNextIndex[i] > 0) return true;
        }
        return false;
    }
    
    /**
     * @notice Check if any bunkers are destroyed and need cleanup
     */
    function hasDestroyedBunkers() public view returns (bool) {
        for (uint8 i = 1; i <= 5; i++) {
            if (bunkers[i].index == 0) return true;
        }
        return false;
    }
    
    /**
     * @notice Get game state
     */
    function getGameState() external view returns (
        uint256 _currentRound,
        uint256 roundEndTime,
        bool roundResolved,
        bool _gameHalted,
        bool gameEnded,
        uint256 _remainingEmissions,
        uint256 currentRoundEmissions
    ) {
        uint256 vaultBalance = emissionVault.remainingEmissions();
        bool _gameEnded = (vaultBalance == 0 && currentRound > 0 && rounds[currentRound].resolved) ||
                         gamePhase == GamePhase.ENDED;
        
        return (
            currentRound,
            currentRound > 0 ? rounds[currentRound].endTime : 0,
            currentRound > 0 ? rounds[currentRound].resolved : false,
            gameHalted,
            _gameEnded,
            vaultBalance,
            currentRound > 0 ? rounds[currentRound].totalEmission : 0
        );
    }

    /*//////////////////////////////////////////////////////////////
                          GAME MANAGEMENT
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Start the game with specified combat start time
     * @param _combatStartTime When first round should begin
     */
    function startGame(uint256 _combatStartTime) external onlyOwner {
        if (gamePhase != GamePhase.DEPLOYMENT) revert GameAlreadyStarted();
        if (_combatStartTime <= block.timestamp) revert InvalidStartTime();
        
        combatStartTime = _combatStartTime;
        gamePhase = GamePhase.ACTIVE;
        
        emit GameStarted(_combatStartTime);
    }
    
    /**
     * @notice Start a new round (Waracle only)
     * @dev Only marks previous round resolved and starts new round
     */
    function startNewRound() external onlyWaracle nonReentrant {
        if (gamePhase != GamePhase.ACTIVE) revert GameNotActive();
        if (block.timestamp < combatStartTime) revert TooEarlyForFirstRound();
        if (hasActiveBunkerResets()) revert BunkerResetInProgress();
        if (hasDestroyedBunkers()) revert DestroyedBunkersNeedCleanup();
        if (block.timestamp < rounds[currentRound].endTime) revert RoundNotEnded();
        
        // Mark previous round as resolved if it exists
        if (currentRound > 0) {
            if (rounds[currentRound].resolved) revert RoundAlreadyResolved();
            rounds[currentRound].resolved = true;
            emit RoundResolved(currentRound, block.timestamp);
        }
        
        uint256 vaultBalance = emissionVault.remainingEmissions();
        if (vaultBalance == 0) {
            gamePhase = GamePhase.ENDED;
            emit GameEnded(currentRound, block.timestamp, 0);
            return;
        }
        
        currentRound++;
        uint256 emission = _calculateRoundEmission();
        
        rounds[currentRound] = Round({
            startTime: block.timestamp,
            endTime: block.timestamp + ROUND_DURATION,
            totalEmission: emission,
            resolved: false
        });
        
        emit RoundStarted(currentRound, block.timestamp, rounds[currentRound].endTime, emission);
    }
    
    /**
     * @notice Process round combat (Waracle only)
     * @param rocketBalances Decrypted ROCKET balances for each bunker
     * @param shieldBalances Decrypted SHIELD balances for each bunker
     * @return destroyedBunkers Array of bunker IDs that were destroyed
     */
    function WWIIInu(
        uint256[5] calldata rocketBalances,
        uint256[5] calldata shieldBalances
    ) external onlyWaracle nonReentrant returns (uint8[] memory destroyedBunkers) {
        if (currentRound == 0) revert NoActiveRound();
        if (block.timestamp < rounds[currentRound].endTime) revert RoundNotEnded();
        if (wwiiinuProcessed[currentRound]) revert RoundAlreadyResolved();
        
        uint256[5] memory damages;
        uint8[] memory destroyed = new uint8[](5);
        uint8 destroyedCount = 0;
        
        // Calculate damages
        for (uint8 i = 0; i < 5; i++) {
            if (rocketBalances[i] > shieldBalances[i]) {
                damages[i] = rocketBalances[i] - shieldBalances[i];
            }
        }
        
        emit WaracleSubmission(currentRound, rocketBalances, shieldBalances, damages);
        
        // Apply damage to bunkers and track destroyed ones
        for (uint8 i = 1; i <= 5; i++) {
            if (damages[i-1] > 0) {
                bool wasDestroyed = _applyDamageAndBurn(i, damages[i-1]);
                if (wasDestroyed) {
                    destroyed[destroyedCount] = i;
                    destroyedCount++;
                }
            }
        }
        
        // Burn all ROCKET and SHIELD tokens after combat resolution (clean slate for next round)
        _burnAllCombatTokens();
        
        // Distribute resources
        _distributeResources();
        
        // Return only destroyed bunkers
        destroyedBunkers = new uint8[](destroyedCount);
        for (uint8 i = 0; i < destroyedCount; i++) {
            destroyedBunkers[i] = destroyed[i];
        }

        wwiiinuProcessed[currentRound] = true;
        
        return destroyedBunkers;
    }
    
    /**
     * @notice Clean up destroyed bunker players in batches (Waracle only)
     * @param bunkerId Bunker to clean up
     * @param maxPlayers Maximum number of players to process in this transaction
     */
    function destroyBunker(uint8 bunkerId, uint256 maxPlayers) external onlyWaracle nonReentrant validBunkerId(bunkerId) {
        if (bunkers[bunkerId].index != 0) revert BunkerNotMarkedForDestruction();
        
        address[] storage bunkerPlayers = bunkers[bunkerId].players;
        uint256 playersRemaining = bunkerPlayers.length;
        
        if (playersRemaining == 0) {
            // Cleanup complete - reset bunker for reuse
            bunkers[bunkerId].index = BASE_INDEX;
            bunkers[bunkerId].lastUpdateRound = currentRound;
            emit BunkerDestroyed(bunkerId, currentRound, 0);
            return;
        }
        
        // Process players from the end of the array, up to maxPlayers
        uint256 toProcess = maxPlayers.min(playersRemaining);
        
        for (uint256 i = 0; i < toProcess; i++) {
            address player = bunkerPlayers[bunkerPlayers.length - 1];
            
            // Reset player state
            players[player] = Player({
                currentBunker: 0,
                deployedAmount: 0,
                depositIndex: 0,
                deploymentTimestamp: 0,
                lastActionRound: 0
            });
            
            // Remove player from array
            bunkerPlayers.pop();
        }
        
        // If all players processed, reset bunker for reuse
        if (bunkerPlayers.length == 0) {
            bunkers[bunkerId].index = BASE_INDEX;
            bunkers[bunkerId].lastUpdateRound = currentRound;
            emit BunkerDestroyed(bunkerId, currentRound, 0);
        }
    }

    /*//////////////////////////////////////////////////////////////
                          ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
    function setMinimumDeposit(uint256 newMinimum) external onlyOwner {
        uint256 oldMinimum = minimumDeposit;
        minimumDeposit = newMinimum;
        emit MinimumDepositUpdated(oldMinimum, newMinimum);
    }
    
    function setWaracle(address newWaracle) external onlyOwner {
        if (newWaracle == address(0)) revert InvalidWaracleAddress();
        address oldWaracle = trustedWaracle;
        trustedWaracle = newWaracle;
        emit WaracleUpdated(oldWaracle, newWaracle);
    }
    
    /**
     * @notice Set the server public key hash for action proof validation
     * @param newServerKeyHash Hash of the server's public key
     */
    function setServerPublicKeyHash(uint256 newServerKeyHash) external onlyOwner {
        serverPublicKeyHash = newServerKeyHash;
    }
    
    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert InvalidVaultAddress();
        address oldVault = address(emissionVault);
        emissionVault = EmissionVault(newVault);
        emit VaultUpdated(oldVault, newVault);
    }
    
    /**
     * @notice Transfer ownership of a token contract (for game migration)
     * @param tokenAddress Address of the token contract (ROCKET or SHIELD)
     * @param newOwner New owner address
     * @dev Uses Ownable2Step for secure two-step ownership transfer
     */
    function transferTokenOwnership(address tokenAddress, address newOwner) external onlyOwner {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        if (newOwner == address(0)) revert InvalidRecipient();
        
        // Validate token address is one of our managed tokens
        if (tokenAddress == address(ROCKET)) {
            ROCKET.transferOwnership(newOwner);
        } else if (tokenAddress == address(SHIELD)) {
            SHIELD.transferOwnership(newOwner);
        } else {
            revert InvalidTokenAddress();
        }
    }

    /**
     * @notice Accept ownership of a token contract (completes Ownable2Step transfer)
     * @param tokenAddress Address of the token contract (ROCKET or SHIELD)
     * @dev Must be called after transferTokenOwnership to complete the transfer
     */
    function acceptTokenOwnership(address tokenAddress) external onlyOwner {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        
        // Validate token address is one of our managed tokens
        if (tokenAddress == address(ROCKET)) {
            ROCKET.acceptOwnership();
        } else if (tokenAddress == address(SHIELD)) {
            SHIELD.acceptOwnership();
        } else {
            revert InvalidTokenAddress();
        }
    }
    
    function haltGame() external onlyOwner {
        gameHalted = true;
        gamePhase = GamePhase.HALTED;
        emit GameHalted(currentRound, block.timestamp);
    }
    
    /*//////////////////////////////////////////////////////////////
                        EMISSION MANAGEMENT
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Set emissions for current and future rounds
     * @param newEmissionAmount Amount to emit per round
     */
    function setRoundEmissions(uint256 newEmissionAmount) external onlyOwner {
        require(newEmissionAmount > 0, "Emission must be positive");
        
        uint256 vaultBalance = emissionVault.remainingEmissions();
        require(newEmissionAmount <= vaultBalance, "Emission exceeds vault balance");
        
        currentRoundEmission = newEmissionAmount;
        useManualEmissions = true;
        lastEmissionUpdateRound = currentRound;
        
        emit EmissionsUpdated(newEmissionAmount, currentRound, msg.sender);
    }
    
    /**
     * @notice Revert to legacy 3-year schedule (for compatibility)
     */
    function useLegacyEmissions() external onlyOwner {
        useManualEmissions = false;
        emit EmissionsReverted(currentRound, msg.sender);
    }
    
    /**
     * @notice Get current emission amount for round
     */
    function getCurrentEmission() external view returns (uint256) {
        return useManualEmissions ? currentRoundEmission : _calculateRoundEmission();
    }
    
    function emergencyHaltGame() external {
        if (gameHalted) revert AlreadyHalted();
        if (gamePhase != GamePhase.ACTIVE) revert GameNotActive();
        if (rounds[currentRound].endTime == 0) revert NoActiveRound();
        if (block.timestamp <= rounds[currentRound].endTime + 24 hours) revert MustWait24Hours();
        if (rounds[currentRound].resolved) revert RoundAlreadyResolved();
        
        gameHalted = true;
        gamePhase = GamePhase.HALTED;
        emit EmergencyHalt(currentRound, block.timestamp, msg.sender);
    }
    
    /**
     * @notice Emergency withdraw any ERC20 token accidentally sent to contract
     * @param token Token contract address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (token == address(WWIII)) revert CannotWithdrawGameToken();
        
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    /**
     * @notice Reset bunker index and player values in sequential batches
     * @param bunkerId Bunker to reset (1-5)
     * @param maxPlayersToProcess Maximum players to process this batch (0 = all remaining)
     * @dev Can only be called between rounds when players cannot act
     */
    function resetBunkerIndex(
        uint8 bunkerId, 
        uint256 maxPlayersToProcess
    ) external onlyWaracle validBunkerId(bunkerId) {
        // Safety: only between rounds
        if (currentRound > 0 && !rounds[currentRound].resolved && block.timestamp <= rounds[currentRound].endTime) {
            revert CannotActDuringTransition();
        }
        
        uint256 oldIndex = bunkers[bunkerId].index;
        if (oldIndex == 0) revert BunkerAlreadyDestroyed();
        if (oldIndex < BASE_INDEX * 10) revert IndexResetNotNeeded();
        
        address[] storage playersInBunker = bunkers[bunkerId].players;
        uint256 totalPlayers = playersInBunker.length;
        
        // Get next player index to process
        uint256 startIndex = bunkerResetNextIndex[bunkerId];
        
        if (startIndex >= totalPlayers && totalPlayers > 0) {
            revert ResetAlreadyCompleted();
        }
        
        // Calculate batch end
        uint256 batchEnd = maxPlayersToProcess == 0 
            ? totalPlayers 
            : (startIndex + maxPlayersToProcess).min(totalPlayers);
        
        // Reset players sequentially from startIndex
        for (uint256 i = startIndex; i < batchEnd; i++) {
            address player = playersInBunker[i];
            Player storage p = players[player];
            
            // Calculate preserved value
            uint256 preservedValue = (p.deployedAmount * oldIndex) / p.depositIndex;
            
            // Update with preserved value and reset index
            p.deployedAmount = preservedValue;
            p.depositIndex = BASE_INDEX;
        }
        
        // Update progress tracking
        bunkerResetNextIndex[bunkerId] = batchEnd;
        
        // If this completes the reset, finalize bunker
        if (batchEnd == totalPlayers) {
            bunkers[bunkerId].index = BASE_INDEX;
            bunkers[bunkerId].lastUpdateRound = currentRound;
            
            // Clear reset tracking
            bunkerResetNextIndex[bunkerId] = 0;
            
            emit BunkerIndexReset(bunkerId, oldIndex, totalPlayers);
        }
    }

    /*//////////////////////////////////////////////////////////////
                           INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Calculate round emission (supports both manual and legacy emissions)
     * @return Emission amount for current round
     */
    function _calculateRoundEmission() internal view returns (uint256) {
        uint256 vaultBalance = emissionVault.remainingEmissions();
        if (vaultBalance == 0) return 0;
        
        // If manual emissions are enabled, use set amount
        if (useManualEmissions) {
            // Return the manually set emission, capped by vault balance
            return currentRoundEmission.min(vaultBalance);
        }
        
        // Legacy 3-year schedule calculation (unchanged)
        
        // 3 rounds per day * 365.25 days = ~1095.75 rounds per year
        uint256 roundsPerYear = 1096;
        
        // Year 1: 3B tokens, Year 2: 2B tokens, Year 3: 1B tokens
        if (currentRound <= roundsPerYear) {
            // Year 1: ~2,739,726 tokens per round
            return 3000000000 ether / roundsPerYear;
        } else if (currentRound <= roundsPerYear * 2) {
            // Year 2: ~1,826,484 tokens per round  
            return 2000000000 ether / roundsPerYear;
        } else if (currentRound <= roundsPerYear * 3) {
            // Year 3: ~913,242 tokens per round
            return 1000000000 ether / roundsPerYear;
        } else {
            // After 3 years: distribute remaining if any
            return vaultBalance / 100; // Small remainder distribution
        }
    }
    
    /**
     * @notice Apply damage to bunker and burn WWIII tokens
     * @param bunkerId Bunker ID (1-5)
     * @param damage Net damage to apply (ROCKET - SHIELD)
     * @return Whether bunker was destroyed
     */
    function _applyDamageAndBurn(uint8 bunkerId, uint256 damage) internal returns (bool) {
        // Use actual bunker balance, not totalDeployed (which doesn't account for index changes)
        uint256 actualBalance = WWIII.balanceOf(bunkerContracts[bunkerId]);
        
        if (damage >= actualBalance) {
            // Bunker completely destroyed - burn all WWIII tokens
            if (actualBalance > 0) {
                WWIII.transferFrom(bunkerContracts[bunkerId], DEAD_ADDRESS, actualBalance);
            }
            
            // Mark for destruction
            bunkers[bunkerId].index = 0;
            bunkers[bunkerId].totalDeployed = 0;
            
            emit BunkerDestroyed(bunkerId, currentRound, actualBalance);
            return true;
        } else {
            // Partial damage - burn damaged amount and update index
            WWIII.transferFrom(bunkerContracts[bunkerId], DEAD_ADDRESS, damage);
            
            uint256 remaining = actualBalance - damage;
            bunkers[bunkerId].totalDeployed = remaining;
            
            uint256 oldIndex = bunkers[bunkerId].index;
            bunkers[bunkerId].index = (oldIndex * remaining) / (remaining + damage);
            
            emit BunkerDamaged(bunkerId, damage, remaining, bunkers[bunkerId].index);
            return false;
        }
    }
    
    /**
     * @notice Burn all ROCKET and SHIELD tokens from all bunkers (clean slate for next round)
     * @dev Called after combat resolution to clear all combat tokens
     */
    function _burnAllCombatTokens() internal {
        // Build array of all bunker addresses
        address[] memory bunkerAddresses = new address[](5);
        
        for (uint8 i = 1; i <= 5; i++) {
            bunkerAddresses[i-1] = bunkerContracts[i];
        }
        
        // Burn all ROCKET tokens from all bunkers
        ROCKET.burnAllTokensFrom(bunkerAddresses);
        
        // Burn all SHIELD tokens from all bunkers
        SHIELD.burnAllTokensFrom(bunkerAddresses);
    }
    
    /**
     * @notice Distribute resources to surviving bunkers
     */
    function _distributeResources() internal {
        uint256 totalEmission = rounds[currentRound].totalEmission;
        uint256 vaultBalance = emissionVault.remainingEmissions();
        uint256 toWithdraw = totalEmission.min(vaultBalance);
        
        if (toWithdraw == 0) return;
        
        bool success = emissionVault.withdraw(toWithdraw);
        if (!success) return;
        
        uint256 baseShare = toWithdraw / 6;
        
        for (uint8 i = 1; i <= 5; i++) {
            uint256 bunkerShare = (i == 3) ? baseShare * 2 : baseShare;
            
            if (bunkers[i].totalDeployed > 0 && bunkers[i].index > 0 && bunkers[i].players.length > 0) {
                WWIII.transfer(bunkerContracts[i], bunkerShare);
                _updateBunkerIndexForRewards(i, bunkerShare);
                emit ResourcesDistributed(i, bunkerShare, currentRound);
            } else {
                WWIII.transfer(DEAD_ADDRESS, bunkerShare);
                emit ResourcesSpoiled(i, bunkerShare, currentRound);
            }
        }
    }
    
    /**
     * @notice Update bunker index when resources are added
     */
    function _updateBunkerIndexForRewards(uint8 bunkerId, uint256 resources) internal {
        uint256 oldTotal = bunkers[bunkerId].totalDeployed;
        uint256 newTotal = oldTotal + resources;
        
        if (oldTotal > 0) {
            uint256 oldIndex = bunkers[bunkerId].index;
            bunkers[bunkerId].index = (oldIndex * newTotal) / oldTotal;
        }
        
        bunkers[bunkerId].totalDeployed = newTotal;
        bunkers[bunkerId].lastUpdateRound = currentRound;
    }
    
    /**
     * @notice Remove player from bunker array
     */
    function _removePlayerFromBunker(uint8 bunkerId, address player) internal {
        address[] storage playerArray = bunkers[bunkerId].players;
        uint256 _length = playerArray.length;
        for (uint256 i = 0; i < _length; i++) {
            if (playerArray[i] == player) {
                playerArray[i] = playerArray[playerArray.length - 1];
                playerArray.pop();
                break;
            }
        }
    }
}