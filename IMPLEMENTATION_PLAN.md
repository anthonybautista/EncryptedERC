# WWIII Game Implementation Plan Using eERC20 Protocol

## Executive Summary

After thorough analysis of both the eERC20 protocol and WWIII game design, I have **95% confidence** that the game can be successfully implemented using the encrypted token components. The eERC20 protocol provides the necessary privacy-preserving infrastructure for anonymous token minting and balance management, though some modifications will be required for complete functionality.

## Feasibility Analysis

### ✅ **Core Requirements Met**

1. **Anonymous Token Minting to Bunkers**
   - eERC20's `privateMint()` function allows minting to any registered address
   - Bunker contracts can be registered with their own BabyJubJub key pairs
   - Mint proofs contain encrypted amounts, preserving privacy
   - Target bunker address is part of the proof but amount remains hidden

2. **Fog of War Mechanics**  
   - Encrypted balances prevent anyone from viewing actual ROCKET/SHIELD amounts
   - Only the bunker contracts themselves can decrypt their balances
   - Public can see encrypted balance structs (EGCT) but not the values

3. **Proof-Based Actions**
   - Attack/defend actions can use mint proofs to target specific bunkers
   - Backend API can generate proofs with player's action encoded
   - Nullifiers prevent proof replay attacks

4. **Waracle Oversight (No Auditor Role Needed)**
   - Waracle decrypts balances off-chain using stored keys
   - Does NOT need auditor status in the eERC20 system
   - Waracle submits decrypted balances to bunker contracts

### ⚠️ **Limitations & Required Modifications**

1. **Balance Visibility for Waracle**
   - **Current**: No direct balance reading in eERC20
   - **Required**: Waracle needs to decrypt ROCKET/SHIELD balances for damage calculation
   - **Solution**: Waracle holds bunker private keys off-chain for decryption

2. **Bunker Contract Integration**
   - **Current**: Standard addresses receive tokens
   - **Required**: Bunker contracts need to receive ROCKET/SHIELD and burn after combat
   - **Solution**: Custom bunker contracts that can burn tokens when instructed by Waracle

