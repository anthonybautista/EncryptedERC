# WWIII Blockchain Game - Comprehensive Unit Test Plan

## Overview
This document outlines a complete testing strategy for the WWIII blockchain game from a security-first perspective. Tests are organized by contract and functionality, with emphasis on edge cases, attack vectors, and state transitions.

## Key Updates Based on Implementation Plan
- **Waracle Role**: All round resolution and cleanup is Waracle-controlled (not public)
- **Single Action Proof**: Attack/defend use one proof that splits tokens (min 1 each)
- **eERC20 Integration**: ROCKET/SHIELD use encrypted balances with privateMint
- **Deployment Phase**: 7-day pre-game period before combat starts
- **No Auditor Role**: Waracle uses privileged functions, not auditor status
- **Action Circuit**: New ZK circuit validates token allocation constraints

## Test Environment Setup

### Prerequisites
- Hardhat/Foundry test framework
- Multiple test accounts (minimum 20 for various scenarios)
- Mock time manipulation capabilities
- Gas profiling tools
- Event emission tracking

### Contract Deployment Order
1. Deploy WWIII token (10B pre-minted)
2. Deploy EmissionVault with 6B WWIII
3. Deploy ROCKET and SHIELD tokens
4. Deploy 5 Bunker contracts
5. Deploy WWIIIGame contract
6. Set up permissions and references
7. Set game contract in EmissionVault

## 1. WWIII Token Contract Tests

### 1.1 Basic ERC20 Functionality
- **Test_WWIII_TotalSupply**: Verify total supply equals 10 billion (all pre-minted)
- **Test_WWIII_InitialDistribution**: Verify correct allocation (6B to vault, 2B circulation, 2B team)
- **Test_WWIII_Transfer**: Standard transfer functionality
- **Test_WWIII_Approval**: Approval and transferFrom mechanisms
- **Test_WWIII_NoMintFunction**: Verify no mint capability exists
- **Test_WWIII_FixedSupply**: Supply cannot increase after deployment

### 1.2 Edge Cases
- **Test_WWIII_TransferToZeroAddress**: Should revert
- **Test_WWIII_TransferExceedsBalance**: Should revert
- **Test_WWIII_ApproveZeroAddress**: Behavior verification
- **Test_WWIII_Overflow**: Test uint256 overflow protection

## 2. ROCKET & SHIELD Token Tests

### 2.1 eERC20 Integration & Minting
- **Test_ROCKET_eERC20_Integration**: ROCKET extends EncryptedERC properly
- **Test_SHIELD_eERC20_Integration**: SHIELD extends EncryptedERC properly
- **Test_ROCKET_PrivateMint**: Mint via eERC20 privateMint function
- **Test_SHIELD_PrivateMint**: Mint via eERC20 privateMint function
- **Test_ActionProof_To_Mint**: Action proof triggers correct mints
- **Test_Mint_NullifierPrevention**: Same nullifier cannot be used twice
- **Test_ROCKET_BurnAuthorization**: Bunker contracts authorized to burn
- **Test_SHIELD_BurnAuthorization**: Bunker contracts authorized to burn
- **Test_Burn_OnlyAuthorized**: Non-bunkers cannot burn tokens

### 2.2 Balance Visibility & Waracle Access
- **Test_ROCKET_EncryptedBalances**: Balances stored as EGCT (encrypted)
- **Test_SHIELD_EncryptedBalances**: Balances stored as EGCT (encrypted)
- **Test_ROCKET_PublicCannotDecrypt**: Public cannot decrypt balances
- **Test_SHIELD_PublicCannotDecrypt**: Public cannot decrypt balances
- **Test_Waracle_CanRequestDecryption**: Only Waracle can trigger balance revelation
- **Test_EncryptedTokenEvents**: Verify no events reveal strategic information

