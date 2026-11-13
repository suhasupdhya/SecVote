# SecVote v2

Anonymous, verifiable elections for colleges and organisations, delivered as a web application.

- **The server can't see who you voted for.** Your browser creates a secret identity and proves you're on the roll with a zero-knowledge proof (Semaphore v4).
- **One person, one vote.** A per-election nullifier on-chain rejects any second ballot.
- **Anyone can check the count.** Every ballot is public on the bulletin board, and the declared result hash can be recomputed by anyone.

The stack is Next.js 16 + FastAPI (Beanie on PyMongo Async) + MongoDB + Solidity (Foundry/Anvil).

## Layout

```
apps/web/             Next.js 16 web app: voter, admin, bulletin, tracker; browser crypto in src/lib/crypto
apps/api/             FastAPI API + worker (same codebase): auth, elections, registrations, anonymous relay,
                      tx outbox, event indexer
packages/contracts/   Foundry: Election (clone) + ElectionFactory on Semaphore v4; unit/fuzz/invariant/real-proof tests
packages/shared/      Generated ABIs, ballot codecs, ECIES, Shamir, tally (plurality + IRV), verifyElection()
packages/verifier/    Standalone recount CLI: RPC URL + contract address in, MATCH / NO MATCH out
docs/                 threat-model.md, ballot-format.md, adr/
scripts/stack.mjs     Boots everything locally (no Docker)
```

The v1 code is preserved on the `v1-archive` branch and the `v1-final` tag.

## Prerequisites
- Node 22+, pnpm 10, Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- [Foundry](https://book.getfoundry.sh/) (`forge`, `anvil`, `cast`) on PATH or in `~/.foundry/bin`
- MongoDB at `mongodb://127.0.0.1:27017`, or set `SECVOTE_MONGODB_URI` (Atlas works)
- Redis is optional. Without `SECVOTE_REDIS_URL`, dev mode uses in-process fakeredis.

## Run it

```bash
pnpm install
```

```bash
cd apps/api && uv sync && cd ../..
```

```bash
pnpm dev
```

`pnpm dev` does the following:
- starts a fresh Anvil chain
- deploys Semaphore and the factory
- regenerates the ABIs
- creates a one-time admin and prints its credentials
- starts the API (:8000), the worker and the web app (:3000)

With the console email backend, OTP codes are written to `.e2e/mailbox.jsonl`.

## Test

| What | Command |
|---|---|
| Contracts (unit, fuzz, invariants, real Groth16 proofs via FFI) | `pnpm contracts:test` |
| API (auth/OTP/CSRF, registration flow, role × endpoint matrix) | `pnpm api:test` |
| API against a real chain (outbox, indexer, crash recovery, relay) | `pnpm api:test:chain` |
| Browser crypto (ballot codec, identity backup, cross-language vector) | `pnpm web:test` |
| Shared crypto + tally (TS), incl. cross-language vectors | `pnpm --filter @secvote/shared test` |
| **MVP + Phase 4 gates**: open and sealed elections through the UI on Anvil (Playwright) | `pnpm e2e` |

### Verify any election yourself
```bash
pnpm --filter @secvote/verifier verify --rpc http://127.0.0.1:8545 --election 0xYourElectionAddress
```
It needs only an RPC URL and the contract address. It decrypts and recounts every ballot and prints MATCH or NO MATCH against the declared result.

## Roadmap status
- [x] Phase 0: foundation (monorepo, docs, CI)
- [x] Phase 1: accounts and elections (Argon2id, email OTP, cookie sessions + CSRF, two-person approval)
- [x] Phase 2: contracts (phases, freeze, castBallot, pause; every v1 attack is a Foundry test)
- [x] Phase 3: voting end to end (browser identity + backup, relayer outbox, indexer, bulletin, tracker, turnout)
- [x] Phase 4: sealed ballots (ECIES), 2-of-3 trustee key ceremony, key reveal + off-chain tally, ranked-choice (IRV), verify page + standalone verifier CLI
- [ ] Phase 5: passkey identity, Safe multisig officers, audit anchoring, OCR pre-check, Tamil UI
- [x] Phase 6 (partly): Docker/hosting setup, strict CSP, self-hosted proving files, production safety checks. Still to do: a real network deployment and a load test

**Hosting:** [docs/hosting-vercel-render.md](docs/hosting-vercel-render.md) (Vercel + Render + MongoDB Atlas, step by step), or [docs/hosting.md](docs/hosting.md) (one server with Docker Compose + Caddy).

See [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md).
