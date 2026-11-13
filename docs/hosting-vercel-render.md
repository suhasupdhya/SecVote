# Hosting SecVote on Vercel + Render + MongoDB Atlas

This guide hosts SecVote with:
- **Vercel** for the website,
- **Render** for the API, its worker and Redis,
- **MongoDB Atlas** for the database,
- **Resend** for email,
- **Base Sepolia**, a public test blockchain.

For a single server with Docker instead, see [hosting.md](hosting.md).

```
 voter's browser ──https──▶ Vercel (website)  ──/api/* rewrite──▶ Render: secvote-api ──┬─▶ MongoDB Atlas
        │                                                                                ├─▶ Render Key Value (Redis)
        │                                                          Render: secvote-worker ┘
        └──────────────▶ Base Sepolia RPC (reads the voter roll)         │ (sends transactions, deletes old ID cards)
                                                                         ▼
                                                                  Base Sepolia blockchain
```

The browser only ever talks to your Vercel address. Vercel forwards `/api/*` to Render, so sign-in cookies stay on your own site.

## What it costs (check each site; prices change)

| Service | Plan | About |
|---|---|---|
| Vercel | Hobby (free; personal, non-commercial). Pro if the institution runs it. | ₹0 |
| Render API | Starter: free instances sleep after 15 idle minutes and take ~1 minute to wake | $7/month |
| Render worker | Starter: background workers have no free plan | $7/month |
| Render Key Value | Free for testing; Starter for election periods (keeps sign-ins across restarts) | $0–10/month |
| MongoDB Atlas | M0 free (512 MB, **no backups**) for testing; Flex or M10 for real elections (backups) | $0–60/month |
| Resend | Free: 100 emails/day, 3,000/month. Pro for inviting a whole college. | $0–20/month |
| Domain (optional but recommended; needed for Resend) | e.g. `secvote-yourcollege.in` | ~₹800/year |
| Blockchain | Base Sepolia test coins are free | ₹0 |

**Pilot total:** about $14 a month (Render API and worker; everything else on free plans).

## Before you start

1. **Push the code to GitHub.** Keep the repository **private**: its old history contains test ID-card files and database dumps.
2. **Change every credential that was ever pasted into a chat:** the Gmail app password, the Resend key, and any database password. Treat them as public.
3. **Create accounts** at github.com, vercel.com, render.com, mongodb.com/atlas and resend.com. Sign in to Vercel and Render with GitHub so they can see the repository.
4. **Pick your names now, because each service needs the other's address:**
   - Vercel project `secvote-<college>` → `https://secvote-<college>.vercel.app`
   - Render service `secvote-api` → `https://secvote-api.onrender.com`. Render adds a suffix if the name is taken; you'll see the real address in step 5.

## Step 1: Two blockchain keys and test coins (your computer)

Foundry is already installed (`~\.foundry\bin`). In PowerShell, in the project folder, run this **twice**, once for each key:

```powershell
& "$HOME\.foundry\bin\cast.exe" wallet new
```

Each run prints an address and a private key. Save both in a password manager:

- **Deployer:** used once in step 2 to deploy the contracts. Afterwards keep it offline.
- **Relayer:** goes on Render. It pays the small fee for every ballot and admin action.

Never paste a private key into a chat, an email, GitHub or a screenshot.

Get free **Base Sepolia ETH** from a faucet: search "Base Sepolia faucet", for example the Coinbase Developer Platform or Alchemy faucets. Send about **0.05 to the deployer** and **0.05 to the relayer**. Each ballot costs a tiny fraction of that.

## Step 2: Deploy the contracts (your computer, once)

```powershell
$env:DEPLOYER_KEY = Read-Host "Deployer private key"
$env:RELAYER_ADDRESS = "0xYourRelayerAddress"
node scripts/deploy-contracts.mjs --rpc https://sepolia.base.org
Remove-Item Env:DEPLOYER_KEY
```

`Read-Host` keeps the key out of your PowerShell history. The script refuses to run against a local test chain. It prints the factory and Semaphore addresses and writes `packages/contracts/deployments/84532.json`.

**Commit and push that file:** Render builds from GitHub, and the API reads the contract addresses from it.

```powershell
git add packages/contracts/deployments/84532.json packages/shared
git commit -m "Deploy contracts to Base Sepolia"
git push
```

## Step 3: MongoDB Atlas

1. **Create a project** called `SecVote`.
2. **Create a cluster:**
   - Provider **AWS**, region **Singapore (ap-southeast-1)**, close to Render's Singapore region.
   - Tier: **M0** to try it out. Use **Flex or M10** for a real election: M0 has no backups.
   - ID-card photos are stored in the database, about 1–4 MB each, and deleted 30 days after the election. 512 MB holds roughly 150–400 of them.
3. **Database Access → Add user:**
   - username `secvote`, a long generated password, role **Read and write to any database**.
   - If the password has symbols such as `@ : / ? #`, URL-encode them in the connection string, or generate one with letters and numbers only.