### 2.3 Action Circuit Validation
- **Test_ActionCircuit_MinimumOneEach**: Validates min 1 ROCKET and 1 SHIELD
- **Test_ActionCircuit_TotalConstraint**: ROCKET + SHIELD <= deployment amount
- **Test_ActionCircuit_InvalidSplit**: Rejects 0 ROCKET or 0 SHIELD
- **Test_ActionCircuit_ExceedsDeployment**: Rejects if total > deployment
- **Test_ActionCircuit_TargetBunkerValidation**: Target bunker properly encoded
- **Test_ActionCircuit_SelfAttackPrevented**: Cannot target own bunker
- **Test_ActionCircuit_ProofTampering**: Modified proofs fail verification
- **Test_ActionCircuit_ReplayPrevention**: Nullifiers prevent proof reuse

## 3. Bunker Contract Tests

### 3.1 Token Management
- **Test_Bunker_ReceiveDeposit**: Accept WWIII from game contract only
- **Test_Bunker_UnauthorizedDeposit**: Direct transfers should fail
- **Test_Bunker_TransferToBunker**: Inter-bunker transfers for moves
- **Test_Bunker_WithdrawToPlayer**: Retreat functionality
- **Test_Bunker_BurnTokens**: Destruction burns tokens correctly

### 3.2 Access Control
- **Test_Bunker_OnlyGameModifier**: All functions require game contract caller
- **Test_Bunker_DirectTransferBlocked**: Users cannot transfer directly
- **Test_Bunker_ReceiveROCKET**: Can receive ROCKET tokens
- **Test_Bunker_ReceiveSHIELD**: Can receive SHIELD tokens

### 3.3 Waracle Integration
- **Test_Bunker_WaracleBalanceSubmission**: Only Waracle can submit damage data
- **Test_Bunker_RoundCombatData**: Stores rocketsUsed, shieldsUsed, netDamage
- **Test_Bunker_WaracleSignatureVerification**: Validates Waracle signatures
- **Test_Bunker_RoundProcessedFlag**: Marks rounds as processed
- **Test_Bunker_DuplicateSubmissionPrevented**: Cannot process same round twice
- **Test_Bunker_BurnCombatTokens**: Burns all ROCKET/SHIELD tokens when called
- **Test_Bunker_BurnOnlyWaracle**: Only Waracle can trigger token burning

### 3.4 Edge Cases
- **Test_Bunker_ZeroAmountOperations**: Handle zero amount transfers
- **Test_Bunker_ReentrancyProtection**: No reentrancy vulnerabilities
- **Test_Bunker_BalanceTracking**: Accurate balance maintenance

## 4. EmissionVault Contract Tests

### 4.1 Vault Setup
- **Test_Vault_InitialBalance**: Verify 6B WWIII tokens deposited
- **Test_Vault_GameContractSet**: Only admin can set game contract once
- **Test_Vault_AdminSet**: Admin address set correctly

### 4.2 Withdrawal Tests
- **Test_Vault_GameWithdraw**: Only game contract can withdraw
- **Test_Vault_WithdrawTracking**: totalWithdrawn updates correctly
- **Test_Vault_InsufficientBalance**: Cannot withdraw more than balance
- **Test_Vault_EmergencyWithdraw**: Admin can emergency withdraw
- **Test_Vault_EmergencyEvent**: Emergency withdrawal emits event

### 4.3 Endgame Handling
- **Test_Vault_PartialWithdraw**: Game can withdraw less than requested
- **Test_Vault_EmptyVault**: Game handles empty vault gracefully
- **Test_Vault_RoundingDust**: Small remaining amounts don't lock game

## 5. WWIIIGame Contract Tests

### 4.1 Pre-Game Deployment Phase Tests
- **Test_DeploymentPhase_Duration**: 7-day deployment period before game starts
- **Test_DeploymentPhase_DeployAllowed**: Players can deploy during this phase
- **Test_DeploymentPhase_MoveAllowed**: Free movement between bunkers
- **Test_DeploymentPhase_NoActions**: Attack/defend disabled before game starts
- **Test_DeploymentPhase_WaracleStartsGame**: Only Waracle can start after 7 days
- **Test_DeploymentPhase_EarlyStartPrevented**: Cannot start before 7 days
- **Test_DeploymentPhase_TransitionToActive**: Smooth transition to active game

