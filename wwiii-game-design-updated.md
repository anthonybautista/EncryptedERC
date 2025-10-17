# WWIII Blockchain Game - Complete Design Document

## Table of Contents
1. [Game Overview](#game-overview)
2. [Core Mechanics](#core-mechanics)
3. [Token Economics](#token-economics)
4. [Smart Contract Architecture](#smart-contract-architecture)
5. [Game Flow](#game-flow)
6. [Technical Implementation](#technical-implementation)
7. [Security Considerations](#security-considerations)
8. [Future Considerations](#future-considerations)

## Game Overview

WWIII is a strategic blockchain-based game where players compete for resources by controlling and defending bunkers on a fixed map. The game operates in 8-hour rounds with persistent state and long-term incentives.

### Map Structure
- 5 bunkers arranged in a specific topology
- Bunker connections:
  - Bunker 1: Can attack/be attacked by 2, 3, 4
  - Bunker 2: Can attack/be attacked by 1, 3, 5
  - Bunker 3: Can attack/be attacked by ALL (1, 2, 4, 5) - Central position
  - Bunker 4: Can attack/be attacked by 1, 3, 5
  - Bunker 5: Can attack/be attacked by 2, 3, 4
- Bunker 3 receives 2x resources due to vulnerability

## Core Mechanics

### Player Actions

1. **Deploy/Deposit**
   - Minimum deposit: 10,000 WWIII tokens
   - Players can only occupy ONE bunker at a time
   - Adding tokens allowed only before taking round action
   - Records deployment timestamp for prestige

2. **Action (Attack/Defend)**
   - Single action per round combining attack and defend decisions
   - Must allocate deployment between ROCKET and SHIELD (minimum 1 each)
   - ROCKET tokens target enemy bunker (determined by proof)
   - SHIELD tokens go to player's current bunker (determined by proof)
   - Both allocations happen in single transaction with zero-knowledge proof
   - Tokens are minted to respective bunker addresses
   - No events reveal the split between ROCKET/SHIELD

4. **Move**
   - Relocate all deployed tokens to any connected bunker
   - Ends the player's turn for the round
   - No restrictions on destination bunker

5. **Retreat**
   - Withdraw all tokens
   - Reset deployment timestamp (lose prestige)
   - Exit the game

### Prestige System

Prestige is based on deployment duration:
- **Tracking**: Store initial deployment timestamp for each player
- **Calculation**: Current Time - Deployment Time = Prestige Score
- **Display**: Front-end converts timestamp to ranks/levels
- **Leaderboard**: Easy retrieval via getActiveUsers() function
- **Reset**: Timestamp resets to 0 on retreat

### Combat Resolution (Round End)

1. **Damage Calculation per Bunker**:
   ```
   Total ROCKET = current ROCKET balance at bunker
   Total SHIELD = current SHIELD balance at bunker
   Net Damage = Total ROCKET - Total SHIELD
   ```

2. **Apply Damage**:
   - If Net Damage > 0: Reduce bunker's total WWIII by Net Damage
   - If Net Damage ≤ 0: No effect

3. **Token Burning**:
   - After damage calculation, ALL ROCKET and SHIELD tokens are burned
   - Clean slate for next round - no accumulation
   - Prevents need to track previous balances

4. **Check for Total Destruction**:
   - If Net Damage ≥ Bunker's Total WWIII: Bunker is destroyed
   - All players in destroyed bunker are eliminated
   - Their deployment timestamps reset to 0 (lose all prestige)
   - Bunker index set to 0 (prevents division by zero)

5. **Resource Distribution**:
   - If bunker has survivors: Distribute resources proportionally
   - If bunker destroyed: Resources sent to dead address (spoiled)
   - Update bunker index to reflect new total WWIII

### Bunker Destruction and Recovery

When a bunker's damage equals or exceeds its total WWIII deployment, the bunker is completely destroyed. This is a critical game mechanic with permanent consequences for defenders.

#### Destruction Process

```solidity
// Track destruction progress
mapping(uint8 => uint256) public bunkerDestructionProgress; // Index of next player to process
mapping(uint8 => bool) public bunkerMarkedForDestruction;
bool public pendingCleanup; // Prevents next round until cleanup complete
```

#### Player Elimination

When a bunker is destroyed:
- All WWIII tokens in the bunker are immediately burned (sent to dead address)
- Players' tokens are lost permanently
- Player data cleanup happens separately to avoid gas issues

Players in destroyed bunkers face complete elimination:
- Deployment amount set to 0 (tokens already burned with bunker)
- Current bunker set to 0 (no longer deployed)
- Deployment timestamp reset to 0 (complete prestige loss)
- Cannot take any actions until redeploying fresh

#### Bunker Recovery

Destroyed bunkers become available for new occupation in the next round:

```solidity
// Precision constant for all calculations
uint256 constant PRECISION = 1e18;
uint256 constant BASE_INDEX = 10000 * PRECISION; // Base index with precision

function deploy(uint8 bunker, uint256 amount) external {
    require(amount >= minimumDeposit, "Below minimum");
    require(players[msg.sender].currentBunker == 0, "Already deployed");
    require(bunker >= 1 && bunker <= 5, "Invalid bunker");
    
    // Check if bunker was destroyed and needs reinitialization
    if (bunkerIndices[bunker].index == 0) {
        // Reinitialize destroyed bunker with precision
        bunkerIndices[bunker].index = BASE_INDEX; // Reset to base index with precision
        bunkerIndices[bunker].lastUpdateRound = currentRound;
        // players array already cleared during destruction
    }
    
    // Transfer tokens to bunker contract
    address bunkerContract = bunkerContracts[bunker];
    WWIII.transferFrom(msg.sender, bunkerContract, amount);
    
    // Update player state
    players[msg.sender] = Player({
        currentBunker: bunker,
        deployedAmount: amount,
        deploymentTimestamp: block.timestamp,
        lastActionRound: 0
    });
    
    playerDepositIndex[msg.sender] = bunkerIndices[bunker].index;
    bunkerMetadata[bunker].players.push(msg.sender);
    bunkerMetadata[bunker].totalDeployed += amount;
    
    emit PlayerDeployed(msg.sender, bunker, amount);
}
```

#### Safety Checks

All action functions must verify bunker validity:

```solidity
modifier validBunker(address player) {
    require(players[player].currentBunker != 0, "Not deployed");
    uint8 bunker = players[player].currentBunker;
    require(bunkerIndices[bunker].index != 0, "Bunker destroyed");
    require(!bunkerMarkedForDestruction[bunker], "Bunker pending destruction");
    _;
}

modifier gameActive() {
    require(!gameHalted, "Game is halted");
    require(remainingEmissions > 0 || !rounds[currentRound].resolved, "Game has ended");
    _;
}

function attackOrDefend(bytes calldata rocketProof, bytes calldata shieldProof) 
    external 
    gameActive
    validBunker(msg.sender) 
{
    // Action logic
}

function move(uint8 newBunker) 
    external 
    gameActive
    validBunker(msg.sender) 
{
    require(!bunkerMarkedForDestruction[newBunker], "Cannot move to destroyed bunker");
    // Movement logic
}

function deploy(uint8 bunker, uint256 amount) 
    external 
    gameActive 
{
    // Deployment logic
}

// Retreat is always allowed, even when game is halted
function retreat() external {
    require(players[msg.sender].currentBunker != 0, "Not deployed");
    
    uint8 currentBunker = players[msg.sender].currentBunker;
    
    // Calculate current balance using index
    uint256 currentAmount = getCurrentDeployment(msg.sender);
    
    // Update bunker metadata
    bunkerMetadata[currentBunker].totalDeployed -= currentAmount;
    
    // Reset player state
    players[msg.sender].currentBunker = 0;
    players[msg.sender].deployedAmount = 0;
    players[msg.sender].deploymentTimestamp = 0;
    
    // Transfer tokens from bunker contract to player
    Bunker(bunkerContracts[currentBunker]).withdrawToPlayer(msg.sender, currentAmount);
}

function move(uint8 newBunker) 
    external 
    gameActive
    validBunker(msg.sender) 
{
    require(canMove(players[msg.sender].currentBunker, newBunker), "Invalid move");
    require(players[msg.sender].lastActionRound < currentRound, "Already acted");
    require(!bunkerMarkedForDestruction[newBunker], "Cannot move to destroyed bunker");
    
    uint8 currentBunker = players[msg.sender].currentBunker;
    
    // Get current deployment amount
    uint256 currentAmount = getCurrentDeployment(msg.sender);
    
    // Update bunker metadata
    bunkerMetadata[currentBunker].totalDeployed -= currentAmount;
    bunkerMetadata[newBunker].totalDeployed += currentAmount;
    
    // Transfer tokens between bunker contracts
    Bunker(bunkerContracts[currentBunker]).transferToBunker(
        bunkerContracts[newBunker], 
        currentAmount
    );
    
    // Update player state
    players[msg.sender].currentBunker = newBunker;
    players[msg.sender].deployedAmount = currentAmount;
    playerDepositIndex[msg.sender] = bunkerIndices[newBunker].index;
    players[msg.sender].lastActionRound = currentRound;
}
```

#### Gas-Safe Round Resolution

```solidity
// Track if current round needs cleanup before next round can start
bool public pendingCleanup;

uint256 public constant ROUND_DURATION = 8 hours; // 8-hour rounds

// Process all bunker combat (only Waracle)
function WWIIInu() external {
    require(block.timestamp >= rounds[currentRound].endTime, "Round not ended");
    require(!gameHalted, "Game is halted");
    require(msg.sender == trustedWaracle, "Only Waracle can resolve");
    
    // If already processed combat but waiting for cleanup
    if (rounds[currentRound].resolved) {
        require(!pendingCleanup, "Cleanup required before next round");
        return; // Waracle must explicitly call startNewRound
    }
    
    // First call - process combat for all 5 bunkers
    bool anyDestroyed = false;
    for (uint8 i = 1; i <= 5; i++) {
        if (processBunkerCombat(i)) {
            anyDestroyed = true;
        }
    }
    
    // Distribute resources (destroyed bunkers get 0, resources spoiled)
    distributeRoundResources();
    
    // Mark combat as processed
    rounds[currentRound].resolved = true;
    
    if (anyDestroyed) {
        // Need cleanup before next round
        pendingCleanup = true;
        emit CleanupRequired(currentRound);
    }
    // Waracle must explicitly call startNewRound after processing
}

// Start next round (only Waracle, after processing complete)
function startNewRound() external onlyWaracle {
    require(rounds[currentRound].resolved, "Current round not resolved");
    require(!pendingCleanup, "Cleanup required first");
    require(remainingEmissions > 0, "Game has ended");
    
    currentRound++;
    rounds[currentRound] = Round({
        startTime: block.timestamp,
        endTime: block.timestamp + ROUND_DURATION,
        totalEmission: calculateRoundEmission(),
        resolved: false
    });
    
    emit RoundStarted(currentRound, rounds[currentRound].startTime, rounds[currentRound].endTime);
}

// In WWIIIGame.sol - Called by Waracle EOA
function processBunkerCombat(uint8 bunker, uint256 rocketBalance, uint256 shieldBalance) external returns (bool) {
    require(msg.sender == trustedWaracle, "Only waracle");
    address bunkerContract = bunkerContracts[bunker];
    
    // Waracle provides decrypted balances
    uint256 netDamage = 0;
    if (rocketBalance > shieldBalance) {
        netDamage = rocketBalance - shieldBalance;
    }
    
    // Burn all combat tokens after calculation
    if (rocketBalance > 0 || shieldBalance > 0) {
        Bunker(bunkerContract).burnCombatTokens(ROCKET, SHIELD);
    }
    
    // Calculate net damage
    if (newRockets > newShields) {
        uint256 netDamage = newRockets - newShields;
        
        if (netDamage >= bunkerMetadata[bunker].totalDeployed) {
            // Bunker destroyed - burn all WWIII in bunker contract
            uint256 burnAmount = bunkerMetadata[bunker].totalDeployed;
            bunkerMetadata[bunker].totalDeployed = 0;
            bunkerIndices[bunker].index = 0;
            bunkerMarkedForDestruction[bunker] = true;
            bunkerDestructionProgress[bunker] = 0;
            
            // Tell bunker contract to burn its tokens
            if (burnAmount > 0) {
                Bunker(bunkerContract).burnTokens(burnAmount);
            }
            
            emit BunkerDestroyed(bunker, currentRound);
            return true;
        } else {
            // Partial damage - update index with precision
            uint256 remaining = bunkerMetadata[bunker].totalDeployed - netDamage;
            bunkerMetadata[bunker].totalDeployed = remaining;
            uint256 oldIndex = bunkerIndices[bunker].index;
            
            // Use precision to avoid rounding errors
            bunkerIndices[bunker].index = (oldIndex * remaining * PRECISION) / 
                                         ((remaining + netDamage) * PRECISION);
        }
    }
    return false;
}

// Distribute resources, spoiling any for destroyed bunkers
function distributeRoundResources() internal {
    uint256 baseShare = rounds[currentRound].totalEmission / 6;
    
    // Safely withdraw what's available (don't fail if less)
    uint256 vaultBalance = emissionVault.remainingEmissions();
    uint256 toWithdraw = Math.min(rounds[currentRound].totalEmission, vaultBalance);
    
    if (toWithdraw == 0) {
        // No emissions left - game naturally ends
        emit GameEnded(currentRound, block.timestamp, 0);
        return;
    }
    
    // Withdraw what we can
    require(emissionVault.withdraw(toWithdraw), "Vault withdrawal failed");
    
    // Adjust shares if we got less than expected
    if (toWithdraw < rounds[currentRound].totalEmission) {
        baseShare = toWithdraw / 6;
    }
    
    // Distribute directly to bunker contracts
    for (uint8 i = 1; i <= 5; i++) {
        uint256 bunkerShare = (i == 3) ? baseShare * 2 : baseShare;
        
        if (bunkerMetadata[i].totalDeployed > 0) {
            // Transfer directly to bunker contract
            address bunkerContract = bunkerContracts[i];
            WWIII.transfer(bunkerContract, bunkerShare);
            
            // Update bunker index to reflect new tokens
            updateBunkerIndexForRewards(i, bunkerShare);
            
            emit ResourcesDistributed(i, bunkerShare, currentRound);
        } else {
            // Destroyed bunker - resources spoiled
            WWIII.transfer(DEAD_ADDRESS, bunkerShare);
            emit ResourcesSpoiled(i, bunkerShare, currentRound);
        }
    }
}

// Public function to clean up player data in batches (no token transfers needed)
function processDestroyedBunkerPlayers(uint8 bunker, uint256 batchSize) external {
    require(bunkerMarkedForDestruction[bunker], "Bunker not destroyed");
    require(pendingCleanup, "No cleanup pending");
    
    uint256 startIndex = bunkerDestructionProgress[bunker];
    uint256 playersLength = bunkers[bunker].players.length;
    uint256 endIndex = startIndex + batchSize;
    
    if (endIndex > playersLength) {
        endIndex = playersLength;
    }
    
    // Just reset player data - tokens already burned
    for (uint256 i = startIndex; i < endIndex; i++) {
        address player = bunkers[bunker].players[i];
        players[player].currentBunker = 0;
        players[player].deployedAmount = 0;
        players[player].deploymentTimestamp = 0;
        playerDepositIndex[player] = 0;
    }
    
    bunkerDestructionProgress[bunker] = endIndex;
    
    // If all players processed, clean up
    if (endIndex == playersLength) {
        delete bunkers[bunker].players;
        bunkerMarkedForDestruction[bunker] = false;
        bunkerDestructionProgress[bunker] = 0;
        emit BunkerClearanceComplete(bunker);
        
        // Check if all destroyed bunkers are now cleaned
        checkCleanupComplete();
    }
}

// Check if all cleanup is done
function checkCleanupComplete() internal {
    for (uint8 i = 1; i <= 5; i++) {
        if (bunkerMarkedForDestruction[i]) {
            return; // Still have bunkers to clean
        }
    }
    
    // All cleaned up
    pendingCleanup = false;
    emit CleanupComplete(currentRound);
    // Note: Waracle must still call startNewRound() to begin next round
}
```

### Cleanup Incentive Mechanism

The game ensures destroyed bunkers are fully cleaned before progression:

1. **Mandatory Cleanup**: New rounds CANNOT start until all destroyed bunkers are cleaned
2. **Natural Incentive**: Players want the game to continue to earn resources
3. **Batch Processing**: Anyone can call cleanup with their preferred batch size
4. **Automatic Progression**: Once all bunkers cleaned, next round starts automatically

Since players cannot take any actions until the new round starts, the community has a natural incentive to perform cleanup. In the worst case, the contract owner can call the cleanup function to keep the game moving.

Example cleanup scenario:
- Round 50 ends with Bunker 3 (250 players) destroyed
- `WWIIInu()` processes combat and sets `pendingCleanup = true`
- Game is paused - no new round starts
- Any player calls `processDestroyedBunkerPlayers(3, 100)` 
- Another player calls `processDestroyedBunkerPlayers(3, 100)`
- Final player calls `processDestroyedBunkerPlayers(3, 50)`
- Last call triggers `checkCleanupComplete()` which starts Round 51

This design ensures:
- No zombie players can exist between rounds
- Game state remains consistent
- Community self-regulates to keep game running
- Large battles don't brick the game

### Deployment Architecture

The game requires deployment of multiple contracts:

1. **Deploy Bunker Contracts (5 instances)**
   - Each bunker gets its own contract instance
   - Bunker 1-5 deployed with unique IDs
   - Each contract has a unique address for receiving tokens

2. **Deploy Main Contracts**
   - WWIIIGame.sol with references to all 5 bunker addresses
   - Configure Waracle address in WWIIIGame contract
   - WWIII.sol token contract
   - ROCKET.sol and SHIELD.sol with proof verification

3. **Contract Interactions**
   ```
   Player → WWIIIGame → Bunker Contract → WWIII Tokens
                     ↓
                 Waracle → Decrypt balances off-chain
                     ↓
              ROCKET/SHIELD → Mint to Bunker addresses
   ```

**Flow Example:**
- Player deploys 10k WWIII to Bunker 1 → tokens transfer from player to Bunker1 contract
- Player adds 5k more WWIII → tokens transfer from player to Bunker1 contract (no action used)
- Player attacks Bunker 3 → ROCKET tokens minted to Bunker3 contract address (action used for round)
- Player cannot move or defend this round (already used action)
- Round ends → check ROCKET/SHIELD balances of each bunker contract

This architecture ensures:
- ROCKET/SHIELD can be minted to specific bunker addresses
- Token balances are properly segregated by bunker
- Hidden information is maintained (proofs determine mint location)
- Clean token flow between bunkers during moves

## Token Economics

### Token Distribution
- **Total Supply**: 10 billion WWIII tokens (all pre-minted)
  - 6 billion: Stored in EmissionVault for game rewards
  - 2 billion: Player circulation
  - 2 billion: Team allocation

### Emission Schedule

Using a declining emission model with definitive end:

**Year 1**: 3,000,000,000 tokens (50% of emission pool)
- Per round: ~2,739,726 tokens

**Year 2**: 2,000,000,000 tokens (33.33% of emission pool)
- Per round: ~1,826,484 tokens

**Year 3**: 1,000,000,000 tokens (16.67% of emission pool)
- Per round: ~913,242 tokens

**Game End**: When emission pool is exhausted
- Final round distributes remaining balance
- No new rounds start after final distribution
- Players can withdraw but no new actions

### Final Round Handling
```solidity
if (remainingEmissions < standardRoundEmission) {
    // Final round - distribute everything left
    currentRoundEmission = remainingEmissions;
    isFinalRound = true;
}
```

### Emergency Functions
```solidity
bool public gameHalted;
uint256 public lastRoundEndTime;

// Owner can halt game
function haltGame() external onlyOwner {
    gameHalted = true;
    emit GameHalted(currentRound, block.timestamp);
}

// Anyone can trigger emergency halt if Waracle is unresponsive
function emergencyHaltGame() external {
    require(!gameHalted, "Already halted");
    require(rounds[currentRound].endTime > 0, "No active round");
    require(block.timestamp > rounds[currentRound].endTime + 24 hours, "Must wait 24 hours");
    require(!rounds[currentRound].resolved, "Round already resolved");
    
    gameHalted = true;
    emit EmergencyHalt(currentRound, block.timestamp, msg.sender);
}
```

When game is halted:
- No new rounds can start
- No player actions allowed (attack/defend/move/deploy)
- Players can only retreat (withdraw) their tokens
- Allows for migration to new contracts/mechanics
- Emergency halt prevents indefinite lock if Waracle disappears

### Round Distribution
- Bunkers 1, 2, 4, 5: Each receives X tokens
- Bunker 3: Receives 2X tokens
- Where X = Round Emission / 6

### Minimum Deposit
- Fixed at 10,000 WWIII tokens
- Owner can update via `setMinimumDeposit()` function
- Not programmatically adjusted

## Smart Contract Architecture

### Core Contracts

1. **WWIIIGame.sol** - Main game contract
   - Manages player deposits and actions
   - Tracks player states and bunker metadata
   - Handles round progression
   - Coordinates between bunker contracts

2. **Bunker.sol** - Individual bunker contracts (5 deployed)
   - Holds WWIII tokens for all players in that bunker
   - Receives ROCKET/SHIELD tokens during attacks/defenses
   - Only allows token transfers authorized by main game contract
   - Each has a unique address for token minting

3. **Waracle** - Admin EOA for round resolution
   - NOT a contract - an admin-controlled EOA
   - Has off-chain private keys to decrypt ROCKET/SHIELD balances
   - Calls `WWIIInu()` function on WWIIIGame contract
   - Provides damage calculations based on decrypted balances
   - Cannot be replaced or upgraded without migration

4. **WWIII.sol** - Standard ERC20 token contract
   - All 10 billion tokens pre-minted at deployment
   - No minting capability after deployment

5. **EmissionVault.sol** - Token vault for game emissions
   - Holds 6 billion WWIII tokens
   - Allows WWIIIGame to withdraw for round rewards
   - Admin can emergency withdraw if needed

5. **ROCKET.sol & SHIELD.sol** - Encrypted ERC20 contracts (eERC20)
   - Use ElGamal encryption over BabyJubJub curve
   - Special mint functions requiring zero-knowledge proofs
   - Proofs validate allocation and contain target bunker addresses
   - Balances stored as encrypted ciphertexts (EGCT)
   - Only holders of decryption keys can read true balances
   - Burn function allows bunkers to clear tokens after combat

### Data Structures and Events

```solidity
// Precision constant for all index calculations
uint256 constant PRECISION = 1e18;
uint256 constant BASE_INDEX = 10000 * PRECISION;

// In WWIIIGame.sol
mapping(uint8 => address) public bunkerContracts; // Bunker ID to contract address

struct BunkerMetadata {
    uint256 totalDeployed; // Tracked for quick access
    uint256 lastRocketBalance;
    uint256 lastShieldBalance;
    uint256 resourceShare; // 1x or 2x
    address[] players;
}

struct Player {
    uint8 currentBunker; // 0 = not deployed, 1-5 = bunker number
    uint256 deployedAmount;
    uint256 deploymentTimestamp; // For prestige calculation
    uint256 lastActionRound;
}

struct Round {
    uint256 startTime;
    uint256 endTime;
    uint256 totalEmission;
    bool resolved;
}

// Events for indexing
event PlayerDeployed(address indexed player, uint8 indexed bunker, uint256 amount, uint256 timestamp);
event PlayerAddedTokens(address indexed player, uint8 indexed bunker, uint256 amount, uint256 newTotal);
event PlayerMoved(address indexed player, uint8 indexed fromBunker, uint8 indexed toBunker, uint256 amount, uint256 round);
event PlayerRetreated(address indexed player, uint8 fromBunker, uint256 amount, uint256 deploymentDuration);

event RoundStarted(uint256 indexed round, uint256 startTime, uint256 endTime, uint256 emission);
event RoundResolved(uint256 indexed round, uint256 timestamp);
event BunkerDamaged(uint8 indexed bunker, uint256 damage, uint256 remainingWWIII, uint256 newIndex);
event BunkerDestroyed(uint8 indexed bunker, uint256 round, uint256 totalLost);
event BunkerClearanceComplete(uint8 indexed bunker, uint256 timestamp);
event ResourcesDistributed(uint8 indexed bunker, uint256 amount, uint256 round);
event ResourcesSpoiled(uint8 indexed bunker, uint256 amount, uint256 round);

event GameHalted(uint256 atRound, uint256 timestamp);
event EmergencyHalt(uint256 atRound, uint256 timestamp, address triggeredBy);
event GameEnded(uint256 finalRound, uint256 timestamp, uint256 totalDistributed);
event CleanupRequired(uint256 round, uint8[] destroyedBunkers);
event CleanupComplete(uint256 round, uint256 timestamp);

// Waracle transparency event
event WaracleSubmission(
    uint256 indexed round,
    uint256[5] rocketBalances,
    uint256[5] shieldBalances,
    uint256[5] damages,
    uint8 destroyedBunkers  // Bit flags: bunker i destroyed if (destroyedBunkers & (1 << i)) != 0
);

// In Bunker.sol (each bunker contract)
contract Bunker {
    address public immutable gameContract;
    uint8 public immutable bunkerId;
    
    modifier onlyGame() {
        require(msg.sender == gameContract, "Only game contract");
        _;
    }
    
    // Receive and hold WWIII tokens
    function receiveDeposit(address from, uint256 amount) external onlyGame {
        WWIII.transferFrom(from, address(this), amount);
    }
    
    // Transfer tokens to another bunker (for moves)
    function transferToBunker(address targetBunker, uint256 amount) external onlyGame {
        WWIII.transfer(targetBunker, amount);
    }
    
    // Withdraw tokens to player (for retreats)
    function withdrawToPlayer(address player, uint256 amount) external onlyGame {
        WWIII.transfer(player, amount);
    }
    
    // Burn tokens when bunker destroyed
    function burnTokens(uint256 amount) external onlyGame {
        WWIII.transfer(DEAD_ADDRESS, amount);
    }
}

// EmissionVault.sol - Holds pre-minted emission tokens
contract EmissionVault {
    address public gameContract;
    address public admin;
    IERC20 public immutable WWIII;
    uint256 public totalWithdrawn;
    
    modifier onlyGame() {
        require(msg.sender == gameContract, "Only game");
        _;
    }
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _wwiii, address _admin) {
        WWIII = IERC20(_wwiii);
        admin = _admin;
        // Game contract set later
    }
    
    function setGameContract(address _game) external onlyAdmin {
        require(gameContract == address(0), "Already set");
        gameContract = _game;
    }
    
    // Game withdraws emissions for round distribution
    function withdraw(uint256 amount) external onlyGame returns (bool) {
        require(WWIII.balanceOf(address(this)) >= amount, "Insufficient balance");
        totalWithdrawn += amount;
        return WWIII.transfer(gameContract, amount);
    }
    
    // Emergency admin withdrawal
    function emergencyWithdraw(uint256 amount, address to) external onlyAdmin {
        require(to != address(0), "Invalid recipient");
        WWIII.transfer(to, amount);
        emit EmergencyWithdrawal(amount, to, block.timestamp);
    }
    
    // View remaining emissions
    function remainingEmissions() external view returns (uint256) {
        return WWIII.balanceOf(address(this));
    }
    
    event EmergencyWithdrawal(uint256 amount, address to, uint256 timestamp);
}
```

### Index System and Balance Calculation

The index system tracks proportional changes to each bunker's total WWIII:

```solidity
struct BunkerIndex {
    uint256 index; // Starts at BASE_INDEX (10000 * PRECISION)
    uint256 lastUpdateRound;
}

mapping(address => uint256) public playerDepositIndex; // Index when player deposited
mapping(address => uint256) public playerLastUpdateRound; // Last round player took action

// Calculate current balance (view function) with precision:
function getCurrentDeployment(address player) public view returns (uint256) {
    Player memory p = players[player];
    if (p.currentBunker == 0) return 0;
    
    uint256 currentIndex = bunkerIndices[p.currentBunker].index;
    if (currentIndex == 0) return 0; // Bunker was destroyed
    
    uint256 depositIndex = playerDepositIndex[player];
    // Use precision in calculation
    return (p.deployedAmount * currentIndex) / depositIndex;
}

// In WWIIIGame.processBunkerDamage() - handling destroyed bunkers:
function processBunkerDamage(uint8 bunker, uint256 netDamage) internal {
    if (netDamage >= bunkers[bunker].totalDeployed) {
        // Bunker completely destroyed
        bunkers[bunker].totalDeployed = 0;
        bunkerIndices[bunker].index = 0; // Mark as destroyed
        
        // Clear all players in this bunker
        for (uint i = 0; i < bunkers[bunker].players.length; i++) {
            address player = bunkers[bunker].players[i];
            players[player].currentBunker = 0;
            players[player].deployedAmount = 0;
            players[player].deploymentTimestamp = 0; // Reset prestige
        }
        delete bunkers[bunker].players; // Clear player array
        
        // Emit destruction event
        emit BunkerDestroyed(bunker, currentRound);
    } else {
        // Partial damage - update index with precision
        uint256 remainingWWIII = bunkers[bunker].totalDeployed - netDamage;
        bunkers[bunker].totalDeployed = remainingWWIII;
        
        uint256 oldIndex = bunkerIndices[bunker].index;
        // Calculate new index with precision to minimize rounding errors
        bunkerIndices[bunker].index = (oldIndex * remainingWWIII * PRECISION) / 
                                     ((remainingWWIII + netDamage) * PRECISION);
    }
}

// Update bunker index when resources are distributed
function updateBunkerIndexForRewards(uint8 bunker, uint256 resources) internal {
    uint256 oldIndex = bunkerIndices[bunker].index;
    uint256 oldTotal = bunkerMetadata[bunker].totalDeployed;
    uint256 newTotal = oldTotal + resources;
    
    // Update index with precision for resource addition
    bunkerIndices[bunker].index = (oldIndex * newTotal * PRECISION) / 
                                  (oldTotal * PRECISION);
    
    bunkerMetadata[bunker].totalDeployed = newTotal;
}

// Token Flow Summary:
// 1. Pre-minted tokens stored in EmissionVault
// 2. Each round: Game withdraws from vault
// 3. Game transfers directly to bunker contracts
// 4. Bunker indices updated to reflect new proportions
// 5. Players' shares calculated dynamically via index system
```

**Handling Inactive Players:**
- Players who don't act still benefit/suffer from their bunker's performance
- Index tracks all changes regardless of player activity
- When player finally acts (retreat/move/add), their balance is calculated from their last index

## Game Flow

### Round Lifecycle

1. **Round Active** (8 hours from when started)
   - Players can take one action (attack/defend/move)
   - Players can add tokens BEFORE taking their action
   - New players can join (unless game has ended)
   - Once a player takes an action, they cannot add tokens or take another action until next round

2. **Round End** (after 8 hours)
   - No new actions allowed
   - Round waits for Waracle processing
   - Players cannot act until next round starts

3. **Resolution & Next Round Start**
   - Waracle calls WWIIInu() to process all bunkers
   - Calculate damage and casualties
   - Distribute resources
   - Update bunker indices
   - If not final round: Waracle calls startNewRound()
   - New round begins with fresh 8-hour timer
   - If final round: Game enters withdrawal-only mode

4. **Emergency Halt**
   - If Waracle doesn't process within 24 hours of round end
   - Anyone can call emergencyHaltGame()
   - Game enters withdrawal-only mode

### Player Flow

1. **Entry**
   - Approve WWIII tokens
   - Call `deploy(bunkerID, amount)`
   - Minimum 10,000 WWIII required
   - Deployment timestamp recorded

2. **Gameplay**
   - Each round: Choose action wisely (attack/defend/move)
   - All bunkers except your own are potential targets
   - Monitor all bunker health
   - Build prestige through continuous deployment

3. **Exit**
   - Call `retreat()` to withdraw
   - Lose all prestige

## Technical Implementation

### eERC20 Integration

The game leverages the Encrypted ERC20 (eERC20) protocol for hidden information warfare:

1. **Encryption System**
   - ElGamal encryption over BabyJubJub elliptic curve
   - All ROCKET/SHIELD balances stored as encrypted ciphertexts (EGCT)
   - Only Waracle holds decryption keys off-chain
   - Maintains complete fog of war for players

2. **Zero-Knowledge Proofs**
   - Action proofs validate ROCKET + SHIELD = deployment amount
   - Minimum 1 token allocated to each type
   - Target bunker encrypted within proof
   - Circom circuits ensure validity without revealing strategy

3. **Key Architectural Decisions**
   - Players DO NOT need eERC20 registration (only interact with WWIIIGame)
   - Bunker contracts are the eERC20 token holders
   - Single action proof per round (not separate attack/defend)
   - Burn-after-calculation approach (no balance accumulation)
   - Waracle is an EOA, not a contract (simpler, more secure)

### Key Functions

```solidity
// WWIIIGame.sol
function deploy(uint8 bunker, uint256 amount) external;
function performAction(
    uint256 rocketAmount,
    uint256 shieldAmount,
    uint8 targetBunker,
    bytes calldata actionProof
) external;
function move(uint8 newBunker) external;
function retreat() external;
function addTokens(uint256 amount) external;
function getCurrentDeployment(address player) external view returns (uint256);
function getActiveUsers() external view returns (address[] memory, uint256[] memory);
function setMinimumDeposit(uint256 newMinimum) external onlyOwner;
function haltGame() external onlyOwner;
function processDestroyedBunkerPlayers(uint8 bunker, uint256 batchSize) external;

// WWIIIGame.sol - Main game contract
function WWIIInu(uint256[5] calldata rocketBalances, uint256[5] calldata shieldBalances) external; // Called by Waracle with decrypted data
function processBunkerCombat(uint8 bunker, uint256 rockets, uint256 shields, uint256 damage) internal returns (bool); // Process individual bunker
function distributeResources() internal; // Distribute round resources

// Bunker.sol - Individual bunker contracts
function burnCombatTokens(address rocketToken, address shieldToken) external; // Burns all ROCKET/SHIELD after combat

// ROCKET.sol & SHIELD.sol - Encrypted eERC20 contracts  
function mint(address to, uint256 amount, bytes calldata proof) external; // Proof validates allocation
function burn(address from, uint256 amount) external; // For clearing after combat
function balanceOf(address account) external view returns (EGCT memory); // Returns encrypted balance
```

### View Functions for UI

The game provides comprehensive view functions to power a data-rich UI:

### Pre-Game Deployment Phase

The game includes a 2-day deployment phase before combat begins:

```solidity
uint256 public constant DEPLOYMENT_PHASE_DURATION = 2 days;
uint256 public gameStartTime; // When deployment phase begins
uint256 public combatStartTime; // When first combat round begins

bool public deploymentPhaseActive;

function startDeploymentPhase() external onlyOwner {
    require(gameStartTime == 0, "Already started");
    gameStartTime = block.timestamp;
    combatStartTime = block.timestamp + DEPLOYMENT_PHASE_DURATION;
    deploymentPhaseActive = true;
    emit DeploymentPhaseStarted(gameStartTime, combatStartTime);
}

function updateCombatStartTime(uint256 newCombatStartTime) external onlyOwner {
    require(gameStartTime > 0, "Game not started");
    require(block.timestamp < combatStartTime, "Combat already started");
    require(newCombatStartTime > block.timestamp, "Start time must be in future");
    require(newCombatStartTime >= gameStartTime + 1 days, "Must allow at least 1 day deployment");
    
    uint256 oldCombatStartTime = combatStartTime;
    combatStartTime = newCombatStartTime;
    emit CombatStartTimeUpdated(oldCombatStartTime, newCombatStartTime);
}

// During deployment phase:
// - Players can deploy to bunkers
// - Players can add tokens
// - NO combat actions allowed
// - NO movement allowed
// - Retreats allowed
```

### View Functions for UI

```solidity
// Get complete player state
function getPlayerInfo(address player) external view returns (
    uint8 currentBunker,
    uint256 deployedAmount,
    uint256 currentDeployment, // Actual amount after index calculations
    uint256 deploymentTimestamp,
    bool hasActedThisRound,
    bool canAddTokens, // true if deployed and hasn't acted
    bool canAct // true if deployed and hasn't acted
) {
    Player memory p = players[player];
    return (
        p.currentBunker,
        p.deployedAmount,
        getCurrentDeployment(player),
        p.deploymentTimestamp,
        p.lastActionRound >= currentRound,
        p.currentBunker != 0 && p.lastActionRound < currentRound,
        p.currentBunker != 0 && p.lastActionRound < currentRound
    );
}

// Get bunker state (excluding hidden combat tokens)
function getBunkerInfo(uint8 bunker) external view returns (
    address bunkerContract,
    uint256 totalDeployed,
    uint256 playerCount,
    uint256 currentIndex,
    bool isDestroyed,
    bool pendingCleanup,
    uint256 pendingResources
) {
    address bContract = bunkerContracts[bunker];
    return (
        bContract,
        bunkerMetadata[bunker].totalDeployed,
        bunkerMetadata[bunker].players.length,
        bunkerIndices[bunker].index,
        bunkerIndices[bunker].index == 0,
        bunkerMarkedForDestruction[bunker],
        bunkerMetadata[bunker].pendingResources
    );
}

// Get overall game state
function getGameState() external view returns (
    uint256 currentRound,
    uint256 roundEndTime,
    bool roundResolved,
    bool pendingCleanup,
    bool gameHalted,
    bool gameEnded,
    uint256 remainingEmissions,
    uint256 currentRoundEmissions
) {
    return (
        currentRound,
        rounds[currentRound].endTime,
        rounds[currentRound].resolved,
        pendingCleanup,
        gameHalted,
        remainingEmissions == 0 && rounds[currentRound].resolved,
        remainingEmissions,
        rounds[currentRound].totalEmission
    );
}

// Get bunker connections for move validation
function getConnectedBunkers(uint8 bunker) external pure returns (uint8[] memory) {
    if (bunker == 1) return [2, 3, 4];
    if (bunker == 2) return [1, 3, 5];
    if (bunker == 3) return [1, 2, 4, 5]; // All connected
    if (bunker == 4) return [1, 3, 5];
    if (bunker == 5) return [2, 3, 4];
    revert("Invalid bunker");
}
```

These functions enable the UI to:
- Show if a player can still act this round
- Display accurate token balances after damage/rewards
- Show bunker health status (but NOT actual ROCKET/SHIELD values)
- Indicate which bunkers can be moved to
- Display game phase (active/cleanup/ended/halted)
- Show prestige leaderboards with timestamps
- Warn about destroyed/pending cleanup bunkers

Note: The UI cannot show current ROCKET/SHIELD balances to maintain the fog of war. Players must make decisions based on incomplete information. Only the Waracle can decrypt these balances using off-chain keys.

### Event Usage for Database Indexing

The event system enables game state reconstruction while preserving action anonymity:

1. **Player Activity Tracking**
   - `PlayerDeployed`: Track new entrants with bunker choice and timestamp
   - `PlayerAddedTokens`: Monitor reinforcements
   - `PlayerMoved`: Track strategic relocations
   - `PlayerRetreated`: Record exits with prestige (deployment duration)

2. **Combat and Damage Tracking**
   - `BunkerDamaged`: Log partial damage with new totals
   - `BunkerDestroyed`: Record eliminations with total losses
   - Combat actions remain hidden - no events reveal attack/defend choices

3. **Round and Resource Tracking**
   - `RoundStarted/Resolved`: Frame round boundaries
   - `ResourcesDistributed/Spoiled`: Track economic flow
   - `CleanupRequired/Complete`: Monitor game maintenance

4. **Game State Changes**
   - `GameHalted/Ended`: Major state transitions
   - Index updates captured in damage events

5. **Waracle Transparency**
   - `WaracleSubmission`: Complete record of all balance revelations
   - Contains ROCKET/SHIELD balances, calculated damages, and destruction flags
   - Enables post-game validation of all Waracle decisions

This event architecture enables:
- Player history reconstruction (without revealing strategies)
- Bunker health monitoring after round resolution
- Economic analysis of resource flow
- Prestige leaderboard tracking
- Game state tracking without compromising hidden information
- **Complete auditability of Waracle decisions through event replay**

Note: Attack/defend actions and ROCKET/SHIELD minting intentionally emit no events to preserve the fog of war during gameplay. The WaracleSubmission event reveals these values only after the round ends.

### Gas Optimizations

1. **Lazy Balance Calculation**: Player balances calculated only when needed (retreat/move/add)
2. **Storage Packing**: Pack struct variables efficiently
3. **Event-Based Tracking**: Comprehensive events for off-chain indexing instead of storage
4. **No Mass Updates**: Index system avoids updating every player each round
5. **Efficient Prestige Retrieval**: Single call returns all active users and timestamps
6. **Optimized View Functions**: Comprehensive data retrieval in minimal calls for UI
7. **Precision Calculations**: All index updates use high precision (1e18) to minimize rounding errors

## Security Considerations

### Attack Vectors & Mitigations

1. **Reentrancy**
   - Use ReentrancyGuard on all external functions
   - Follow checks-effects-interactions pattern

2. **Index Manipulation**
   - Validate all index calculations
   - Use SafeMath or Solidity 0.8+ overflow protection
   - High precision (1e18) minimizes rounding attacks

3. **Sybil Attacks**
   - Minimum deposit requirement
   - Gas costs make mass account creation expensive

4. **Timing Attacks**
   - Fixed round duration
   - Anyone can trigger round resolution

5. **Griefing**
   - Players can only occupy one bunker
   - Retreat penalty (prestige loss) discourages abandonment
   - Total bunker destruction eliminates inactive defenders

6. **Bunker Destruction Edge Cases**
   - Index set to 0 prevents division errors
   - Player states properly cleaned up
   - Resources correctly sent to dead address
   - Players cannot interact with destroyed bunkers

7. **Precision Loss Protection**
   - All index calculations use PRECISION constant (1e18)
   - Multiplications done before divisions
   - Consistent precision across all contracts

### Access Control

- Only WWIIIGame can withdraw from EmissionVault for rewards
- EmissionVault admin can emergency withdraw remaining tokens
- Only Waracle (admin EOA) can decrypt ROCKET/SHIELD balances off-chain
- Only Waracle can call WWIIInu() for round resolution
- Only game contract can authorize bunker contract operations
- Players never directly interact with eERC20 contracts
- Admin functions for emergency pause and deployment phase initiation

### Transparency & Auditability

- All Waracle balance submissions logged via WaracleSubmission event
- Complete game history reconstructable from events
- Post-game validation possible by replaying all rounds
- Waracle decisions deterministic from submitted balances
- Private keys can be revealed after game ends for full verification

## Future Considerations

### Potential Enhancements

1. **Alliance System**
   - Formal alliances with shared defense
   - Betrayal mechanics

2. **Special Abilities**
   - Prestige-based special actions
   - One-time use items

3. **Dynamic Map**
   - Seasonal map changes
   - Player-voted modifications

4. **NFT Integration**
   - Prestige-based NFT rewards
   - Bunker skins/customization

5. **Tournament Mode**
   - Special high-stakes rounds
   - Winner-takes-all events

### Governance

- DAO for parameter adjustments
- Community proposals for new features
- Treasury management for long-term sustainability
- **Migration capability**: Owner can halt game to allow player withdrawals before migrating to new contracts

## Conclusion

This design provides a balanced, engaging game with:
- Clear incentives for both attacking and defending through single action mechanic
- Long-term player retention via prestige system
- Definitive 3-year lifespan with clean ending
- Efficient gas usage through index-based calculations
- Complete fog of war using eERC20 encryption
- Fair treatment of inactive players through proportional distribution
- Clean round resolution with burn-after-calculation approach
- 7-day pre-game deployment phase for strategic positioning
- High-precision calculations (1e18) to prevent rounding errors
- Simple yet secure Waracle-based resolution

The integration with eERC20 provides true hidden information warfare while maintaining game integrity. The index system ensures fair treatment regardless of activity level, and the emission schedule creates urgency over the 3-year lifecycle. The burn-after-calculation approach eliminates complexity while the single action proof streamlines gameplay without sacrificing strategic depth.