# WWIII Game Contract Test Plan

## Overview

Based on thorough analysis of the game contract implementation, this document outlines comprehensive testing requirements for the WWIII blockchain game. The current test coverage is approximately **30%**, with critical combat mechanics, round management, and integration components missing.

## Current Implementation Analysis

### Verified Function Signatures
```solidity
// Player Functions
function deploy(uint8 bunker, uint256 amount) external nonReentrant gameActive notDuringTransition validBunkerId(bunker)
function addTokens(uint256 amount) external nonReentrant gameActive notDuringTransition validBunker(msg.sender)
function move(uint8 newBunker) external nonReentrant gameActive roundActive validBunker(msg.sender) validBunkerId(newBunker)
function attackOrDefend(uint256[8] calldata proof, uint256[] calldata publicSignals) external nonReentrant gameActive roundActive validBunker(msg.sender)
function retreat() external nonReentrant

// Game Management (Waracle Only)
function startNewRound() external onlyWaracle nonReentrant
function WWIIInu(uint256[5] calldata rocketBalances, uint256[5] calldata shieldBalances) external onlyWaracle nonReentrant returns (uint8[] memory destroyedBunkers)
function destroyBunker(uint8 bunkerId, uint256 maxPlayers) external onlyWaracle nonReentrant validBunkerId(bunkerId)

// Admin Functions
function startGame(uint256 _combatStartTime) external onlyOwner
function setMinimumDeposit(uint256 newMinimum) external onlyOwner
function setWaracle(address newWaracle) external onlyOwner
function setVault(address newVault) external onlyOwner
function transferTokenOwnership(address tokenAddress, address newOwner) external onlyOwner
function acceptTokenOwnership(address tokenAddress) external onlyOwner
function haltGame() external onlyOwner
function emergencyHaltGame() external
function emergencyWithdrawToken(address token, address to, uint256 amount) external onlyOwner

// View Functions
function getCurrentDeployment(address player) public view returns (uint256)
function canMove(uint8 from, uint8 to) public pure returns (bool)
function getPlayerInfo(address player) external view returns (...)
function getBunkerInfo(uint8 bunker) external view returns (...)
function getGameState() external view returns (...)
```

### Key Architecture Features
- **Game Phases**: DEPLOYMENT → ACTIVE → HALTED/ENDED
- **Round Duration**: 8 hours (ROUND_DURATION constant)
- **Precision System**: 1e18 for all index calculations
- **Fog of War**: attackOrDefend() emits no events to preserve strategic secrecy
- **Token Burning**: _burnAllCombatTokens() after each round (clean slate)
- **Index System**: Proportional damage/rewards via bunker indices
- **3-Year Emission**: Different rates per year (3B/2B/1B tokens)

## Critical Missing Test Areas

### 1. Combat System (Critical - 0% Coverage)
**Missing Functions:**
- `attackOrDefend()` - Core combat mechanic
- `WWIIInu()` - Waracle combat resolution  
- `_applyDamageAndBurn()` - Damage calculation
- `_burnAllCombatTokens()` - Post-combat cleanup

**Missing Scenarios:**
- Action proof validation and minting
- Damage calculation (ROCKET - SHIELD)
- Bunker destruction (damage >= totalDeployed)
- Token burning after combat resolution
- WaracleSubmission event validation

### 2. Round Management (Critical - 0% Coverage) 
**Missing Functions:**
- `startNewRound()` - Round initialization
- Round state transitions and timing
- Emission calculation and distribution

**Missing Scenarios:**
- 8-hour round duration enforcement
- Round start/end boundary conditions
- Game phase transitions (DEPLOYMENT → ACTIVE)
- Emergency halt after 24-hour timeout

### 3. Movement System (Major - 0% Coverage)
**Missing Functions:**
- `move()` - Inter-bunker movement
- `canMove()` validation

**Missing Scenarios:**
- Bunker connection topology validation
- Token transfers between bunkers
- Movement restrictions during rounds

### 4. Index System & Resource Distribution (Major - 0% Coverage)
**Missing Functions:**
- `_distributeResources()` - Vault to bunkers
- `_updateBunkerIndexForRewards()` - Index updates
- `_calculateRoundEmission()` - 3-year schedule