### 4.2 Player Deployment Tests
- **Test_Deploy_MinimumAmount**: Enforce 10k minimum
- **Test_Deploy_ValidBunker**: Only bunkers 1-5 accepted
- **Test_Deploy_SingleBunkerLimit**: Player can only occupy one bunker
- **Test_Deploy_ToDestroyedBunker**: Should reinitialize with BASE_INDEX
- **Test_Deploy_DuringCleanup**: Should fail if pendingCleanup = true
- **Test_Deploy_GameHalted**: Should fail when game halted
- **Test_Deploy_GameEnded**: Should fail after emissions exhausted
- **Test_Deploy_IndexInitialization**: Player gets current bunker index
- **Test_Deploy_NoRegistrationNeeded**: Players don't need eERC20 registration

### 4.3 Add Tokens Tests
- **Test_AddTokens_BeforeAction**: Successfully add tokens
- **Test_AddTokens_AfterAction**: Should fail after round action taken
- **Test_AddTokens_NotDeployed**: Should fail if not deployed
- **Test_AddTokens_ZeroAmount**: Should handle appropriately
- **Test_AddTokens_UpdatesIndex**: Verify index calculations
- **Test_AddTokens_ExceedsBalance**: Should revert

### 4.4 Action (Attack/Defend) Tests
- **Test_Action_SingleProofForBoth**: One proof allocates ROCKET and SHIELD
- **Test_Action_MinimumOneEach**: Enforces min 1 ROCKET and 1 SHIELD
- **Test_Action_TotalNotExceedDeployment**: Total <= player's deployment
- **Test_Action_ValidActionProof**: Successful action with valid proof
- **Test_Action_InvalidActionProof**: Revert with invalid proof
- **Test_Action_NotDeployed**: Fail if player not deployed
- **Test_Action_AlreadyActed**: Fail if already acted this round
- **Test_Action_DestroyedBunker**: Fail if bunker destroyed
- **Test_Action_DuringDeploymentPhase**: Fail during deployment phase
- **Test_Action_ProofTargetValidation**: Ensure attack targets are valid
- **Test_Action_SelfAttackPrevented**: Cannot attack own bunker
- **Test_Action_TriggersEERC20Mints**: Action triggers both token mints

### 4.5 Move Tests
- **Test_Move_ValidConnection**: Move between connected bunkers
- **Test_Move_InvalidConnection**: Fail for non-connected bunkers
- **Test_Move_NotDeployed**: Fail if not deployed
- **Test_Move_AlreadyActed**: Fail if acted this round
- **Test_Move_ToDestroyedBunker**: Fail if target destroyed
- **Test_Move_FromDestroyedBunker**: Fail if source destroyed
- **Test_Move_TokenTransfer**: Verify correct token movement
- **Test_Move_IndexUpdate**: Player gets new bunker's index
- **Test_Move_UpdatesMetadata**: Both bunkers' metadata updated

### 4.6 Retreat Tests
- **Test_Retreat_FullWithdrawal**: All tokens returned
- **Test_Retreat_PrestigeLoss**: Timestamp reset to 0
- **Test_Retreat_NotDeployed**: Fail if not deployed
- **Test_Retreat_CalculatesCurrentBalance**: Uses index for calculation
- **Test_Retreat_FromDestroyedBunker**: Special handling needed
- **Test_Retreat_DuringGameHalt**: Should still work
- **Test_Retreat_UpdatesMetadata**: Bunker total updated

### 4.7 Round Management Tests
- **Test_Round_Duration**: Exactly 8 hours from when started
- **Test_Round_StartTime**: Set when startNewRound() called
- **Test_Round_Emission**: Correct emission amounts by year
- **Test_Round_FinalRound**: Last emission handled correctly
- **Test_Round_NoStartDuringCleanup**: New round blocked by cleanup
- **Test_Round_ExplicitStart**: Waracle must call startNewRound() after WWIIInu()
- **Test_Round_NoActionsBeforeStart**: Players cannot act until new round starts
- **Test_Round_StartEndBoundary**: Actions at exact round start/end timestamps
- **Test_Round_BlockTimestampManipulation**: Test resilience to minor timestamp variations
- **Test_Round_GapBetweenRounds**: Time between round end and next start tracked