3. **Registration Requirements**
   - All 5 bunker contracts must register with eERC20 before gameplay
   - Players do NOT need to register (they don't interact with eERC20 directly)
   - Game contract needs permission to call privateMint

## Technical Architecture

### Contract Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                         WWIIIGame.sol                        │
│  - Player management (deploy/retreat/move)                  │
│  - Round progression                                         │
│  - Action routing (attackOrDefend)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┬─────────────────────────┐
        │                           │                           │
┌───────▼─────────┐       ┌─────────▼─────────┐      ┌────────▼────────┐
│ WWIII Token     │       │ ROCKET Token      │      │ SHIELD Token    │
│ (Standard ERC20)│       │ (Encrypted ERC20) │      │ (Encrypted ERC20)│
└─────────────────┘       └───────────────────┘      └─────────────────┘
        │                           │                           │
        │                  ┌────────▼────────┐                 │
        └─────────────────►│ Bunker Contracts├◄────────────────┘
                          │   (5 instances)  │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ Warmonger.sol   │
                          │ - NO auditor role│
                          │ - Request balances│
                          │ - Process combat│
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ Waracle (Admin EOA)│
                          │ - Holds bunker keys│
                          │ - Decrypts balances│
                          │ - Submits to chain│
                          └─────────────────┘
```

### Key Components

#### 1. **Modified EncryptedERC20 Contracts (ROCKET & SHIELD)**

```solidity
contract ModifiedEncryptedERC20 is EncryptedERC {
    // Authorized burners can burn tokens after combat resolution
    mapping(address => bool) public authorizedBurners;
    
    modifier onlyAuthorizedBurner() {
        require(authorizedBurners[msg.sender], "Not authorized to burn");
        _;
    }
    
    function authorizeBurner(address burner) external onlyOwner {
        authorizedBurners[burner] = true;
    }
    
    // Allow bunker contracts to burn their tokens after combat
    function burn(address from, uint256 amount) external onlyAuthorizedBurner {
        // Burn the encrypted tokens
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }
    
    // Note: No need for balance reading functions since Waracle decrypts off-chain
}
```

#### 2. **Bunker Contract with Waracle Integration**

Since storing private keys on-chain is impossible (they would be visible in deployment transactions), we use the Waracle service for balance revelation.

The Waracle is an admin-controlled EOA wallet that has access to bunker private keys off-chain.

```solidity
contract Bunker {
    address public trustedWaracle; // Admin EOA wallet
    
    struct RoundCombatData {
        uint256 rocketsUsed;     // ROCKET balance before burning
        uint256 shieldsUsed;     // SHIELD balance before burning
        uint256 netDamage;       // Calculated damage (rockets - shields, if positive)
        bool processed;          // Whether round has been processed
    }
    
    mapping(uint256 => RoundCombatData) public roundCombatData;
    
    function submitRoundDamage(
        uint256 round,
        uint256 rocketBalance,
        uint256 shieldBalance,
        bytes calldata signature
    ) external {
        require(msg.sender == trustedWaracle, "Only waracle");
        require(!roundCombatData[round].processed, "Already processed");
        
        // Verify signature to ensure data authenticity
        bytes32 dataHash = keccak256(abi.encode(
            address(this),
            round,
            rocketBalance,
            shieldBalance
        ));
        require(verifyWaracleSignature(dataHash, signature), "Invalid signature");
        
        // Calculate net damage
        uint256 netDamage = 0;
        if (rocketBalance > shieldBalance) {
            netDamage = rocketBalance - shieldBalance;
        }
        
        // Store combat data
        roundCombatData[round] = RoundCombatData({
            rocketsUsed: rocketBalance,
            shieldsUsed: shieldBalance,
            netDamage: netDamage,
            processed: true
        });
        
        // Emit detailed event for tracking
        emit CombatDataRevealed(
            round,
            bunkerId,
            rocketBalance,
            shieldBalance,
            netDamage,
            block.timestamp
        );
    }
    
    // Called by Waracle after damage calculation to burn tokens
    function burnCombatTokens(address rocketToken, address shieldToken) external {
        require(msg.sender == trustedWaracle, "Only waracle");
        
        // Burn all ROCKET and SHIELD tokens held by this bunker
        uint256 rocketBalance = IERC20(rocketToken).balanceOf(address(this));
        uint256 shieldBalance = IERC20(shieldToken).balanceOf(address(this));
        
        if (rocketBalance > 0) {
            IEncryptedERC20(rocketToken).burn(address(this), rocketBalance);
        }
        if (shieldBalance > 0) {
            IEncryptedERC20(shieldToken).burn(address(this), shieldBalance);
        }
        
        emit TokensBurned(bunkerId, currentRound, rocketBalance, shieldBalance);
    }
    
    // Events
    event CombatDataRevealed(
        uint256 indexed round,
        uint8 indexed bunkerId,
        uint256 rocketsUsed,
        uint256 shieldsUsed,
        uint256 netDamage,
        uint256 timestamp
    );
    
    event TokensBurned(
        uint8 indexed bunkerId,
        uint256 indexed round,
        uint256 rocketsBurned,
        uint256 shieldsBurned
    );
}
```

#### 3. **Attack/Defend Implementation with Split Allocation**

```solidity
function attackOrDefend(
    bytes calldata actionProof  // Single proof validates entire action
) external validBunker(msg.sender) {
    require(players[msg.sender].lastActionRound < currentRound, "Already acted");
    
    // Decode the combined action proof
    ActionProof memory proof = abi.decode(actionProof, (ActionProof));
    
    // The proof verifies:
    // 1. rocketAmount >= 1 && shieldAmount >= 1 (minimum 1 token each)
    // 2. rocketAmount + shieldAmount <= playerDeployedAmount
    // 3. Valid encryption of both amounts
    // 4. Target bunker is valid (not self)
    
    require(
        actionVerifier.verifyProof(
            proof.a, proof.b, proof.c, proof.publicSignals
        ),
        "Invalid action proof"
    );
    
    // Extract targets from proof
    address rocketTarget = address(uint160(proof.publicSignals[ROCKET_TARGET_INDEX]));
    address shieldTarget = bunkerContracts[players[msg.sender].currentBunker];
    
    // Execute mints with encrypted amounts from proof
    ROCKET.privateMintFromProof(rocketTarget, proof.rocketMintData);
    SHIELD.privateMintFromProof(shieldTarget, proof.shieldMintData);
    
    // Mark action taken
    players[msg.sender].lastActionRound = currentRound;
}
```

### Proof Generation Flow

1. **Frontend**: Player selects attack target
2. **Backend API**: 
   - Receives player action (attack bunker X)
   - Generates mint proof with:
     - Target bunker's public key as receiver
     - Attack amount encrypted
     - Nullifier to prevent replay
   - Returns proof to frontend
3. **Smart Contract**: Verifies and executes mint

### Example Proof Generation (Backend)

```javascript
async function generateActionProof(
    playerPrivKey: bigint,
    deployedAmount: bigint,
    targetBunkerId: number,
    rocketAmount: bigint,
    shieldAmount: bigint
) {
    // Validate amounts
    if (rocketAmount < 1 || shieldAmount < 1) {
        throw new Error("Must allocate at least 1 token to each");
    }
    if (rocketAmount + shieldAmount > deployedAmount) {
        throw new Error("Total exceeds deployment");
    }
    
    const targetBunker = await getBunkerPublicKey(targetBunkerId);
    const playerBunker = await getPlayerBunkerPublicKey(playerAddress);
    
    const input = {
        // Private inputs
        deployedAmount: deployedAmount,
        rocketAmount: rocketAmount,
        shieldAmount: shieldAmount,
        playerPrivateKey: playerPrivKey,
        
        // Public inputs
        playerPublicKey: playerPublicKey,
        targetBunkerAddress: targetBunkerId,
        chainId: chainId,
        
        // Encryption parameters
        rocketReceiverKey: targetBunker.publicKey,
        shieldReceiverKey: playerBunker.publicKey,
        // ... randomness and other encryption params
    };
    
    return await actionCircuit.generateProof(input);
}
```

## Implementation Steps

### Phase 1: Infrastructure Setup (Week 1)

1. **Deploy Modified Encrypted Tokens**
   - Fork EncryptedERC.sol for ROCKET and SHIELD
   - Add burn functionality for bunker contracts
   - Deploy with proper verifiers
   - Authorize bunker contracts as burners

2. **Deploy Bunker Infrastructure**
   - Create Bunker.sol with Waracle integration
   - Deploy 5 bunker instances
   - Generate and secure bunker key pairs (stored off-chain)
   - Register all bunkers with eERC20 Registrar

3. **Deploy Core Game Contracts**
   - WWIIIGame.sol with player management
   - Warmonger.sol (no special privileges needed)
   - Standard WWIII token
   - Authorize game contract to call privateMint on ROCKET/SHIELD

### Phase 2: Game Logic Implementation (Week 2)

1. **EmissionVault Contract**
   - Deploy vault to hold 6 billion pre-minted WWIII tokens
   - Implement withdraw function for game contract
   - Add emergency withdrawal for admin
   - Set game contract address after deployment

2. **Player Actions**
   - Implement deploy/retreat/move functions
   - Integrate with bunker token transfers
   - Add prestige tracking

3. **Combat System**
   - Implement attackOrDefend with single action proof
   - Validate minimum 1 token each for ROCKET/SHIELD
   - Ensure proper round action limits

4. **Round Resolution**
   - Waracle (admin) triggers round resolution when 8 hours have elapsed
   - Waracle decrypts and submits ROCKET/SHIELD totals for each bunker
   - Game withdraws emissions from vault (handling endgame gracefully)
   - Tokens distributed directly to bunker contracts
   - Bunker indices updated to reflect new proportions
   - Only waracle can execute these critical game state changes

### Waracle Workflow

The Waracle (admin EOA) has exclusive control over critical game state changes:

1. **Round Ends**: 8 hours elapsed, waracle monitors for resolution
2. **Waracle Backend Service**:
   - Reads encrypted balances from ROCKET/SHIELD contracts
   - Decrypts using stored bunker private keys
   - Calculates damage for each bunker
   - Prepares batch transaction
3. **Waracle EOA Executes** (in single transaction if possible):
   - Submits decrypted balances to bunker contracts
   - Triggers bunker destruction for fatal damage
   - Processes player eliminations
   - Distributes resources to survivors
   - Starts next round

**Key Security Benefits:**
- Prevents griefing (only waracle can destroy bunkers)
- Ensures atomic state updates
- Maintains game progression
- Reduces gas wars for round resolution

```solidity
contract Warmonger {
    address public waracle;
    
    modifier onlyWaracle() {
        require(msg.sender == waracle, "Only waracle");
        _;
    }
    
    // Only waracle can trigger round resolution
    function resolveRound() external onlyWaracle {
        require(block.timestamp >= rounds[currentRound].endTime);
        require(!rounds[currentRound].resolved);
        
        // Waracle will have already submitted balance data
        // Now process combat results
        for (uint8 i = 1; i <= 5; i++) {
            processBunkerDamage(i);
        }
        
        distributeResources();
        rounds[currentRound].resolved = true;
        
        // Start next round if game continues
        if (remainingEmissions > 0) {
            startNewRound();
        }
    }
    
    // Only waracle can destroy bunkers
    function destroyBunker(uint8 bunkerId) external onlyWaracle {
        require(bunkerPendingDestruction[bunkerId], "Not marked for destruction");
        
        // Process all player eliminations
        eliminateAllPlayers(bunkerId);
        
        // Reset bunker state
        bunkerIndices[bunkerId].index = 0;
        bunkerMetadata[bunkerId].totalDeployed = 0;
        
        emit BunkerDestroyed(bunkerId, currentRound);
    }
}

```solidity
// In WWIIIGame.sol - Comprehensive event for Waracle submissions
event WaracleSubmission(
    uint256 indexed round,
    uint256[5] rocketBalances,
    uint256[5] shieldBalances,
    uint256[5] damages,
    uint8 destroyedBunkers  // Bit flags for destroyed bunkers
);

function WWIIInu(
    uint256[5] calldata rocketBalances,
    uint256[5] calldata shieldBalances
) external onlyWaracle {
    require(block.timestamp >= rounds[currentRound].endTime, "Round not ended");
    require(!rounds[currentRound].resolved, "Already resolved");
    
    uint256[5] memory damages;
    uint8 destroyedFlags = 0;
    
    // Process each bunker
    for (uint8 i = 0; i < 5; i++) {
        uint8 bunkerId = i + 1;
        
        // Calculate damage
        if (rocketBalances[i] > shieldBalances[i]) {
            damages[i] = rocketBalances[i] - shieldBalances[i];
        }
        
        // Process combat
        bool destroyed = processBunkerCombat(
            bunkerId,
            rocketBalances[i],
            shieldBalances[i],
            damages[i]
        );
        
        if (destroyed) {
            destroyedFlags |= (1 << i);
        }
    }
    
    // Emit comprehensive event for full transparency
    emit WaracleSubmission(
        currentRound,
        rocketBalances,
        shieldBalances,
        damages,
        destroyedFlags
    );
    
    // Continue with resource distribution...
    distributeResources();
    rounds[currentRound].resolved = true;
    
    // Waracle must call startNewRound() separately to begin next round
}

// Distribute resources safely, handling endgame
function distributeResources() internal {
    uint256 baseShare = rounds[currentRound].totalEmission / 6;
    
    // Safely withdraw what's available
    uint256 vaultBalance = emissionVault.remainingEmissions();
    uint256 toWithdraw = Math.min(rounds[currentRound].totalEmission, vaultBalance);
    
    if (toWithdraw == 0) {
        emit GameEnded(currentRound, block.timestamp, 0);
        return;
    }
    
    require(emissionVault.withdraw(toWithdraw), "Vault withdrawal failed");
    
    // Adjust if less than expected
    if (toWithdraw < rounds[currentRound].totalEmission) {
        baseShare = toWithdraw / 6;
    }
    
    // Direct distribution to bunkers
    for (uint8 i = 1; i <= 5; i++) {
        uint256 bunkerShare = (i == 3) ? baseShare * 2 : baseShare;
        
        if (bunkerMetadata[i].totalDeployed > 0) {
            WWIII.transfer(bunkerContracts[i], bunkerShare);
            updateBunkerIndexForRewards(i, bunkerShare);
        } else {
            WWIII.transfer(DEAD_ADDRESS, bunkerShare);
        }
    }
}

// Start the next round - must be called after WWIIInu completes
function startNewRound() external onlyWaracle {
    require(rounds[currentRound].resolved, "Current round not resolved");
    require(!pendingCleanup, "Cleanup required first");
    require(remainingEmissions > 0, "No emissions remaining");
    require(!gameHalted, "Game is halted");
    
    currentRound++;
    uint256 emission = calculateRoundEmission();
    
    rounds[currentRound] = Round({
        startTime: block.timestamp,
        endTime: block.timestamp + ROUND_DURATION,
        totalEmission: emission,
        resolved: false,
        combatProcessed: false
    });
    
    remainingEmissions -= emission;
    emit RoundStarted(currentRound, block.timestamp, rounds[currentRound].endTime, emission);
}
```

```javascript
// Admin backend service (off-chain)
async function processRoundCombat(roundNumber) {
    const rocketBalances = [];
    const shieldBalances = [];
    
    // Collect all balances first
    for (let bunkerId = 1; bunkerId <= 5; bunkerId++) {
        // Get encrypted balances
        const rocketBalance = await ROCKET.balanceOf(bunkerAddresses[bunkerId]);
        const shieldBalance = await SHIELD.balanceOf(bunkerAddresses[bunkerId]);
        
        // Decrypt using bunker private key (stored securely off-chain)
        const decryptedRocket = decrypt(rocketBalance.eGCT, bunkerPrivateKeys[bunkerId]);
        const decryptedShield = decrypt(shieldBalance.eGCT, bunkerPrivateKeys[bunkerId]);
        
        rocketBalances.push(decryptedRocket);
        shieldBalances.push(decryptedShield);
    }
    
    // Submit all balances in one transaction
    await gameContract.WWIIInu(
        rocketBalances,
        shieldBalances
    );
    
    // The WWIIInu function will:
    // 1. Process all combat
    // 2. Burn tokens via bunker contracts
    // 3. Emit comprehensive WaracleSubmission event
    // 4. Handle resource distribution
}
```

### Phase 3: Backend API Development (Week 3)

1. **Proof Generation Service**
   - Set up circom proof generation
   - Create API endpoints for attack/defend proofs
   - Implement secure key management

2. **Game State Indexing**
   - Event monitoring and database updates
   - Player statistics tracking
   - Round history management

### Phase 4: Testing & Security (Week 4)

1. **Comprehensive Testing**
   - Unit tests for all contracts
   - Integration tests for full game flow
   - Gas optimization analysis

2. **Security Audit**
   - Review cryptographic implementations
   - Test attack vectors
   - Verify privacy guarantees

## Game Flow & Phases

### Pre-Game Deployment Phase

Before combat rounds begin, there's a deployment phase for setup and strategic positioning:

```solidity
contract WWIIIGame {
    enum GamePhase { DEPLOYMENT, ACTIVE, HALTED, ENDED }
    GamePhase public gamePhase = GamePhase.DEPLOYMENT;
    uint256 public gameStartTime; // When first round will begin
    uint256 public constant DEPLOYMENT_PERIOD = 2 days; // Configurable
    
    constructor() {
        gameStartTime = block.timestamp + DEPLOYMENT_PERIOD;
    }
    
    modifier onlyDuringDeployment() {
        require(gamePhase == GamePhase.DEPLOYMENT, "Not in deployment phase");
        require(block.timestamp < gameStartTime, "Deployment period ended");
        _;
    }
    
    modifier onlyActiveGame() {
        require(gamePhase == GamePhase.ACTIVE, "Game not active");
        _;
    }
    
    // Deploy is allowed during deployment phase AND active game
    function deploy(uint8 bunker, uint256 amount) external {
        require(
            gamePhase == GamePhase.DEPLOYMENT || gamePhase == GamePhase.ACTIVE,
            "Cannot deploy now"
        );
        // ... deployment logic
    }
    
    // Actions only allowed during active game
    function attackOrDefend(bytes calldata proof) external onlyActiveGame {
        // ... action logic
    }
    
    // Move allowed during deployment for initial positioning
    function move(uint8 newBunker) external {
        if (gamePhase == GamePhase.DEPLOYMENT) {
            // Free movement during deployment
            require(canMove(players[msg.sender].currentBunker, newBunker));
            // ... move logic without round restrictions
        } else {
            // Normal movement rules during active game
            require(gamePhase == GamePhase.ACTIVE);
            require(players[msg.sender].lastActionRound < currentRound);
            // ... standard move logic
        }
    }
    
    // Waracle starts the game after deployment period
    function startGame() external onlyWaracle {
        require(block.timestamp >= gameStartTime, "Deployment period not over");
        require(gamePhase == GamePhase.DEPLOYMENT, "Game already started");
        
        gamePhase = GamePhase.ACTIVE;
        currentRound = 1;
        rounds[1].startTime = block.timestamp;
        rounds[1].endTime = block.timestamp + ROUND_DURATION;
        rounds[1].totalEmission = firstYearRoundEmission;
        
        emit GameStarted(block.timestamp);
    }
    
    // Emergency halt if Waracle unresponsive
    function emergencyHaltGame() external {
        require(!gameHalted, "Already halted");
        require(gamePhase == GamePhase.ACTIVE, "Game not active");
        require(rounds[currentRound].endTime > 0, "No active round");
        require(block.timestamp > rounds[currentRound].endTime + 24 hours, "Must wait 24 hours");
        require(!rounds[currentRound].resolved, "Round already resolved");
        
        gameHalted = true;
        gamePhase = GamePhase.HALTED;
        emit EmergencyHalt(currentRound, block.timestamp, msg.sender);
    }
}
```

**Deployment Phase Features (2 Days)**:
1. **Token Distribution**: Team distributes WWIII tokens to players
2. **Free Positioning**: Players can deploy and move without round restrictions
3. **Alliance Formation**: Players coordinate strategies off-chain
4. **No Combat**: Attack/defend actions are disabled
5. **Resource Building**: Players accumulate forces before war begins
6. **Modifiable Start Time**: Owner can adjust combat start time if needed

### Active Game Phase

Once the waracle starts the game, standard round-based combat begins. Each round:
1. Lasts exactly 8 hours from when `startNewRound()` is called
2. Ends automatically after 8 hours (no more player actions)
3. Waits for Waracle to call `WWIIInu()` to process combat
4. Requires Waracle to call `startNewRound()` to begin next round
5. If Waracle doesn't process within 24 hours, anyone can call `emergencyHaltGame()`

This ensures players always know their current balance before taking actions in a new round.

## Player Action Validation

### The Challenge
Players must prove that their attack + defend allocation doesn't exceed their deployed amount, while keeping all values encrypted.

### Solution: Combined Action Circuit
Instead of two separate mint proofs, we create a single "action proof" that validates the entire turn:

```circom
template ActionCircuit() {
    // Private inputs
    signal input deployedAmount;
    signal input rocketAmount;
    signal input shieldAmount;
    signal input playerPrivateKey;
    
    // Public inputs  
    signal input playerPublicKey[2];
    signal input playerDeploymentHash; // Hash of encrypted deployment
    signal input targetBunkerId;
    signal input chainId;
    
    // Constraint 1: Both amounts must be at least 1
    component checkMinRocket = GreaterEqThan(32);
    checkMinRocket.in[0] <== rocketAmount;
    checkMinRocket.in[1] <== 1;
    checkMinRocket.out === 1;
    
    component checkMinShield = GreaterEqThan(32);
    checkMinShield.in[0] <== shieldAmount;
    checkMinShield.in[1] <== 1;
    checkMinShield.out === 1;
    
    // Constraint 2: Total doesn't exceed deployment
    signal totalAmount <== rocketAmount + shieldAmount;
    component checkTotal = LessEqThan(64);
    checkTotal.in[0] <== totalAmount;
    checkTotal.in[1] <== deployedAmount;
    checkTotal.out === 1;
    
    // Constraint 3: Verify player knows their deployment amount
    component verifyDeployment = VerifyEncryptedValue();
    verifyDeployment.value <== deployedAmount;
    verifyDeployment.publicKey <== playerPublicKey;
    verifyDeployment.encryptedHash <== playerDeploymentHash;
    
    // Generate encrypted values for minting
    component encryptRocket = ElGamalEncrypt();
    encryptRocket.message <== rocketAmount;
    encryptRocket.publicKey <== targetBunkerPublicKey;
    
    component encryptShield = ElGamalEncrypt();
    encryptShield.message <== shieldAmount;
    encryptShield.publicKey <== playerBunkerPublicKey;
    
    // Output everything needed for minting
    signal output rocketEncrypted[4]; // c1.x, c1.y, c2.x, c2.y
    signal output shieldEncrypted[4];
    signal output targetAddress;
}
```

This ensures players can flexibly allocate their tokens while preventing cheating.

## Security Considerations

### Cryptographic Security

1. **Key Management**
   - Bunker private keys stored off-chain by admin (never on blockchain)
   - Should use HSM or secure enclave for production
   - Admin EOA private key is critical - controls game resolution
   - Consider multi-sig for waracle role in production

2. **Proof Validation**
   - Ensure nullifiers prevent replay attacks
   - Validate all public inputs
   - Check proof freshness

### Game Security

1. **Action Validation**
   - Verify player has acted only once per round
   - Ensure moves follow connection rules
   - Validate deployment minimums

2. **Balance Integrity**
   - Index system prevents manipulation
   - Encrypted balances preserve privacy
   - Burn-after-use prevents accumulation errors

## Gas Cost Estimates

Based on eERC20 benchmarks and game complexity:

- **Deploy**: ~150,000 gas (token transfer + registration check)
- **Attack/Defend**: ~800,000 gas (2 proof verifications + mints)
- **Move**: ~200,000 gas (balance updates + transfers)
- **Retreat**: ~100,000 gas (balance calculation + transfer)
- **Round Resolution**: ~500,000 gas (5 bunker checks + distribution)

## Recommendations

### Critical Path Items

1. **Add Burn Functionality to ROCKET/SHIELD** - Required for clean round resolution
2. **Secure Off-chain Key Storage** - Critical for bunker private keys
3. **Waracle Backend Service** - Needed for balance decryption and submission

### Optimization Opportunities

1. **Batch Registration** - Register all bunkers in one transaction
2. **Proof Caching** - Cache common proof components
3. **Event Compression** - Minimize event data for indexing

### Future Enhancements

1. **Decentralized Proof Generation** - Allow players to generate own proofs
2. **Multi-chain Support** - Leverage eERC20's chain ID validation
3. **Enhanced Privacy** - Add mixing for deployment transactions

## Post-Game Validation & Transparency

### Event-Based Auditability

The game emits comprehensive events that allow complete reconstruction and validation of all Waracle decisions:

```javascript
// Post-game validation script
async function validateGameHistory() {
    // 1. Get all WaracleSubmission events
    const submissions = await gameContract.queryFilter(
        gameContract.filters.WaracleSubmission()
    );
    
    // 2. Validate each round
    for (const submission of submissions) {
        const { round, rocketBalances, shieldBalances, damages, destroyedBunkers } = submission.args;
        
        // Verify damage calculations
        for (let i = 0; i < 5; i++) {
            const expectedDamage = Math.max(0, rocketBalances[i] - shieldBalances[i]);
            assert(damages[i] === expectedDamage, `Round ${round} bunker ${i+1} damage mismatch`);
        }
        
        // Cross-reference with other events
        await validateBunkerDamageEvents(round, damages);
        await validateResourceDistribution(round);
        await validateTokenBurns(round, rocketBalances, shieldBalances);
    }
    
    console.log("All Waracle decisions validated successfully!");
}
```

### Trust Model Transparency

While the game requires trust in the Waracle for balance decryption, all decisions are:
1. **Logged on-chain** via WaracleSubmission events
2. **Deterministic** from the submitted balances
3. **Verifiable** post-game when private keys are revealed
4. **Auditable** by anyone with an event indexer

This provides a strong accountability mechanism while keeping implementation practical.

## Conclusion

The WWIII game is **highly feasible** using the eERC20 protocol with moderate modifications. The encrypted token system provides excellent privacy guarantees while the proof system enables secure, verifiable actions. The main engineering challenge is managing bunker private keys securely off-chain for the Waracle to decrypt balances, which is solved through the admin-controlled backend service.

The architecture preserves the game's fog of war mechanics while ensuring fair and transparent round resolution through comprehensive event logging. With proper implementation of the modifications outlined above, the game will deliver the intended user experience of strategic, privacy-preserving blockchain warfare.

**Confidence Level: 95%** - The remaining 5% uncertainty relates to gas costs in production and the complexity of managing bunker private keys securely.