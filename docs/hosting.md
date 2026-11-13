# Hosting SecVote

This guide puts SecVote on one Linux server with Docker. For Vercel + Render + MongoDB Atlas instead, see [hosting-vercel-render.md](hosting-vercel-render.md). Budget about 2 vCPUs, 4 GB RAM and 40 GB of disk.

```
 voters ──https──▶ Caddy (TLS) ──▶ web (Next.js) ──/api──▶ API ─┐
                                       │                         ├─▶ MongoDB Atlas
 voters' browsers ─────────────────────┼──▶ blockchain RPC       │   Redis (on the server)
                                       │          ▲              │
                                       └──────────┼── worker ────┘   (one worker: relayer key + nonce)
                                                  └── email provider
```

## 1. Decide and sign up (once)

| What | Recommendation |
|---|---|
| **Blockchain** | Pilot: a public test network, e.g. **Base Sepolia** (chain id 84532) or Polygon Amoy (80002). Free test coins; anyone can inspect the contracts. Real elections: a low-fee public network (Base or Polygon). Never expose a local Anvil chain to the internet. |
| **RPC provider** | The network's public RPC works for a pilot. For real elections use a provider (Alchemy, Infura, QuickNode…) with **two keys**: a server key, and a browser key restricted to your domain. |
| **Database** | MongoDB Atlas, a **new** cluster/database for production, with backups on. Don't reuse the development database. |
| **Email** | A transactional provider (Resend is built in, or SMTP from your institution or Amazon SES). Add the provider's SPF and DKIM DNS records for your sending domain. Personal Gmail is limited to about 500 emails a day. |
| **Domain** | e.g. `vote.yourcollege.edu.in`, with a DNS A record pointing at the server. |

## 2. Keys

Create **two fresh Ethereum keys** (for example `cast wallet new`):

- **Deployer key**: used once in step 3. Fund it with enough for the deployment (test coins from a faucet on a test network). Afterwards keep it offline: it is the factory admin.
- **Relayer key**: lives on the server (`SECVOTE_RELAYER_PRIVATE_KEY`). It pays the fee for every ballot and admin action, so keep a **small** balance and top it up. `/readyz` reports `relayer_balance: low` below `SECVOTE_RELAYER_MIN_BALANCE_WEI`.

Never reuse a key that has been pasted into a chat, an email or a repository.

## 3. Deploy the contracts (from your computer, once per network)

```bash
DEPLOYER_KEY=0x... RELAYER_ADDRESS=0x... node scripts/deploy-contracts.mjs --rpc https://sepolia.base.org
```

This needs Foundry. It writes `packages/contracts/deployments/<chainId>.json` (commit it) and `packages/shared/deployments.json` (copy it to the server in step 4).

## 4. Configure the server

On a fresh Ubuntu server with Docker installed:

```bash
git clone <your repository> secvote && cd secvote/deploy
cp .env.example .env          # domain, browser RPC, chain id
cp api.env.example api.env    # database, secrets, email, relayer key, ...
```

Then copy `packages/shared/deployments.json` from step 3 into the same path on the server.

The API and the worker **refuse to start** in production if anything unsafe is left. For example:
- the default secrets,
- insecure cookies,
- the console email backend,
- no Redis,
- an `http://` site address.

## 5. Start

```bash
docker compose up -d --build
docker compose exec api uv run --no-sync secvote-bootstrap-admin --email you@yourcollege.edu.in --name "Your Name"
```

The second command creates the first **super admin**. Use an email address you can read: officials confirm every sign-in with an emailed code. Then:

- Open `https://<your domain>`.
- Sign in with that account.
- Upload the **Voter register** and create an election.

Building the web image downloads the zero-knowledge proving files (`SNARK_MAX_DEPTH`), so voters' browsers fetch them from your site rather than a third party.

## 6. Run it safely

- **Monitoring:** `/readyz` isn't exposed publicly; check it on the server with `docker compose exec api python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/readyz').read().decode())"`. It reports MongoDB, the chain and the relayer balance. Run it daily during an election, or from a cron job that emails you on failure.
- **Exactly one worker.** Never scale the `worker` service: it owns the relayer key's transaction order.
- **Backups:**
  - Atlas does the database.
  - Back up the `uploads` volume (ID cards; deleted automatically 30 days after each election).
  - Back up `deploy/api.env` somewhere safe.
- **Updates:** `git pull && docker compose up -d --build`. Changing the contracts needs a new deployment (step 3) and only affects elections created afterwards.
- **Privacy:**
  - Keep Caddy without an access log, as shipped.
  - Keep the `header_up X-SecVote-Client` line in the Caddyfile. Without it every voter shares one ballot rate limit, because all requests arrive from the web container.
  - Don't add request logging anywhere in front of `/api/v1/ballots`: IP addresses next to ballot times could link voters to ballots.
- **A second super admin** with their own real email, so one lost mailbox can't lock you out.

## 7. Before the first real election

- Run a full **test election** on the test network with a few people. They should cover:
  - register,
  - approve,
  - create the identity,
  - vote,
  - declare the result,
  - verify the count (`pnpm --filter @secvote/verifier verify --rpc <RPC> --election <address>`).
- Fill in the privacy notice (`/privacy`): set `NEXT_PUBLIC_INSTITUTION_NAME` and `NEXT_PUBLIC_PRIVACY_CONTACT` (the grievance contact) in `deploy/.env`, then rebuild.
- **Rotate every credential that was ever pasted into a chat or committed:** Gmail app passwords, Resend keys, database passwords.
- **Old git history** of this repository contains test ID-card files and database dumps. Keep the repository private, or rewrite its history before making it public.
- Allow only your institution's email domain in `SECVOTE_ALLOWED_EMAIL_DOMAINS`.