### 4.8 Index System Tests
- **Test_Index_InitialValue**: Starts at BASE_INDEX (10000 * 1e18)
- **Test_Index_DamageCalculation**: Decreases proportionally
- **Test_Index_ResourceCalculation**: Increases proportionally
- **Test_Index_PrecisionMaintained**: No significant rounding errors
- **Test_Index_CompoundingEffects**: Multi-round calculations accurate
- **Test_Index_ZeroIndexPrevention**: Destroyed bunkers set to 0
- **Test_Index_PlayerBalanceCalculation**: getCurrentDeployment accuracy
- **Test_Index_CompoundingPrecision_3000Rounds**: Test index precision over 3,000+ rounds
- **Test_Index_DustAccumulation**: Verify no significant dust accumulates with frequent 8-hour updates

### 4.9 Game State Tests
- **Test_GameHalt_OwnerOnly**: Only owner can halt
- **Test_GameHalt_StopsActions**: All actions except retreat blocked
- **Test_GameHalt_AllowsRetreat**: Players can still withdraw
- **Test_EmergencyHalt_24HourWait**: Cannot trigger before 24 hours
- **Test_EmergencyHalt_AnyoneCanTrigger**: Any address can call after timeout
- **Test_EmergencyHalt_OnlyUnresolvedRounds**: Cannot halt if round resolved
- **Test_EmergencyHalt_StopsGame**: Game enters withdraw-only mode
- **Test_GameEnd_NoNewRounds**: No rounds after emissions exhausted
- **Test_GameEnd_FinalDistribution**: Last emission distributed correctly
- **Test_GameEnd_PermanentState**: Game remains in ended state
- **Test_GameEnd_After3Years**: Verify game ends correctly after ~3,285 rounds (3 years)
- **Test_GameEnd_ExactEmissionExhaustion**: Test when emissions exactly hit 0

### 4.10 Player Behavior Tests
- **Test_Player_RapidRedeployment**: Player retreats and redeploys within same 8-hour round
- **Test_Player_ActionTimingEdgeCase**: Player acts in final seconds of 8-hour round
- **Test_Player_ConsecutiveRoundActions**: Player acts in 10+ consecutive 8-hour rounds
- **Test_Player_TimezoneAdvantage**: Test that 8-hour rounds don't unfairly advantage certain timezones
- **Test_Player_MissedActionAccumulation**: Player missing multiple 8-hour rounds in succession

## 6. Waracle Contract Tests

### 5.1 Waracle Permissions & Access Control
- **Test_Waracle_OnlyCanResolveRounds**: Only Waracle can call WWIIInu()
- **Test_Waracle_OnlyCanStartRounds**: Only Waracle can call startNewRound()
- **Test_Waracle_OnlyCanStartGame**: Only Waracle can start game after deployment
- **Test_Waracle_OnlyCanDestroyBunkers**: Only Waracle can execute destruction
- **Test_Waracle_OnlyCanTriggerCleanup**: Only Waracle initiates cleanup
- **Test_Waracle_UnauthorizedReverts**: Non-Waracle calls revert
- **Test_Waracle_MustResolveBeforeNewRound**: startNewRound requires resolved round

### 5.2 Balance Revelation Workflow
- **Test_Waracle_DecryptsBalances**: Waracle decrypts ROCKET/SHIELD balances
- **Test_Waracle_SubmitsAllBalances**: Submits all 5 bunker balances in one transaction
- **Test_Waracle_CalculatesNetDamage**: Correct ROCKET - SHIELD math (if positive)
- **Test_Waracle_BurnsAfterCalculation**: Triggers token burning after damage calc
- **Test_Waracle_EmitsSubmissionEvent**: WaracleSubmission event contains all data
- **Test_WaracleSubmission_EventData**: Event has correct balances, damages, destroyed flags

