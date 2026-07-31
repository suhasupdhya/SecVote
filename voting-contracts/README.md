# Blockchain E-Voting Platform — Smart Contracts

## Setup
```
npm install
```

## Verify contracts compile (no network access needed — uses npm solc)
```
node compile.js
```

## Run the full end-to-end test
Deploys the factory, creates a "COLLEGE" election, builds a Merkle tree of
eligible voters off-chain, casts valid votes, and proves double-voting and
fake-voter attempts are rejected on-chain.
```
node test/fullFlow.js
```

## Files
- `contracts/Election.sol` — single election instance: eligibility check via
  Merkle proof, one-time nullifier (prevents double voting), time-boxed
  voting window, public tallying.
- `contracts/ElectionFactory.sol` — deploys/tracks many Election instances so
  the same platform can run govt elections and college elections concurrently.
- `test/fullFlow.js` — end-to-end proof of the anti-fraud guarantees.
- `compile.js` — standalone compile script (works without hitting
  binaries.soliditylang.org, useful in restricted-network environments).

## Next steps (not yet built)
- Backend (Node/Express or FastAPI) that:
  - runs the Identity Adapter (Aadhaar OTP / college email verification)
  - generates and privately delivers voter secrets
  - builds the Merkle tree and relays `castVote` transactions on the voter's
    behalf (protects secrets from mempool front-running)
- React frontend for voters and an admin dashboard for election creation.
