# SecVote: Security & Auditability Architecture Report

## Executive Overview
**SecVote** is a blockchain-assisted digital voting platform engineered for dual-use deployment:
1. **Government / Public Elections** (e.g., voter ID & Aadhaar eKYC integration).
2. **Institutional / College Elections** (e.g., student roll numbers & campus SSO).

The system enforces cryptographic voter privacy, eligibility verification via Merkle proofs, double-voting prevention via nullifiers, and public on-chain auditability.

---

## 1. How Fake & Ineligible Votes Are Prevented

### A. Off-Chain Identity Verification
Before receiving a voting secret, voters must pass identity verification:
- **Government Mode**: Verifies Voter ID against official registries (simulated via UIDAI Aadhaar eKYC / OTP).
- **College Mode**: Verifies student roll numbers or institutional email addresses (`@srm.edu.in`).

### B. Cryptographic Merkle Tree Eligibility Proofs
1. **Secret Generation**: For every verified, eligible voter, the system generates a cryptographically random 16-byte one-time secret.
2. **Merkle Leaf Hash**: A cryptographic hash `leaf = keccak256(voter_secret)` is computed for each secret.
3. **On-Chain Merkle Root**: All leaf hashes are combined into a binary Merkle Tree. The admin publishes only the single 32-byte **Merkle Root** (`updateMerkleRoot`) to the smart contract before the voting window opens.
4. **On-Chain Verification**: When a vote is cast, the voter submits their `leaf` and `Merkle proof`. The smart contract evaluates `MerkleProof.verify(proof, merkleRoot, leaf)`. Any attempt by an unlisted voter to fabricate a vote is rejected by the EVM because they cannot produce a valid cryptographic proof leading to the published Merkle Root.

---

## 2. How Duplicate / Double Voting Is Prevented

### A. Nullifier Tracking
- The smart contract maintains an on-chain mapping `mapping(bytes32 => bool) public spentNullifiers`.
- When a vote is successfully cast, the contract executes:
  ```solidity
  require(!spentNullifiers[leaf], "Already voted");
  spentNullifiers[leaf] = true;
  ```
- If a voter attempts to cast a second ballot using the same secret (or if an attacker re-sends a captured payload), the EVM checks `spentNullifiers[leaf]`, detects that the leaf has already been marked as spent, and reverts the transaction immediately.

### B. Time-Boxed Voting Windows
- Elections enforce strict start (`startTime`) and end (`endTime`) timestamps on-chain.
- The smart contract rejects any voting attempts submitted before `startTime` or after `endTime`.

---

## 3. Voter Anonymity & Privacy (Unlinkability)

### A. Decoupling Identity from Ballot Choice
- Voter identity verification occurs strictly during the secret issuance phase.
- Once a voter receives their one-time secret, the identity session ends.
- The ballot casting endpoint (`/vote/cast`) requires only `voter_id` and `candidate_id` to generate the Merkle proof for the contract.

### B. On-Chain Ballot Privacy
- No voter names, Aadhaar numbers, roll numbers, or personal identifying information (PII) are ever written to the blockchain.
- The smart contract stores only candidate vote counts and spent nullifier hashes.

---

## 4. Backend Transaction Relay & Front-Running Protection

### A. Gasless & Frictionless UX
- In traditional dApps, users must hold crypto wallets (e.g. MetaMask) and pay ETH gas fees. SecVote uses a **backend transaction relay**: the FastAPI backend submits the smart contract transaction on behalf of the voter.

### B. Mempool Front-Running Prevention
- Submitting raw voter secrets to a public Ethereum mempool could allow malicious bots to intercept and front-run the secret before the user's transaction mines.
- The backend computes the `keccak256` leaf hash and Merkle proof server-side and submits the `leaf` (hash) rather than the raw secret to the smart contract, preventing secret theft while keeping the chain secure.

---

## 5. Public Auditability & Receipt Verification

1. **Transaction Receipt (`tx_hash`)**:
   - Upon successful vote submission, every voter receives a unique 66-character EVM transaction hash (e.g. `0x8f7a...`).
   - Voters can look up this transaction hash on any block explorer (or local testnet explorer) to verify that their ballot was mined and included in an EVM block.
2. **Public Result Tallying**:
   - Anyone can query `GET /results/{election_id}` or call the contract's `getResults()` method to inspect live candidate tallies and total votes cast.
   - Auditor verification: `Total Votes Cast == Number of Unique Spent Nullifiers == Number of Valid Merkle Leaves Used`.

---

## Summary Security Checklist for Project Report

| Security Requirement | Technical Mechanism | Verification Location |
| :--- | :--- | :--- |
| **Prevent Ineligible Voting** | Merkle Tree Root on-chain validation | `Election.sol` (`updateMerkleRoot`, `MerkleProof.verify`) |
| **Prevent Double Voting** | Nullifier tracking mapping | `Election.sol` (`spentNullifiers[leaf] = true`) |
| **Time Enforcement** | On-chain block timestamps | `Election.sol` (`block.timestamp >= startTime`) |
| **Voter Privacy** | Off-chain secret generation & zero PII on-chain | `voting-backend/app/main.py` & `Election.sol` |
| **Auditability** | EVM Transaction Hash Receipts & `getResults()` | Blockchain Ledger & FastAPI API |