### 5.3 Combat Resolution Tests
- **Test_Combat_NoDamage**: SHIELDS >= ROCKETS (netDamage = 0)
- **Test_Combat_MinorDamage**: Small net damage applied
- **Test_Combat_MajorDamage**: Large but non-fatal damage
- **Test_Combat_ExactDestruction**: Damage exactly equals total WWIII
- **Test_Combat_Overkill**: Damage exceeds total WWIII
- **Test_Combat_TokensBurnedAfter**: All ROCKET/SHIELD burned post-calculation
- **Test_Combat_FreshStartEachRound**: No accumulated balances from previous rounds
- **Test_Combat_TwoStepResolution**: WWIIInu then startNewRound required

### 5.4 Resource Distribution Tests
- **Test_Resources_VaultWithdrawal**: Game withdraws from vault first
- **Test_Resources_DirectToBunkers**: Tokens go directly to bunker contracts
- **Test_Resources_IndexUpdate**: Bunker indices update after distribution
- **Test_Resources_NormalBunkers**: 1x share each
- **Test_Resources_CentralBunker**: Bunker 3 gets 2x share
- **Test_Resources_DestroyedBunkerSpoilage**: Resources burn for destroyed
- **Test_Resources_YearlyDecline**: Emission schedule followed
- **Test_Resources_FinalRoundDistribution**: Remaining emissions distributed
- **Test_Resources_InsufficientVault**: Handles vault having less than expected
- **Test_Resources_EmptyVault**: Game ends gracefully when vault empty
- **Test_Resources_SmallAmountPrecision**: Verify ~913k tokens (Year 3) distribute correctly
- **Test_Resources_FinalYearDustHandling**: Handle rounding with smaller Year 3 emissions
- **Test_Resources_OddDivisionBunker3**: Ensure 2x share for Bunker 3 works with smaller amounts
- **Test_Resources_RoundingErrors_HighFrequency**: Test resource distribution precision with smaller per-round amounts

### 5.5 Waracle-Controlled Cleanup Process
- **Test_Cleanup_OnlyWaracle**: Only Waracle can initiate cleanup
- **Test_Cleanup_RequiredAfterDestruction**: pendingCleanup = true
- **Test_Cleanup_BatchProcessing**: Waracle processes players in batches
- **Test_Cleanup_ProgressTracking**: bunkerDestructionProgress increments
- **Test_Cleanup_PlayerReset**: All player data cleared
- **Test_Cleanup_ArrayDeletion**: Player arrays deleted after cleanup
- **Test_Cleanup_MultipleBunkers**: Multiple destroyed bunkers handled
- **Test_Cleanup_CompletionCheck**: pendingCleanup = false when done
- **Test_Cleanup_BlocksNewRound**: New rounds blocked until cleanup complete

### 5.6 Bunker Recovery Tests
- **Test_Bunker_QuickRecovery**: Bunker destroyed and reoccupied within 8 hours
- **Test_Bunker_MultipleDestructionsCycle**: Multiple bunkers destroyed/recovered in rapid succession

### 5.7 Round Resolution Edge Cases
- **Test_Attack_8HourCoordination**: Test coordinated attacks within single 8-hour window
- **Test_Attack_RapidBunkerElimination**: Sequential bunker destructions across multiple 8-hour rounds

## 7. eERC20 Integration Tests

### 6.1 Registration & Setup
- **Test_BunkerRegistration**: All 5 bunkers must register with eERC20 Registrar
- **Test_BunkerPublicKeys**: Each bunker has unique BabyJubJub key pair
- **Test_RegistrationProofs**: Bunkers provide valid registration proofs
- **Test_GameContractPermissions**: Game contract authorized to mint ROCKET/SHIELD
- **Test_NoPlayerRegistration**: Verify players don't need eERC20 registration