4. **Network Access:**
   - Add Render's outbound IP addresses, shown on the Render service page under **Connect → Outbound** after step 5.
   - Until then, `0.0.0.0/0` (anywhere) works. The long password is then the only protection, so replace it with Render's addresses once you have them.
5. **Connect → Drivers:** copy the connection string, which looks like `mongodb+srv://secvote:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`, and put the password in.

## Step 4: Email (Resend)

Officials confirm every sign-in with an emailed code, and voters get verification codes, approvals and invitations. **Nobody can sign in until email works.**

1. In Resend, **Domains → Add domain**, for example `mail.yourdomain.in`. Add the DNS records it shows (SPF, DKIM) at your domain registrar, then wait for **Verified**.
2. **API Keys → Create**, with sending access only. Copy it once.
3. Your "from" address will be something like `SecVote <no-reply@mail.yourdomain.in>`.

**No domain yet?**
- Resend can only send to your own address until a domain is verified. That's enough to create the super admin and test, but voters won't get emails.
- A cheap domain is the simplest fix.
- **Not recommended:** Gmail SMTP. Set `SECVOTE_EMAIL_BACKEND=smtp` with `SECVOTE_SMTP_HOST=smtp.gmail.com`, `SECVOTE_SMTP_PORT=587`, your Gmail address and a **new** app password. Gmail allows about 500 emails a day, and Render blocks email ports on free instances (Starter works).

## Step 5: Render (API, worker, Redis)

The repository has a **Blueprint** (`render.yaml`) that creates everything.

1. In Render: **New → Blueprint**, then pick your GitHub repository. Render finds `render.yaml`.
2. Fill in the values it asks for:

| Variable | Value |
|---|---|
| `SECVOTE_MONGODB_URI` | the Atlas connection string from step 3 |
| `SECVOTE_ALLOWED_EMAIL_DOMAINS` | who may sign up, as a JSON list: `["yourcollege.edu.in"]`. If students use personal mail, `["gmail.com"]`: anyone with that address can create an account, but only people on the voter register or approved by an official can vote. |
| `SECVOTE_WEB_URL` | your Vercel address, e.g. `https://secvote-<college>.vercel.app` (no trailing slash) |
| `SECVOTE_CORS_ORIGINS` | the same, as a JSON list: `["https://secvote-<college>.vercel.app"]` |
| `SECVOTE_EMAIL_FROM` | `SecVote <no-reply@mail.yourdomain.in>` |
| `SECVOTE_RESEND_API_KEY` | from step 4 |
| `SECVOTE_RELAYER_PRIVATE_KEY` | the **relayer** private key from step 1 (not the deployer) |

3. **Apply.** Render builds the Docker image, which takes about 5 minutes the first time, and starts:
   - `secvote-api` (web service),
   - `secvote-worker` (background worker),
   - `secvote-redis` (Key Value).
4. Open the API service. Its address is at the top, e.g. `https://secvote-api.onrender.com`. Check it in a browser:
   - `…/healthz` should show `{"ok":true}`.
   - `…/readyz` shows MongoDB, chain and relayer balance. All should be `ok`.
5. **If the API won't start, open its Logs.** Production refuses unsafe settings and lists exactly what is wrong. For example, `SECVOTE_WEB_URL must be https` or `No deployment for chain 84532` (you didn't push step 2's file).
6. Copy the service's **outbound IP addresses** (Connect → Outbound) into Atlas Network Access, and remove `0.0.0.0/0`.

**Without the Blueprint** (if Render rejects it), create the same things by hand:
- **Key Value:** Singapore, `noeviction` policy.
- **Web Service:**
  - runtime **Docker**, Dockerfile path `./apps/api/Dockerfile`, build context `.`,
  - health check `/healthz`, env `PORT=8000`.
- **Background Worker:** same Dockerfile and context, Docker command `uv run --no-sync secvote-worker`.
- **Env group:** every variable listed in `render.yaml`, linked to both services. Set `SECVOTE_REDIS_URL` to the Key Value's *internal* URL.
- `SECVOTE_SESSION_SECRET` and `SECVOTE_OTP_PEPPER` must each be a different random value of 32+ characters. Generate them with `python -c "import secrets; print(secrets.token_hex(32))"`.

**Keep exactly one worker instance, always.** It holds the relayer key and sends transactions in order.

## Step 6: Vercel (website)

1. **Add New → Project**, then import the repository.
2. **Root Directory:** `apps/web`. Leave "Include files outside the root directory" on: the app uses `packages/shared`.
3. **Framework:** Next.js, detected automatically. The build command comes from `apps/web/vercel.json` (`pnpm build:hosted`). It downloads the zero-knowledge proving files, so voters' browsers fetch them from your site.
4. **Environment Variables**, for Production:

