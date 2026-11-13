# ADR 0001: Semaphore v4 for anonymous eligibility

**Status:** accepted · 2026-11-12

## Context
v1 used a plain Merkle proof whose leaf identified the voter, and the server held every voter's secret. Linking a ballot to a person required nothing more than a database read.

## Decision
- Use **Semaphore v4** (audited circuits and contracts, browser libraries). We will not write our own circuit.
- Each election is one Semaphore group, and the `Election` clone is the group admin.
- The voter's browser generates the identity. Only the commitment is sent to the server.
- Proofs use `scope = keccak(chainId, electionAddress)` and `message = keccak(ballot)`.
- `Election` checks `merkleTreeRoot == frozenRoot`. Semaphore on its own also accepts superseded roots for one hour, which would let a member removed or added late slip through.
- **`Election` keeps its own nullifier set and calls `Semaphore.verifyProof` (view), not `validateProof`.** `validateProof` is permissionless. Anyone who copies a proof from the mempool could call it directly against the group, mark the nullifier as used in Semaphore, and block the voter's real `castBallot`. Storing nullifiers in `Election` makes that a no-op. `test_Real_FrontRunValidateProofCannotGriefVoter` covers it.

## Consequences
- Each ballot costs one Groth16 verification (~250–300k gas).
- Circuit artifacts are downloaded on first proof (cached by the browser).
- We cannot send "you haven't voted" reminders, by design.