### 6.2 Action Circuit to Mint Flow
- **Test_ActionProof_GeneratesMintProofs**: Action proof creates ROCKET/SHIELD mint proofs
- **Test_MintProof_ContainsTargets**: ROCKET to target bunker, SHIELD to player bunker
- **Test_MintProof_EncryptsAmounts**: Amounts encrypted with bunker public keys
- **Test_MintProof_Nullifiers**: Unique nullifiers prevent replay
- **Test_PrivateMint_Success**: eERC20 privateMint executes correctly

### 6.3 Balance Encryption & Revelation
- **Test_BalanceEncryption**: ROCKET/SHIELD balances stored as EGCT
- **Test_WaracleDecryption**: Waracle can decrypt using bunker private keys
- **Test_BalancePrivacy**: Others cannot decrypt balances
- **Test_RevelationEvent**: CombatDataRevealed event contains all data

### 6.4 Token Burning After Combat
- **Test_BurnAfterCombat**: ROCKET/SHIELD burned after damage calculation
- **Test_BurnAuthorization**: Only bunker contracts can burn their tokens
- **Test_BurnCompleteness**: All tokens burned, balance goes to zero
- **Test_BurnEvent**: TokensBurned event includes bunkerId and round

## 8. Integration Tests

### 7.1 Full Round Cycle
- **Test_FullRound_NormalFlow**: Deploy, act, resolve, distribute
- **Test_FullRound_WithDestruction**: Include bunker destruction
- **Test_FullRound_WithCleanup**: Full cleanup process
- **Test_FullRound_MultipleRounds**: 10+ rounds in sequence
- **Test_FullRound_YearTransition**: Emission schedule changes
- **Test_FullRound_8HourCycles**: Test 24 consecutive 8-hour rounds (8 days)
- **Test_FullRound_EventValidation**: Verify WaracleSubmission event accuracy

### 7.2 Multi-Player Scenarios
- **Test_Multiplayer_BunkerCoordination**: 50+ players defending
- **Test_Multiplayer_MassExodus**: Coordinated moves
- **Test_Multiplayer_CompetingActions**: High activity rounds
- **Test_Multiplayer_GasOptimization**: Large-scale operations

### 7.3 Attack Patterns
- **Test_Attack_SingleTarget**: Focus fire on one bunker
- **Test_Attack_Distributed**: Spread attacks across bunkers
- **Test_Attack_CentralBunkerFocus**: Target bunker 3 (2x resources)
- **Test_Attack_DefenseCoordination**: Optimal defense strategies

### 7.4 Economic Scenarios
- **Test_Economic_ResourceAccumulation**: Long-term resource building
- **Test_Economic_PrestigeValue**: Deployment duration tracking
- **Test_Economic_TokenVelocity**: Movement patterns
- **Test_Economic_SupplyShocks**: Mass destruction events
- **Test_Economic_3YearProgression**: Full 3-year economic cycle test

### 7.5 State Consistency Tests
- **Test_State_3000RoundConsistency**: Verify state remains consistent after 3,000 rounds
- **Test_State_YearLongDeployment**: Player deployed for entire year without actions
- **Test_YearTransition_EmissionSteps**: Verify smooth transitions at year boundaries

## 9. Security ## 8. Security & Edge Case Tests Edge Case Tests

### 8.1 Reentrancy Tests
- **Test_Reentrancy_Deployment**: No reentrancy during deploy
- **Test_Reentrancy_Retreat**: No reentrancy during withdraw
- **Test_Reentrancy_Move**: No reentrancy during transfers
- **Test_Reentrancy_Resolution**: No reentrancy in WWIIInu

### 8.2 Access Control Tests
- **Test_Access_OnlyOwnerFunctions**: Admin functions protected
- **Test_Access_ContractInteractions**: Only authorized contracts
- **Test_Access_WaraclePrivileges**: Only Waracle can resolve/destroy
- **Test_Access_DirectBunkerAccess**: Users can't bypass game
- **Test_Access_NoPublicResolution**: Public cannot trigger round resolution

### 8.3 Overflow/Underflow Tests
- **Test_Math_IndexCalculations**: No precision loss attacks
- **Test_Math_DamageCalculations**: Safe arithmetic
- **Test_Math_ResourceCalculations**: No overflow on distribution
- **Test_Math_BalanceCalculations**: Player balance accuracy

