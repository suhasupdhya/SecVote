# SecVote

Secure, anonymous and verifiable online elections for schools, colleges and institutions.

- **Secret ballot.** Your browser creates a private voting identity and proves you're on the voter roll with a zero-knowledge proof (Semaphore v4). Nobody can link a ballot to a voter: not the election office, and not the people running the server.
- **One person, one vote.** A per-election nullifier, checked on the blockchain, rejects any second ballot from the same identity.
- **Anyone can recount.** Every ballot is public on a blockchain bulletin board. The declared result can be recomputed by anyone, on the website or with a standalone command-line tool.

Built with Next.js 16, FastAPI, MongoDB, Semaphore v4 and Solidity (Foundry).

## Features

**For voters**
- Sign up with an institution email, verified by a one-time code.
- Register for an election with a register number and an ID card. Someone rejected can re-apply **once**.
- Create a voting identity in the browser, protected by a passphrase. It's saved as an encrypted **backup card** (image).
- Vote, get a receipt, and track the ballot on the public bulletin board.
- Forgot the passphrase? Request an identity reset, which an official approves before voting starts.
- From My account: change your password or delete your account.

**For the election office**
- **Roles:**
  - **Super admin:** the only role that can appoint or remove admins. When there are two or more super admins, a new admin also needs a second super admin's approval.
  - **Election admin:** runs elections and approves voters.
  - **Election officer**, **trustee** and **observer**.
- **Voter register:** upload the eligible people once from Excel, then pick departments and years for each election. People on the register are approved automatically.
- **Invitations:** email everyone on an election's register to sign up and register.
- **Duplicate checks:** one account per inbox (Gmail dots and `+tags` count as one), one registration per register number, and one voting identity per voter.
- **Open or sealed ballots:**
  - Sealed ballots are encrypted until voting closes, with a 2-of-3 trustee key ceremony.
  - Plurality or ranked-choice (IRV).
- **Results:** download and print, plus an audit log of every official action.
- Officials confirm every sign-in with an emailed code.

**Privacy**
- No Aadhaar or government ID numbers are stored.
- ID-card photos are deleted 30 days after the election.
- No access logs or trackers.
- A [privacy notice](apps/web/src/components/privacy-notice.tsx) is shown at `/privacy`.

## How it works

```
 browser (voter)                         API + worker                        blockchain
 ───────────────                         ────────────                        ──────────
 create identity ── commitment ────────▶ official approves ── add member ──▶ Election contract (voter roll)
 build ZK proof  ── anonymous ballot ──▶ relay (no account) ── castBallot ──▶ proof + nullifier checked
 verify page     ◀──────────────────────────── reads everything ────────────── public ballots and result
```

The API never receives the voter's identity with a ballot. The relayer only pays the transaction fee.

## Project layout

```
apps/web/             Next.js web app: voter, admin, bulletin board, tracker. Browser crypto in src/lib/crypto
apps/api/             FastAPI API + background worker (same code): accounts, elections, registrations,
                      anonymous ballot relay, transaction outbox, blockchain indexer, retention jobs
packages/contracts/   Solidity (Foundry): Election + ElectionFactory on Semaphore v4, with unit/fuzz/invariant tests
packages/shared/      Generated ABIs, ballot codecs, encryption, Shamir sharing, tally (plurality + IRV)
packages/verifier/    Stand-alone recount tool: RPC URL + contract address in, MATCH / NO MATCH out
deploy/               Docker Compose + Caddy for a single server
render.yaml           Render Blueprint (API, worker, Redis)
scripts/              stack.mjs (local stack), deploy-contracts.mjs, fetch-snark-artifacts.mjs
docs/                 Hosting guides, threat model, ballot format, design decisions (adr/)
```

## Run it on your computer