**Missing Scenarios:**
- Proportional damage via index system
- Resource distribution (X tokens, 2X for bunker 3)
- Precision maintenance over multiple rounds
- Vault depletion handling

### 5. Bunker Destruction & Cleanup (Missing - 0% Coverage)
**Missing Functions:**
- `destroyBunker()` - Player elimination in batches
- Bunker reinitialization logic

**Missing Scenarios:**
- Complete bunker destruction
- Batch player elimination (gas optimization)
- Bunker recovery and reuse

## Test File Organization Strategy

To manage complexity and enable focused testing, split into specialized test files:

### 1. **wwiii-game-core.test.ts** (Current - Refactor)
**Focus**: Basic player management and deployment
- Player deployment, addTokens, retreat
- View functions and state queries
- Access control and initialization
- Constructor validation

### 2. **wwiii-game-movement.test.ts** (New)
**Focus**: Movement system and topology
- `move()` function with all connection rules
- `canMove()` validation for all bunker pairs
- Token transfer mechanics between bunkers
- Movement restrictions during different game phases

### 3. **wwiii-game-combat.test.ts** (New)
**Focus**: Core combat mechanics
- `attackOrDefend()` with valid/invalid proofs
- Action proof validation and minting integration
- Combat privacy (no event emissions)
- Round action limits (one action per player per round)

### 4. **wwiii-game-rounds.test.ts** (New)
**Focus**: Round management and progression
- `startNewRound()` and round state transitions
- 8-hour round duration enforcement
- Game phase management (DEPLOYMENT/ACTIVE/HALTED/ENDED)
- Emergency halt scenarios

### 5. **wwiii-game-waracle.test.ts** (New)
**Focus**: Waracle-controlled functions
- `WWIIInu()` combat resolution with damage calculation
- `destroyBunker()` batch cleanup mechanics
- WaracleSubmission event validation
- Token burning after combat (_burnAllCombatTokens)

### 6. **wwiii-game-economy.test.ts** (New)
**Focus**: Token economics and resource distribution
- `_distributeResources()` vault withdrawal and bunker distribution
- `_calculateRoundEmission()` 3-year emission schedule
- Index system precision over multiple rounds
- Endgame handling (vault depletion)

### 7. **wwiii-game-integration.test.ts** (New)
**Focus**: Full game flow testing
- Complete round cycles: Deploy → Action → Resolution → Distribution
- Multi-round scenarios with index changes
- Bunker destruction and recovery cycles
- Game conclusion after 3 years

## Priority Implementation Order

### Phase 1: Movement System (1-2 days)
**File**: `wwiii-game-movement.test.ts`
- **Reason**: Self-contained, no dependencies on other missing components
- **Coverage**: move() function, canMove() validation, bunker topology
- **Target**: 100% coverage of movement mechanics

### Phase 2: Round Management (1-2 days)  
**File**: `wwiii-game-rounds.test.ts`
- **Reason**: Foundation for combat testing, enables round-based scenarios
- **Coverage**: startNewRound(), game phases, round timing
- **Target**: Complete round lifecycle testing

### Phase 3: Combat Mechanics (2-3 days)
**Files**: `wwiii-game-combat.test.ts`, `wwiii-game-waracle.test.ts`
- **Reason**: Core game functionality, requires action circuit integration
- **Coverage**: attackOrDefend(), WWIIInu(), damage calculation, token burning
- **Target**: Full combat cycle with proper proof validation

### Phase 4: Economics & Index System (2-3 days)
**File**: `wwiii-game-economy.test.ts`
- **Reason**: Complex mathematical validation, precision testing
- **Coverage**: Resource distribution, emission schedule, index calculations
- **Target**: Economic balance and mathematical precision

### Phase 5: Integration & Edge Cases (2-3 days)
**File**: `wwiii-game-integration.test.ts`
- **Reason**: End-to-end validation, complex multi-round scenarios
- **Coverage**: Full game flows, bunker destruction cycles, 3-year simulation
- **Target**: Complete game lifecycle validation

## Critical Test Requirements

