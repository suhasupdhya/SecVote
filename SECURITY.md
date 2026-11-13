# Security

SecVote v2 is built for **institutional elections**: student councils, clubs and associations. It is not for government or public elections. The government/Aadhaar adapter is a mock only, and SecVote never stores Aadhaar numbers.

- The threat model, trust assumptions and STRIDE table are in [docs/threat-model.md](docs/threat-model.md).
- The ballot encoding and proof binding are specified in [docs/ballot-format.md](docs/ballot-format.md).
- Why we use Semaphore, and why `Election` keeps its own nullifiers, is in [docs/adr/0001-semaphore.md](docs/adr/0001-semaphore.md).

## What the system guarantees
- **Ballot secrecy from operators.** The voter's identity secret is created in the browser and never sent anywhere. Ballots carry a zero-knowledge proof of roll membership, so nothing on the server or the chain links a ballot to a person.
- **One vote per voter.** Each voter has a per-election nullifier, stored on-chain, and the contract rejects a second use.
- **Fixed roll.** Members can only be added during registration. `freeze()` locks the root, and ballots must prove membership in exactly that root.
- **Phases enforced on-chain.** Registration, voting and pause are enforced by the contract, not by the backend.
- **Public verifiability.** Every ballot is a public `BallotCast` event. The declared result hash can be recomputed by anyone.

## Known limitations
These are stated openly in the threat model:
- Officials still decide eligibility.
- Vote selling is possible.
- The relay sees network metadata. The self-submit escape hatch avoids the relay.
- Malware on the voter's device can change a ballot before it is proven.

## Operational rules
- No seeded accounts. Create the first admin with `uv run secvote-bootstrap-admin`.
- Secrets live only in untracked `.env` files. See `.env.example`, and `gitleaks` runs as a pre-commit hook.
- The relayer key should hold only a small balance.
- SecVote never redeploys contracts on its own. If the chain is unreachable or empty, the API and worker refuse to start.

## Reporting a vulnerability
Please report issues privately to the project maintainers rather than opening a public issue. Include steps to reproduce and the commit hash.