**You need:**
- Node 22+ and pnpm 10,
- Python 3.12+ with [uv](https://docs.astral.sh/uv/),
- [Foundry](https://book.getfoundry.sh/) (`forge`, `anvil`, `cast`), on PATH or in `~/.foundry/bin`,
- MongoDB: local at `mongodb://127.0.0.1:27017`, or Atlas via `SECVOTE_MONGODB_URI`.

Redis is optional locally: without `SECVOTE_REDIS_URL`, an in-memory stand-in is used.

```bash
pnpm install
```

```bash
cd apps/api && uv sync && cd ../..
```

```bash
pnpm dev
```

`pnpm dev`:
- starts a local test blockchain (Anvil) and deploys the contracts,
- creates a first admin and prints its email and password,
- starts the API (port 8000), the worker and the website at http://localhost:3000.

Emails (sign-in codes) are written to `.e2e/mailbox.jsonl` instead of being sent. `pnpm dev:reset` starts from a clean state.

Settings go in `apps/api/.env`; copy [.env.example](.env.example). Never commit real values.

## Tests

| What | Command |
|---|---|
| Contracts (unit, fuzz, invariants, real Groth16 proofs) | `pnpm contracts:test` |
| API (auth, codes, CSRF, registrations, roles, production checks, file storage) | `pnpm api:test` |
| API against a real local chain (outbox, indexer, crash recovery, relay) | `pnpm api:test:chain` |
| Browser crypto (ballot codec, identity backup, cross-language vectors) | `pnpm web:test` |
| Shared crypto and tally | `pnpm --filter @secvote/shared test` |
| Full elections through the website (Playwright: open and sealed) | `pnpm e2e` |

`SECVOTE_PROD_WEB=1 pnpm e2e` runs the browser tests against a production build. It checks that the security headers don't block voting and that proof files are served by the site itself.

## Verify any election yourself

```bash
pnpm --filter @secvote/verifier verify --rpc <RPC URL> --election 0xElectionContractAddress
```

It needs only a blockchain RPC URL and the election's contract address. It decrypts sealed ballots, recounts every ballot, and prints MATCH or NO MATCH against the declared result.

## Hosting

| Setup | Guide |
|---|---|
| Vercel (website) + Render (API, worker, Redis) + MongoDB Atlas | [docs/hosting-vercel-render.md](docs/hosting-vercel-render.md) |
| One Linux server with Docker Compose + Caddy (automatic HTTPS) | [docs/hosting.md](docs/hosting.md) |

Both start on a free public **test** blockchain (e.g. Sepolia). Contracts are deployed once from your computer:

```bash
node scripts/deploy-contracts.mjs --rpc <RPC URL>
```

It needs `DEPLOYER_KEY` and `RELAYER_ADDRESS`; see the guide. In production (`SECVOTE_ENV=prod`) the API and worker **refuse to start** with unsafe settings and list what to fix. Examples: default secrets, insecure cookies, the console email backend, no Redis, or a non-https address.

## Security

- [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md) cover what SecVote protects against and what it doesn't.
- Keys and passwords live only in uncommitted `.env` files or the hosting provider's settings. Never in the repository or a chat.
- The relayer key pays transaction fees: keep only a small balance on it. `/readyz` warns when it runs low.

## Roadmap

- [x] Foundation: monorepo, docs, CI
- [x] Accounts and elections: Argon2id passwords, email codes, cookie sessions + CSRF, role approvals
- [x] Contracts: phases, freeze, ballots, pause, identity replacement; every v1 attack is a Foundry test
- [x] Voting end to end: browser identity + backup card, relayer outbox, indexer, bulletin board, tracker, turnout
- [x] Sealed ballots, 2-of-3 trustee key ceremony, ranked choice, verify page + verifier tool
- [x] Super admin roles, voter register (Excel), invitations, duplicate checks, one re-apply, identity reset
- [x] Hosting: Docker / Render / Vercel setups, strict CSP, self-hosted proof files, production safety checks, privacy notice
- [ ] Live test-network deployment and a load test
- [ ] Passkey identity, multisig officers, audit anchoring, ID-card pre-check, Tamil UI
