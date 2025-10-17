# Encrypted War Games: Privacy-Preserving Strategic Combat on the Blockchain

**Author**: [xrpant](https://github.com/anthonybautista)

## Abstract

Encrypted War Games represents a groundbreaking fusion of zero-knowledge cryptography and strategic gameplay, creating the first truly privacy-preserving multiplayer strategy game on the blockchain. Built upon the EncryptedERC (eERC20) protocol, the game demonstrates how advanced cryptographic techniques can enable complex strategic interactions while maintaining the "fog of war" essential to competitive gameplay.

This whitepaper outlines a complete ecosystem where players deploy resources to fortified positions, execute encrypted combat actions, and compete for token emissions through strategic territorial control—all while ensuring that resource allocations remain hidden from opponents until combat resolution.

## Introduction

### The Problem with Transparent Blockchain Games

Traditional blockchain games suffer from a fundamental transparency problem: all transactions and state changes are publicly visible, eliminating strategic privacy that makes games engaging. Players can observe opponent resources, predict strategies, and front-run actions, reducing gameplay to mechanical optimization rather than strategic thinking.

### The EncryptedERC Solution

The EncryptedERC protocol solves this transparency problem by introducing privacy-preserving token operations through zero-knowledge proofs and elliptic curve encryption. This allows for complex token mechanics where balances and transfers remain encrypted while maintaining cryptographic guarantees of correctness.

## EncryptedERC Protocol Foundation

### Core Cryptographic Components

The game leverages several key cryptographic primitives from the EncryptedERC protocol:

**1. BabyJubJub Elliptic Curve Cryptography**
- Provides efficient key pair generation and digital signatures
- Enables secure encryption of sensitive game data
- Compatible with zero-knowledge proof systems

**2. Poseidon Hash Function**
- Optimized for zero-knowledge circuits
- Provides collision-resistant hashing for nullifiers and commitments
- Enables efficient proof generation and verification

**3. Zero-Knowledge Proof System (Groth16)**
- Allows players to prove action validity without revealing private information
- Enables complex constraint validation with minimal on-chain verification cost
- Provides cryptographic guarantees against cheating and manipulation

**4. Homomorphic Encryption (ElGamal)**
- Enables encrypted arithmetic operations on hidden values
- Allows combat resolution without revealing individual contributions
- Maintains privacy throughout the entire game lifecycle

### Why EncryptedERC Fits Strategic Gaming

The EncryptedERC protocol provides three essential features for strategic gaming:

1. **Private Minting**: Resources can be allocated to specific targets with amounts remaining encrypted
2. **Encrypted Balances**: All token holdings are cryptographically hidden from public view
3. **Verifiable Operations**: Zero-knowledge proofs ensure all actions follow game rules without revealing strategy

This combination enables true "fog of war" where players see targets but not resource allocations, preserving the strategic depth essential for engaging gameplay.

## Game Mechanics

### Tokens

There are three main tokens utilized, one standard ERC20 and two eERC20.

**Game Token** is a standard ERC20 token used to deploy into the battlefield and can be freely traded on the open market.

**Attack and Defense Tokens** are encrypted tokens that are only utilized within the game.

### Battlefield Architecture

The game operates on a fixed battlefield consisting of five interconnected bunkers:

```
    1 ════ 2
    ║  ╲ ╱ ║
    ║   3  ║
    ║  ╱ ╲ ║
    4 ════ 5
```

**Bunker 3** serves as the central hub, connecting to all other positions. This strategic importance is reflected in double emission rewards, creating high-risk, high-reward gameplay around the center position.

### Player Actions

Players may take one action per round aside from deployment/adding to their deployment. Once a non-deployment action is taken, the player's turn is over and no further actions can be taken until combat resolution has been processed and a new round is started.

**Deployment**: Players commit a minimum of 10,000 game tokens to a single bunker, establishing their battlefield presence and beginning their prestige accumulation. More tokens can be deployed as long as a non-deployment action has not taken place in the current round.

**Combat Actions**: Each round, players may choose to make a combat action by submitting a zero-knowledge proof that validates:
- Allocation of at least 1 token each to attack and defense 
- Total allocation does not exceed deployed resources
- Target bunker selection follows connection topology
- All amounts remain encrypted until resolution

Making a combat action does not in and of itself change your game token deployments, only combat resolution can add or subtract from your deployed balance.

**Movement**: Players can relocate between connected bunkers, transferring all resources while ending their turn for the current round.

**Retreat**: Complete withdrawal from the battlefield, resetting prestige but preserving accumulated tokens.

### Combat Resolution

At the end of each 8-hour round, a trusted Waracle (oracle service) decrypts all combat allocations and processes the results:

1. **Balance Decryption**: Using privately held bunker keys, the Waracle reveals actual attack and defense token balances
2. **Damage Calculation**: Net damage = Total attack received - Total defense received
3. **Bunker Destruction**: Bunkers who receive net damage greater than the total amount of tokens deployed to them are destroyed, removing players from the game and burning all of their tokens
4. **Emission Distribution**: Surviving bunkers with deployments > 0 receive proportional resource rewards. The resource rewards for a bunker that has been destroyed or has 0 deployments will be burned, permanently reducing token supply
5. **Index Updates**: Bunker ownership indices adjust proportionally to reflect damage and resource rewards (emissions)
6. **Combat Token Burning**: All attack and defense tokens are completely destroyed after processing, ensuring clean round transitions
7. **Bunker Reactivation**: After destruction, bunkers are reset and available for deployment

### Privacy Model: Fog of War Through Encryption

The game achieves strategic privacy through a carefully designed information model:

**Visible Information**:
- Attack targets (required by EncryptedERC minting mechanics)
- Player positions and movement
- Bunker destruction and survival
- Historical combat outcomes

**Hidden Information**:
- Resource allocation amounts between attack and defense
- Individual player combat spending
- Strategic patterns and preferences

This creates a "fog of war" where players understand the battlefield situation but cannot predict opponent strategies or resource commitments. For instance, you may see that a player has "attacked" a specific bunker, but they may have only allocated 1 attack token to that bunker and spent the rest of their deployment on defense tokens for their own bunker.

## Tokenomics

### Token Distribution

The game operates with a fixed supply of 10 billion tokens distributed as follows:

- **60% (6B tokens)**: Game emissions distributed over 3+ years
- **27% (2.7B tokens)**: Liquidity pool and market operations
- **10% (1B tokens)**: Developer allocation for ongoing development
- **3% (300M tokens)**: Community giveaways and partnerships

### Emission Schedule

The emission system uses a declining model to ensure long-term sustainability:

**Year 1**: 3 billion tokens (~2.74M per round)

**Year 2**: 2 billion tokens (~1.83M per round)  

**Year 3**: 1 billion tokens (~913K per round)

**Post-Year 3**: Remaining balance distributed over final rounds

### APY Calculation Examples

*NOTE: These calculations are simply for illustration purposes. Predicting actual gameplay and APY is impossible*

To illustrate the earning potential, consider scenarios with 25% of floating supply (675M tokens) deployed in the first round:

#### Standard Distribution Scenario

**Setup**: 675M tokens distributed proportionally:
- **Bunkers 1, 2, 4, 5**: 112.5M tokens each
- **Bunker 3**: 225M tokens (2x deployment due to 2x emissions)

**Year 1 Round Emission**: 2.74M tokens per 8-hour round (1,095 rounds/year)
- **Base Share**: 2.74M ÷ 6 = 457K tokens per share
- **Bunkers 1, 2, 4, 5**: 457K tokens per round each
- **Bunker 3**: 914K tokens per round (2x emission multiplier)

**No Damage Scenario**:
- Standard bunker net gain per round: +457K tokens
- Bunker 3 net gain per round: +914K tokens
- Standard bunker APY: (457K ÷ 112.5M) × 1,095 rounds = 444.4% annual return
- Bunker 3 APY: (914K ÷ 225M) × 1,095 rounds = 444.4% annual return
- *Note: Equal APY despite 2x emissions due to proportional 2x deployment*

**Moderate Damage Scenario** (Standard bunker loses 200K/round):
- Standard bunker net gain: 457K - 200K = +257K tokens per round
- Standard bunker APY: (257K ÷ 112.5M) × 1,095 rounds = 249.9% annual return

**Significant Damage Scenario** (Standard bunker sustains 2M damage):
- Standard bunker net loss: 457K - 2M = -1.543M tokens per round
- Standard bunker APY: (-1.543M ÷ 112.5M) × 1,095 rounds = -150% annual return
- *Note: Obviously taking this kind of damage repeatedly would result in complete loss of funds over time*

#### High Concentration Scenario

**Setup**: Only 25M tokens deployed to one bunker, and somehow avoids taking damage

- **Net gain per round**: +457K tokens (no damage)
- **Extreme APY**: (457K ÷ 25M) × 1,095 rounds = 1,999.8% annual return

This demonstrates the massive rewards possible when participation is low, creating strong incentives for early adoption and strategic positioning.

#### Total Loss Scenario

**Setup**: It should be noted that in a case where a bunker is completely destroyed, players will lose ALL of their tokens.

### Flexible Emissions Model

Beyond the legacy schedule, the system supports owner-controlled emissions for market responsiveness:

- **Dynamic Adjustment**: Owner can modify emission rates based on market conditions
- **Multiple Games**: Different game instances can have independent emission schedules
- **Event Bonuses**: Special events can trigger increased emission periods
- **Emergency Controls**: Ability to revert to proven legacy schedule if needed

### Emission Distribution

Resources are distributed based on bunker control and survival:
- **Bunker 3**: Receives 2x standard allocation due to central vulnerability
- **Other Bunkers**: Equal shares of remaining emissions
- **Destroyed Bunkers**: Resources permanently lost to maintain scarcity

## Technical Architecture

### Smart Contract System

**Game Contract (1,200+ lines)**: Manages all game state, player actions, round progression, and resource distribution with comprehensive security measures.

**Token Contracts**: Standard ERC20 for game token plus dual EncryptedERC20 contracts for combat resources (attack/defense).

**Bunker Contracts**: Secure vault system using max-approval pattern for efficient token management and cryptographic key storage.

**Emission Vault**: Holds 6 billion tokens for distribution with partial-transfer logic to handle endgame scenarios gracefully.

### Zero-Knowledge Circuit Design

The action validation circuit implements sophisticated constraint checking with enhanced security:

```circom
// Server authentication prevents unauthorized proof generation
component serverHashCheck = Poseidon(1);
serverHashCheck.inputs[0] <== serverPrivateKey;
serverHashCheck.out === expectedServerHash;

// Security binding prevents proof sharing and replay attacks
signal input playerAddress;     // PUBLIC: Binds proof to specific player
signal input currentRound;      // PUBLIC: Prevents replay across rounds  
signal input deployedAmount;    // PUBLIC: Enables on-chain validation

// Validates allocation constraints and connection topology
// Ensures ≥1 each resource type, total ≤ deployed, valid targets
// Outputs complete mint proof data for EncryptedERC compatibility
```

**Circuit Statistics**:
- ~1,500 constraints (optimized for security and performance)
- 70 public signals (serverHash + rocketProof[8] + rocketSignals[24] + shieldProof[8] + shieldSignals[24] + bunkers[2] + security[3])
- Multi-layer security preventing sharing, replay, and state manipulation
- Full integration with production EncryptedERC mint circuits

**Security Enhancements**:
- **Player Address Binding**: Prevents proof sharing between players
- **Round Number Binding**: Prevents replay attacks across different rounds
- **Deployment Amount Validation**: Enables on-chain verification against game state
- **Server Authentication**: Poseidon hash authentication for backend-only proof generation

### Security Framework

**Access Control**: ReentrancyGuard protection on all external functions with role-based permissions for critical operations.

**Game Integrity**: Server-authenticated action proofs prevent unauthorized moves while zero-knowledge validation ensures rule compliance.

**Economic Security**: Precision handling with 1e18 constants, multiply-before-divide patterns, and graceful partial transfer logic.

**Emergency Systems**: 24-hour timeout protection with emergency halt mechanisms to prevent game stagnation.

## Future Development Possibilities

### Expanded Battlefield Configurations

**New Map Topologies**: Different bunker arrangements could create varied strategic environments:
- Linear battlefields for focused conflicts
- Circular arrangements for balanced positioning
- Asymmetric maps with distinct geographical advantages
- Multi-layer fortifications with outer and inner defenses

**Dynamic Terrain**: Maps that evolve based on combat history, creating permanent strategic changes and historical significance for major battles.

### Enhanced Combat Systems

**NFT Weapons and Equipment**: Unique digital assets providing combat bonuses:
- Siege weapons with area-of-effect capabilities
- Defensive installations with persistent effects
- Supply lines that modify resource generation
- Commander units with special abilities

**Upgradeable Fortifications**: Persistent bunker improvements that survive between rounds:
- Enhanced defenses reducing incoming damage
- Resource generation multipliers
- Advanced detection systems revealing partial opponent information
- Repair capabilities for damage mitigation

**Specialized Combat Units**: Different resource types with unique properties:
- Artillery for long-range attacks across non-adjacent bunkers
- Engineers for rapid fortification construction
- Scouts for limited information gathering
- Medics for damage recovery over time

### Advanced Gameplay Mechanics

**Alliance Systems**: Formal coalition mechanics with cryptographic commitment schemes:
- Resource sharing agreements with automated enforcement
- Coordinated attack protocols for joint operations
- Intelligence sharing with selective information revelation
- Betrayal mechanics with appropriate risk/reward structures

**Prestige and Ranking Evolution**: Extended progression systems beyond simple duration:
- Combat effectiveness ratings based on successful strategies
- Leadership bonuses for alliance coordination
- Historical achievement tracking with permanent recognition
- Seasonal competitions with exclusive rewards

**Multi-Game Universes**: Interconnected game instances with persistent player identity:
- Cross-game reputation and achievement systems
- Resource transfer between compatible game modes
- Escalating conflicts with higher stakes and rewards
- Professional leagues with structured competition formats

### Economic Innovations

**Dynamic Emission Models**: Adaptive reward systems responding to player behavior:
- Performance-based bonuses for skilled play
- Participation incentives for consistent engagement
- Market stability mechanisms during volatile periods
- Community governance for emission policy decisions

## Conclusion

Encrypted War Games demonstrates the transformative potential of privacy-preserving blockchain applications. By successfully integrating zero-knowledge proofs, homomorphic encryption, and strategic game design, the project creates an entirely new category of blockchain gaming where privacy enhances rather than hinders gameplay.

The game proves that complex strategic interactions can be maintained on transparent blockchains through careful cryptographic design. Players experience genuine strategic uncertainty and decision-making while benefiting from the security, immutability, and programmability of smart contracts.

The flexible emission system and extensible architecture position the game for long-term evolution, enabling new gameplay mechanics and economic models. The foundation established here opens pathways for sophisticated multiplayer experiences that preserve the human elements of strategy, deception, and alliance-building that make games engaging.

As blockchain technology continues advancing, privacy-preserving applications like Encrypted War Games will become essential for creating digital experiences that match the depth and engagement of traditional gaming while leveraging the unique capabilities of decentralized systems. This project represents a significant step toward that future, demonstrating that transparency and privacy can coexist to create better gaming experiences for everyone.

**Technical Implementation**: This whitepaper describes a fully implemented system with 180+ tests, comprehensive smart contracts, and production-ready deployment scripts. The game has been successfully deployed to testnet and validated through extensive testing scenarios.

**Security Note**: While the system has undergone thorough testing and static analysis, formal security audits should be completed before mainnet deployment. The cryptographic components leverage the audited EncryptedERC protocol as a foundation.

## Acknowledgments

- Built on the [EncryptedERC](https://github.com/ava-labs/EncryptedERC) protocol developed by Ava Labs

---
