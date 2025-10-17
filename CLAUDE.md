# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Documents

**IMPLEMENTATION_PLAN.md** - This document should ALWAYS be referenced as the source of truth for the WWIII game implementation using the eERC20 protocol. It contains the definitive architecture, design decisions, and implementation approach.

## Project Overview

The Encrypted ERC-20 (eERC) protocol enables privacy-preserving token transfers on Avalanche using zero-knowledge proofs and partially homomorphic encryption. It operates in two modes:
- **Standalone**: Creates new private ERC-20 tokens
- **Converter**: Wraps existing ERC-20 tokens with privacy features

## Key Commands

### Build & Compile
```bash
npm install                    # Installs deps and compiles contracts/circuits
npx hardhat compile           # Compile smart contracts only
npx hardhat zkit make --force # Compile zk circuits only
npx hardhat zkit verifiers   # Generate verifier contracts
```

### Testing
```bash
npx hardhat test                        # Run all tests
npx hardhat test test/EncryptedERC-Standalone.ts  # Test standalone mode
npx hardhat test test/EncryptedERC-Converter.ts   # Test converter mode
npx hardhat coverage                    # Generate coverage report
```

### Linting
```bash
npm run lint      # Lint all code (Solidity + TypeScript)
npm run lint:sol  # Lint Solidity only
npm run lint:ts   # Lint TypeScript only
```

### Local Development
```bash
npx hardhat node                                              # Start local blockchain
npx hardhat run scripts/deploy-standalone.ts --network localhost
npx hardhat run scripts/deploy-converter.ts --network localhost
```

## Architecture

### Smart Contracts (`/contracts/`)
- `EncryptedERC.sol`: Main privacy token contract with mint/transfer/withdraw/burn operations
- `Registrar.sol`: Manages user registration and BabyJubJub public keys
- `EncryptedUserBalances.sol`: Stores encrypted balances using Poseidon encryption
- Verifier contracts: Groth16 verifiers for each zk-SNARK circuit

### Zero-Knowledge Circuits (`/circom/`)
Five main circuits using Circom 2.1.9:
- `registration.circom`: Proves knowledge of private key
- `mint.circom`: Proves valid minting with balance update
- `transfer.circom`: Proves valid transfer between encrypted balances
- `withdraw.circom`: Proves balance sufficiency for withdrawal
- `burn.circom`: Proves balance sufficiency for burning

### TypeScript SDK (`/src/`)
- BabyJubJub elliptic curve operations
- Poseidon hash and encryption/decryption
- Client-side proof generation utilities

### Testing (`/test/`)
- `user.ts`: User class simulating client-side operations
- `helpers.ts`: Test utilities and fixture management
- Comprehensive test coverage (97%)

## Technical Details

- **Cryptography**: BabyJubJub curve, Poseidon hash, Groth16 zk-SNARKs
- **Solidity**: Version 0.8.27, optimizer enabled (200 runs)
- **TypeScript**: ES2020 target, strict mode
- **Formatting**: Biome with tabs and double quotes
- **Network**: Avalanche C-Chain optimized (low gas costs)

## Security

- Multiple audits completed (see `/audit/` directory)
- Trusted setup ceremony completed for production verifiers
- Production verifier contracts in `/contracts/prod/`

## Critical Architecture Clarifications

### eERC20 Integration Architecture
**IMPORTANT**: Final architecture for ROCKET/SHIELD token minting and management:

1. **Game Contract Token Ownership**: WWIIIGame contract owns ROCKET and SHIELD tokens to access `privateMint` function (onlyOwner modifier)

2. **Bunkers as Registered Recipients**: Each bunker contract must be registered in the eERC20 system with BabyJubJub key pairs because:
   - eERC20 `privateMint(user, proof)` requires `user` to be registered for validation
   - The `user` parameter is the actual recipient of the minted tokens
   - Bunker addresses are visible in mint transactions (required by eERC20 architecture)