### 8.4 State Consistency Tests
- **Test_State_BunkerTotalTracking**: totalDeployed always accurate
- **Test_State_PlayerDataSync**: Player state matches reality
- **Test_State_IndexConsistency**: Indices reflect true values
- **Test_State_RoundStateTransitions**: Clean state changes

### 8.5 Griefing Tests (Limited by Waracle Control)
- **Test_Grief_FakeDeployments**: Minimum deposit prevents spam deployments
- **Test_Grief_MassMovement**: Coordinated moves to empty bunkers
- **Test_Grief_NoPublicCleanup**: Verify public cannot trigger cleanup (Waracle only)
- **Test_Grief_NoRoundManipulation**: Public cannot affect round timing (Waracle only)
- **Test_Grief_ActionProofSpam**: Nullifiers prevent proof replay attacks

### 8.6 Front-Running Tests
- **Test_Frontrun_Deployment**: Deploy to favorable bunker
- **Test_Frontrun_Movement**: Move before attack lands
- **Test_Frontrun_ActionProofs**: Cannot frontrun action proofs (nullifiers)
- **Test_Frontrun_NoPublicResolution**: Waracle-only prevents frontrunning

### 8.7 Timing Edge Cases
- **Test_Round_ExactBoundaries**: Actions at exact round start/end timestamps
- **Test_Round_TimestampPrecision**: No issues with 8-hour increments
- **Test_Round_LateWaracleProcessing**: Rounds work correctly if Waracle processes late
- **Test_Round_24HourTimeout**: Emergency halt triggers exactly at 24 hours
- **Test_Round_NoActionsInGap**: Players cannot act between round end and new start

## 10. Gas Optimization Tests

### 9.1 Operation Costs
- **Test_Gas_Deployment**: Measure deploy gas costs
- **Test_Gas_Actions**: Attack/defend gas usage
- **Test_Gas_Movement**: Inter-bunker transfer costs
- **Test_Gas_Resolution**: WWIIInu gas requirements
- **Test_Gas_Cleanup**: Batch cleanup optimization
- **Test_Gas_HighFrequencyResolution**: Gas costs for resolving rounds 3x per day over extended period

### 9.2 Scaling Tests
- **Test_Scale_100Players**: Performance with 100 players
- **Test_Scale_1000Players**: Performance with 1000 players
- **Test_Scale_LongGame**: 3,000+ rounds performance
- **Test_Scale_MassDestruction**: Cleanup of large bunkers

## 11. Event Emission Tests

### 10.1 Player Events
- **Test_Event_PlayerDeployed**: Correct emission and data
- **Test_Event_PlayerMoved**: Movement tracking
- **Test_Event_PlayerRetreated**: Retreat with duration
- **Test_Event_NoActionEvents**: Attack/defend emit nothing

### 10.2 Game Events
- **Test_Event_RoundStarted**: Round initialization
- **Test_Event_RoundResolved**: Resolution tracking
- **Test_Event_BunkerDestroyed**: Destruction events
- **Test_Event_ResourceDistribution**: Economic events

### 10.3 Waracle Events
- **Test_Event_GameStarted**: Waracle starts game after deployment phase
- **Test_Event_WaracleSubmission**: Comprehensive balance and damage data
- **Test_Event_WaracleSubmission_Format**: Verify event data structure
- **Test_Event_WaracleSubmission_DestroyedFlags**: Bit flags correctly set
- **Test_Event_CleanupInitiated**: Waracle starts cleanup process

## 12. Failure Mode Tests

### 11.1 Contract Failure Scenarios
- **Test_Failure_BunkerContractFailure**: Handle bunker contract issues
- **Test_Failure_TokenTransferFailure**: Failed token transfers
- **Test_Failure_ProofSystemFailure**: Invalid proof handling
- **Test_Failure_PartialStateUpdates**: Atomic operation tests