| Variable | Value |
|---|---|
| `SECVOTE_API_URL` | your Render API address, e.g. `https://secvote-api.onrender.com` |
| `NEXT_PUBLIC_RPC_URL` | `https://sepolia.base.org` |
| `NEXT_PUBLIC_CHAIN_ID` | `84532` |
| `NEXT_PUBLIC_SNARK_ARTIFACTS_URL` | `/snark-artifacts` |
| `SNARK_MAX_DEPTH` | `16` (up to 65,536 voters per election; about 75 MB of files) |
| `NEXT_PUBLIC_INSTITUTION_NAME` | e.g. `ABC College of Engineering` (shown on the privacy notice) |
| `NEXT_PUBLIC_PRIVACY_CONTACT` | an email for data questions and complaints |

5. **Settings → General → Node.js Version:** 22.x.
6. **Deploy.** Open `https://secvote-<college>.vercel.app`; the landing page should load.

These values are **baked in when Vercel builds**. After changing any of them, use Deployments → ⋯ → **Redeploy**.

## Step 7: Connect the two

If the real Vercel address differs from what you entered in step 5, update `SECVOTE_WEB_URL` and `SECVOTE_CORS_ORIGINS` in Render's `secvote` environment group. Render restarts both services.

**Custom domain** (optional), e.g. `vote.yourcollege.in`:
1. Vercel → Settings → Domains → add it and set the DNS record Vercel shows.
2. Change `SECVOTE_WEB_URL` and `SECVOTE_CORS_ORIGINS` on Render to the new address.

## Step 8: Create the super admin

On Render, open **secvote-api → Shell** and run:

```bash
uv run --no-sync secvote-bootstrap-admin --email you@yourcollege.edu.in --name "Your Name"
```

It asks for a password of 12+ characters; it isn't shown or saved in history. The first admin becomes the **super admin**.

Sign in on the website. A 6-digit code arrives by email: that confirms email works.

Then add a **second super admin** under Officials, with their own email, so one lost mailbox can't lock you out.

## Step 9: A test election before the real one

With 3–5 friends:

1. Admin: upload the **Voter register** (Excel), create an election, send invitations.
2. Voters: sign up, register with an ID card, get approved, create their voting identity, and **save the backup card**.
3. Open voting. Everyone votes from their phones, including on mobile data and on college Wi-Fi.
4. Close voting, declare the result, and check the **Verify** page.
5. Check `https://secvote-api.onrender.com/readyz` afterwards: the relayer balance should barely have moved.

Also try: forgotten passphrase (identity reset), a rejection followed by re-applying, and a second device.

## Running it: election-day checklist

- [ ] Render Key Value on **Starter** for the election period (sign-ins survive restarts).
- [ ] Atlas on a plan **with backups** (Flex or M10), and a backup taken before voting opens.
- [ ] Relayer balance checked at `/readyz`; topped up if it says `low`.
- [ ] Don't deploy new code while voting is open. Every push to `main` redeploys Render and Vercel. Turn off auto-deploy, or deploy only between elections.
- [ ] One worker instance only (Render → secvote-worker → Scaling).
- [ ] Resend plan big enough for invitations: free is 100 emails a day.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| API log: `Unsafe production settings: …` | It lists each problem; fix those env vars on Render. |
| API log: `No deployment for chain 84532` | Push `packages/contracts/deployments/84532.json` (step 2), then redeploy. |
| API log: MongoDB timeout / `ServerSelectionTimeoutError` | Atlas Network Access doesn't include Render's outbound IPs, or the password in the URI isn't URL-encoded. |
| Website loads, but sign-in fails with a network error | `SECVOTE_API_URL` on Vercel is wrong, or you didn't redeploy after setting it. |
| Sign-in rejected / CORS errors in the browser console | `SECVOTE_CORS_ORIGINS` / `SECVOTE_WEB_URL` on Render don't exactly match the Vercel address (https, no trailing slash). |
| No emails arrive | Resend domain not verified, wrong `SECVOTE_EMAIL_FROM` domain, or the daily limit was reached. See Render logs for the error. |
| Voting is stuck on "sending" | Check `/readyz`: the relayer is out of test ETH, or the worker isn't running (Render → secvote-worker → Logs). |
| Vercel build fails on install | Settings → Environment Variables: add `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the repo's pnpm version (10.7). |
| First request after a while takes ~1 minute | The API is on Render's free plan and went to sleep; use Starter. |

## Moving to a real (main) network later

Real elections on Base or Polygon mainnet cost real (small) fees per ballot:
1. Repeat steps 1–2 with new keys and real funds: `--rpc` pointing at the mainnet RPC.
2. Change `SECVOTE_RPC_URL` and `SECVOTE_CHAIN_ID` on Render, and `NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_CHAIN_ID` on Vercel.
3. Use an RPC provider account (Alchemy, Infura, QuickNode) with a server key for Render and a browser key restricted to your domain for Vercel.