### Action Circuit Integration
```typescript
// Must test actual action proof validation
await game.connect(player1).attackOrDefend(validProof, validPublicSignals);

// Must validate ROCKET/SHIELD minting to correct bunkers
expect(await ROCKET.balanceOf(targetBunkerAddress)).to.not.equal("0x0");
expect(await SHIELD.balanceOf(currentBunkerAddress)).to.not.equal("0x0");
```

### Damage Calculation Validation
```typescript
// Must test damage = max(0, rockets - shields)
const damage = rocketBalance > shieldBalance ? rocketBalance - shieldBalance : 0;
expect(bunkerDestroyed).to.equal(damage >= bunkerBalance);
```

### Index System Precision
```typescript
// Must test precision over many rounds (no significant rounding errors)
// Test scenario: 100+ rounds with frequent damage/resource changes
const finalBalance = await game.getCurrentDeployment(player);
expect(finalBalance).to.be.within(expectedBalance * 0.999, expectedBalance * 1.001);
```

### Token Burning Verification
```typescript
// Must verify all combat tokens burned after each round
await game.connect(waracle).WWIIInu(rocketBalances, shieldBalances);

for (const bunkerAddress of bunkerAddresses) {
    expect(await ROCKET.balanceOf(bunkerAddress)).to.equal(0);
    expect(await SHIELD.balanceOf(bunkerAddress)).to.equal(0);
}
```

## Success Criteria

### Functional Coverage
- **95%+ function coverage** - All major functions tested
- **100% combat mechanics** - Core game loop fully validated
- **100% round management** - Complete round lifecycle
- **100% movement system** - All topology rules validated

### Integration Coverage  
- **Full round cycles** - Deploy → Action → Resolution → Distribution
- **Multi-round scenarios** - 10+ consecutive rounds with varying outcomes
- **Bunker destruction cycles** - Complete elimination and recovery
- **3-year simulation** - Emission schedule and game conclusion

### Edge Case Coverage
- **Boundary conditions** - Round start/end timing, minimum deposits
- **Error handling** - All custom errors properly triggered
- **Access control** - Unauthorized access properly blocked
- **Mathematical precision** - Index calculations over extended periods

### Performance Validation
- **Gas costs** - All operations within Avalanche C-Chain limits
- **Batch operations** - Bunker cleanup handles large player counts
- **State consistency** - No state corruption across complex scenarios

## Test Infrastructure Requirements

### Helper Functions Needed
```typescript
// Action proof generation for testing
async function generateValidActionProof(player, rocketAmount, shieldAmount, targetBunker): Promise<{proof, publicSignals}>

// Round progression helpers
async function advanceToRoundEnd(): Promise<void>
async function simulateRoundResolution(rocketBalances, shieldBalances): Promise<void>

// Index calculation verification
function calculateExpectedIndex(oldIndex, damage, resources): bigint

// Multi-round simulation
async function simulateGameProgression(rounds: number): Promise<GameState>
```

### Mock Components
- **Action verifier** - Return true/false for proof validation testing
- **Time manipulation** - Fast-forward for round timing tests
- **Vault balance control** - Test endgame scenarios

### Test Data Sets
- **Valid action proofs** - Different allocation splits (1/rest, 50/50, etc.)
- **Invalid action proofs** - Zero allocations, exceeding deployment, invalid targets
- **Damage scenarios** - No damage, partial damage, complete destruction
- **Multi-player setups** - 5-50 players across different bunkers

## Implementation Confidence: 95%

**Confident Areas:**
- Function signatures and modifiers well understood
- Game architecture and flow clearly defined
- Test patterns from existing codebase established
- Integration points with eERC20 protocol identified

**Remaining Uncertainty (5%):**
- Action circuit proof generation complexity for testing
- Exact gas costs for complex operations
- Edge cases in index precision calculation

**Mitigation Strategy:**
- Start with simpler tests (movement, rounds) to build confidence
- Use mock verifiers initially, integrate real circuits later
- Implement comprehensive logging for debugging precision issues

This test plan provides a roadmap to achieve 95%+ test coverage for the WWIII game contract, ensuring all critical functionality is properly validated before deployment.