3. **Privacy Model - Fog of War via Encryption**: 
   - **Attack targets are visible** (bunker addresses in privateMint calls)
   - **Attack/defense amounts are encrypted** (true privacy preservation)
   - **Strategic information hidden** (opponents can't see resource allocation)

4. **Bunker Key Management**: Each bunker has its own BabyJubJub key pair:
   - Private keys stored securely off-chain by Waracle
   - Public keys registered with eERC20 Registrar contract
   - Waracle uses bunker private keys to decrypt ROCKET/SHIELD balances for combat resolution

5. **eERC20 Token Construction**: ROCKET/SHIELD tokens use `CreateEncryptedERCParams` struct:
   ```solidity
   CreateEncryptedERCParams({
       registrar: registrarAddress,
       isConverter: false,  // Standalone mode
       name: "ROCKET",     // or "SHIELD"
       symbol: "ROCKET",   // or "SHIELD"
       decimals: 18,
       mintVerifier: mintVerifierAddress,
       withdrawVerifier: withdrawVerifierAddress,
       transferVerifier: transferVerifierAddress,
       burnVerifier: burnVerifierAddress
   })
   ```

### Implementation Flow:
1. Deploy WWIIIGame contract (becomes owner of ROCKET/SHIELD tokens)
2. Deploy 5 bunker contracts with BabyJubJub key pairs
3. Register each bunker with eERC20 system (registration proof required)  
4. Store bunker private keys securely off-chain for Waracle access
5. Player deploys 10k WWIII → transfers to Bunker contract
6. Player attacks → Action proof validated → ROCKET tokens minted to target bunker, SHIELD to current bunker
7. Round ends → Waracle decrypts bunker balances using stored private keys
8. Damage applied proportionally to player WWIII tokens

### Token Ownership Management:
- **Initial Setup**: WWIIIGame contract owns ROCKET and SHIELD tokens for privateMint access
- **Migration Support**: Two-step ownership transfer via Ownable2Step:
  1. `transferTokenOwnership(tokenAddress, newOwner)` - initiates transfer
  2. `acceptTokenOwnership(tokenAddress)` - new contract accepts ownership
- **Security**: Prevents accidental ownership loss during game contract upgrades

## Game Contract Implementation Requirements

**CRITICAL: The game contract is the most important component of this project. Security is paramount.**

### Pre-Implementation Standards (95%+ Confidence Required)

Before implementing the game contract, validate complete understanding of:
1. **eERC20 Protocol**: privateMint access control, proof validation, nullifier system
2. **Game Design**: Round mechanics, player actions, combat resolution, index system
3. **Implementation Plan**: Architecture decisions, deviations, security considerations  
4. **Build Plan**: All phases, implementation notes, critical requirements

### Code Quality Requirements

- **Clean & Readable**: Simple code that does ONLY what it's supposed to do
- **Security-First**: ReentrancyGuard, checks-effects-interactions, input validation
- **Precision-Safe**: Use 1e18 precision, multiply before divide, handle edge cases
- **Event-Complete**: Comprehensive events for auditability and transparency

### Critical Implementation Details

**Index System (Precision = 1e18)**:
- BASE_INDEX = 10,000 * 1e18 (starting point for all bunkers)
- Player balance = (deployedAmount * currentIndex) / depositIndex  
- Damage: newIndex = (oldIndex * remaining * PRECISION) / ((remaining + damage) * PRECISION)
- Destruction: index = 0 marks destroyed bunker, prevents division errors

**eERC20 Integration**:
- Game contract must be owner of ROCKET/SHIELD tokens
- privateMint() requires: onlyOwner, onlyIfAuditorSet, onlyForStandalone, onlyIfUserRegistered(bunker)
- Action circuit validates allocation constraints (≥1 each, total ≤ deployed, valid targets)
- Each bunker needs unique BabyJubJub key pair for encryption

**Security Checklist**:
- [ ] ReentrancyGuard on all external functions
- [ ] Input validation with custom errors
- [ ] Checks-effects-interactions pattern
- [ ] Handle vault partial transfers gracefully
- [ ] Atomic bunker destruction (index=0, clear players)
- [ ] Emergency halt mechanism (24h timeout)
- [ ] Comprehensive event emissions

**Game Phases**:
- Deployment Phase: 2 days (modifiable by owner for unforeseen circumstances)
- Active Rounds: 8 hours each
- Emergency halt: After 24h Waracle timeout

## Guiding Principles

- Security in smart contracts is paramount. Approach every change through the lens of a security expert and master auditor

## Important Memories

- DO NOT TRY WORKAROUNDS THAT MAY COMPROMISE THE INTEGRITY OF TESTS OR CONTRACTS WHEN YOU FACE ERRORS! FIX THE ROOT CAUSE OF THE ERROR!

## Critical Architecture Details

### Round Resolution Order of Operations
**VERY IMPORTANT**: In round resolution (WWIIInu function), the order is:
1. **Apply damage first**: `totalDeployed = totalDeployed - damage`
2. **Check if bunker destroyed**: If `damage >= totalDeployed`, bunker is destroyed (index = 0)
3. **IF bunker survives**: Distribute emissions to bunker: `totalDeployed = totalDeployed + emissionsReceived`

Therefore: `finalTotalDeployed = originalTotal - damage + emissions` (if bunker survives)

This means damage tests must account for both damage AND emissions in the same round. To test pure damage effects, ensure `damage > emissions` so net effect is negative.