### 11.2 Recovery Tests
- **Test_Recovery_AfterHalt**: Resume after emergency halt
- **Test_Recovery_MigrationPath**: Token withdrawal for migration
- **Test_Recovery_StuckTokens**: No tokens permanently locked
- **Test_Recovery_InconsistentState**: State repair possibilities

## 13. Action Circuit Deep Testing

### 12.1 Circuit Constraint Validation
- **Test_Circuit_MinimumConstraints**: Verify ≥1 for each token type
- **Test_Circuit_SumConstraint**: ROCKET + SHIELD ≤ deployment
- **Test_Circuit_NonNegativeConstraints**: No negative values allowed
- **Test_Circuit_DeploymentVerification**: Circuit validates deployment ownership

### 12.2 Encryption & Target Validation
- **Test_Circuit_ROCKETEncryption**: Encrypts with target bunker key
- **Test_Circuit_SHIELDEncryption**: Encrypts with player bunker key
- **Test_Circuit_TargetBunkerRange**: Target must be 1-5
- **Test_Circuit_SelfTargetPrevention**: Cannot target own bunker
- **Test_Circuit_InvalidTargetRejection**: Rejects non-existent bunkers

### 12.3 Proof Generation & Integration
- **Test_ProofGen_ValidInputs**: Generate valid proofs
- **Test_ProofGen_InvalidSplits**: Reject 0/0 or excess splits
- **Test_ProofGen_Deterministic**: Same inputs = same proof
- **Test_ProofToMint_Integration**: Proof triggers correct mints
- **Test_ProofNullifier_Uniqueness**: Each action has unique nullifier

## Test Execution Strategy

### Phase 1: Unit Tests
- Individual function testing
- Input validation
- Access control
- State changes

### Phase 2: Integration Tests
- Multi-contract interactions
- Full game flows
- Complex scenarios
- Edge case combinations

### Phase 3: Stress Tests
- High player counts
- Long game simulations (3,000+ rounds)
- Gas optimization
- Performance benchmarks

### Phase 4: Security Audit Tests
- Known attack vectors
- Economic exploits
- State manipulation
- Front-running scenarios

## Success Criteria

- 100% code coverage
- All security tests pass
- Gas costs within acceptable ranges
- No state inconsistencies found
- Event emissions correct
- Mathematical precision maintained
- Game economics balanced
- 8-hour round transitions smooth
- 3-year emission schedule accurate

## Additional Considerations

### Event Validation Tests
- **Test_EventReplay_FullGame**: Replay entire game from events
- **Test_EventReplay_DamageValidation**: Verify damage calculations from events
- **Test_EventReplay_ResourceTracking**: Track resource flow via events
- **Test_EventReplay_StateReconstruction**: Rebuild game state from events only
- **Test_WaracleSubmission_Completeness**: Every round has WaracleSubmission event
- **Test_WaracleSubmission_Consistency**: Event data matches other events

### Mainnet Forking Tests
- Test with real token behaviors
- Verify gas costs on target chain
- Check block time assumptions

### Fuzzing Recommendations
- Fuzz test all numeric inputs
- Property-based testing for invariants
- Stateful fuzzing for game progression
- Extended fuzzing for 3,000+ round scenarios

### Invariant Checks
- Total WWIII in bunkers + player wallets = constant
- Sum of all indices changes = resource distributions
- Destroyed bunker index always 0
- Player can only occupy one bunker
- Round number only increases
- Round duration always 8 hours
- Emission schedule follows 3-year plan
- No precision loss over 3,000+ rounds
- Every resolved round has exactly one WaracleSubmission event
- WaracleSubmission damages match BunkerDamaged events

### 8-Hour Round Specific Considerations
- Players in different timezones have equal opportunity
- Rapid state transitions don't cause race conditions
- Gas costs remain sustainable with 3x more resolutions
- Index precision holds over thousands of updates
- Cleanup incentives remain strong despite shorter rounds

This comprehensive test plan covers all critical paths, edge cases, and security considerations for the WWIII blockchain game with 8-hour rounds and 3-year emissions. Each test should be implemented with detailed assertions and event checks to ensure complete verification of the game's behavior.