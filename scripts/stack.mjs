#!/usr/bin/env node
// Boots the whole local stack without Docker:
//   anvil -> forge deploy -> gen-abis -> bootstrap admin -> API -> worker -> Next.js
//
//   node scripts/stack.mjs            # dev  (ports 8545 / 8000 / 3000, db "secvote")
//   node scripts/stack.mjs --reset    # dev, but start from an empty chain
//   node scripts/stack.mjs --e2e      # e2e  (ports 8645 / 8100 / 3100, chain 31338, fresh db + chain)
//
// Dev keeps the local chain between restarts (.e2e/anvil-state.json), redeploys contracts only when their
// code changed, and auto-reloads the API and worker on Python changes (Next reloads itself).
//
// Needs: MongoDB reachable at SECVOTE_MONGODB_URI (default mongodb://127.0.0.1:27017),
// Foundry (anvil, forge) on PATH or in ~/.foundry/bin, uv, pnpm, node.
// It never redeploys over an existing chain: it starts a fresh Anvil and a fresh deployment together.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomBytes } from "node:crypto"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const E2E = process.argv.includes("--e2e")
const RESET = process.argv.includes("--reset")
const CHAIN_ID = Number(process.env.SECVOTE_STACK_CHAIN_ID ?? (E2E ? 31338 : 31337)) // separate deployment files, so an e2e run never clobbers the dev chain
const OFFSET = Number(process.env.SECVOTE_STACK_PORT_OFFSET ?? 0) // run a second stack side by side
const BASE = E2E ? { rpc: 8645, api: 8100, web: 3100 } : { rpc: 8545, api: 8000, web: 3000 }
const PORTS = { rpc: BASE.rpc + OFFSET, api: BASE.api + OFFSET, web: BASE.web + OFFSET }
const STATE = process.env.SECVOTE_STACK_STATE ?? join(ROOT, ".e2e")
const isWin = process.platform === "win32"
const PATH = [join(homedir(), ".foundry", "bin"), process.env.PATH].join(delimiter)
const children = []

// Windows env keys are case-insensitive ("Path"); normalise so children see exactly one PATH.
function envWith(extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== "PATH") env[k] = v
  return { ...env, PATH, ...extra }
}
const needsShell = (cmd) => isWin && cmd === "pnpm" // pnpm is a .cmd shim; everything else is a real .exe

const log = (...a) => console.log("[stack]", ...a)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: needsShell(cmd), ...opts, env: envWith(opts.env) })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

function start(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: needsShell(cmd), env: envWith(opts.env), cwd: opts.cwd })
  const prefix = (line) => line && console.log(`[${name}] ${line}`)
  p.stdout.on("data", (d) => String(d).split(/\r?\n/).forEach(prefix))
  p.stderr.on("data", (d) => String(d).split(/\r?\n/).forEach(prefix))
  p.on("exit", (code) => {
    log(`${name} exited (${code})`)
    if (!shuttingDown) shutdown(1)
  })
  children.push(p)
  return p
}

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of children) {
    if (p.exitCode !== null) continue
    if (isWin) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" })
    else p.kill("SIGTERM")
  }
  process.exit(code)
}
process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))
process.on("exit", () => shutdown(0))

async function waitFor(url, init, label, timeoutMs = 120_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, init)
      if (r.ok) return
    } catch { }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${label} (${url})`)
}

async function main() {
  mkdirSync(STATE, { recursive: true })
  const rpc = `http://127.0.0.1:${PORTS.rpc}`
  const anvilCfg = join(STATE, `anvil-${PORTS.rpc}.json`)
  rmSync(anvilCfg, { force: true })

  const anvilArgs = ["--port", String(PORTS.rpc), "--chain-id", String(CHAIN_ID), "--silent", "--config-out", anvilCfg]
  const chainState = join(STATE, "anvil-state.json")
  if (!E2E) {
    if (RESET) rmSync(chainState, { force: true })
    // Persist the chain so elections survive restarts. Saved every few seconds (Windows kills are abrupt).
    anvilArgs.push("--state", chainState, "--state-interval", "3")
  }
  log(`starting anvil on ${rpc}${!E2E && existsSync(chainState) ? " (restoring saved chain)" : ""}`)
  const anvil = start("anvil", "anvil", anvilArgs)
  await waitFor(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }, "anvil")
  // anvil can answer RPC a moment before it writes --config-out (e.g. while restoring a large saved chain).
  for (let i = 0; i < 60 && !existsSync(anvilCfg); i++) {
    if (anvil.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!existsSync(anvilCfg))
    throw new Error(
      anvil.exitCode !== null
        ? `anvil exited (${anvil.exitCode}). Is another chain already running on port ${PORTS.rpc}? Stop it and try again.`
        : `anvil did not write ${anvilCfg}`,
    )
  const { private_keys: keys } = JSON.parse(readFileSync(anvilCfg, "utf8"))
  const [deployerKey, relayerKey] = keys
  const relayer = run("cast", ["wallet", "address", "--private-key", relayerKey]).trim()

  const contracts = join(ROOT, "packages", "contracts")
  run("forge", ["build"], { cwd: contracts })
  const bytecode = (name) => JSON.parse(readFileSync(join(contracts, "out", `${name}.sol`, `${name}.json`), "utf8")).deployedBytecode.object
  const codeHash = createHash("sha256").update(bytecode("Election") + bytecode("ElectionFactory")).digest("hex")
  const depFile = join(contracts, "deployments", `${CHAIN_ID}.json`)
  const markFile = join(STATE, `chain-${CHAIN_ID}.json`)
  const getCode = async (addr) => {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [addr, "latest"] }) })
    return ((await r.json()).result ?? "0x").length > 2
  }
  const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : null
  const mark = existsSync(markFile) ? JSON.parse(readFileSync(markFile, "utf8")) : null
  const reusable = !E2E && dep && mark?.codeHash === codeHash && mark?.factory === dep.electionFactory && (await getCode(dep.electionFactory))
  if (reusable) {
    log("contracts unchanged: reusing the deployment on the saved chain")
  } else {
    log(dep && !E2E ? "contracts changed or chain is new: deploying" : "deploying contracts")
    // Keep the existing Semaphore (and its groups) when the chain still has it.
    const semaphore = !E2E && dep && (await getCode(dep.semaphore)) ? { SEMAPHORE_ADDRESS: dep.semaphore } : {}
    run("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--private-key", deployerKey], {
      cwd: contracts,
      env: { RELAYER_ADDRESS: relayer, ...semaphore },
    })
    const fresh = JSON.parse(readFileSync(depFile, "utf8"))
    writeFileSync(markFile, JSON.stringify({ codeHash, factory: fresh.electionFactory }, null, 2))
  }
  run("node", ["scripts/gen-abis.mjs"], { cwd: contracts })

  // Dev keeps one database alongside the saved chain; e2e always starts clean.
  const db = process.env.SECVOTE_MONGODB_DB ?? (E2E ? `secvote_e2e_${Date.now()}` : "secvote_dev")
  const mailbox = join(STATE, E2E ? "mailbox-e2e.jsonl" : "mailbox.jsonl")
  rmSync(mailbox, { force: true })
  const apiEnv = {
    SECVOTE_ENV: "dev",
    SECVOTE_MONGODB_URI: process.env.SECVOTE_MONGODB_URI ?? "mongodb://127.0.0.1:27017",
    SECVOTE_MONGODB_DB: db,
    SECVOTE_RPC_URL: rpc,
    SECVOTE_CHAIN_ID: String(CHAIN_ID),
    SECVOTE_RELOAD: E2E ? "false" : "true",
    SECVOTE_RELAYER_PRIVATE_KEY: relayerKey,
    SECVOTE_API_PORT: String(PORTS.api),
    SECVOTE_MAILBOX_FILE: mailbox,
    SECVOTE_EMAIL_BACKEND: "console",
    SECVOTE_REDIS_URL: process.env.SECVOTE_REDIS_URL ?? "",
    SECVOTE_SESSION_SECRET: randomBytes(32).toString("hex"),
    SECVOTE_OTP_PEPPER: randomBytes(32).toString("hex"),
    SECVOTE_ALLOWED_EMAIL_DOMAINS: '["example.edu.in"]',
    SECVOTE_OTP_RESEND_COOLDOWN_SECONDS: E2E ? "0" : "30",
    SECVOTE_WORKER_POLL_SECONDS: "0.5",
    SECVOTE_CORS_ORIGINS: `["http://localhost:${PORTS.web}"]`,
    SECVOTE_WEB_URL: `http://localhost:${PORTS.web}`,
  }
  const api = join(ROOT, "apps", "api")
  // Dev mode: if apps/api/.env exists, let it decide DB, email and allowed domains
  // (env vars would otherwise override it). E2E always stays isolated.
  if (!E2E && existsSync(join(api, ".env"))) {
    for (const k of ["SECVOTE_MONGODB_URI", "SECVOTE_MONGODB_DB", "SECVOTE_EMAIL_BACKEND", "SECVOTE_ALLOWED_EMAIL_DOMAINS"]) {
      if (!process.env[k]) delete apiEnv[k]
    }
    log("using apps/api/.env for database, email and allowed domains")
  }

  // Sync the Python env once; if another running stack holds its .exe shims (Windows file locks), carry on
  // with the existing env. Everything below runs as `python -m`, which never needs the shims.
  const sync = spawnSync("uv", ["sync"], { cwd: api, env: envWith(), encoding: "utf8" })
  if (sync.status !== 0) log("uv sync skipped (env in use by another stack); using the existing environment")
  const py = (mod, ...args) => ["run", "--no-sync", "python", "-m", mod, ...args]

  // Dev: remember the officer login across restarts (.e2e/ is gitignored). E2E: always fresh.
  const credsFile = join(STATE, "dev-admin.json")
  const admin =
    !E2E && existsSync(credsFile)
      ? JSON.parse(readFileSync(credsFile, "utf8"))
      : { email: "officer@example.edu.in", password: randomBytes(12).toString("base64url") }
  if (!E2E) writeFileSync(credsFile, JSON.stringify(admin, null, 2))
  {
    const cli = (args) =>
      spawnSync("uv", [...py(...args), "--password-env", "BOOTSTRAP_PW"], {
        cwd: api,
        env: envWith({ ...apiEnv, BOOTSTRAP_PW: admin.password }),
        encoding: "utf8",
      })
    const out = cli(["secvote.cli.bootstrap_admin", "--email", admin.email, "--name", "Election Officer"])
    if (out.status !== 0 && !E2E) {
      // An admin already exists (persistent dev DB): make sure the remembered officer login still works.
      const reset = cli(["secvote.cli.reset_password", "--email", admin.email])
      if (reset.status !== 0)
        log(`an admin already exists that isn't ${admin.email}. Reset its password with: cd apps/api; uv run secvote-reset-password --email <admin email>`)
    }
  }

  start("api", "uv", py("secvote.main"), { cwd: api, env: apiEnv })
  // Dev: watchfiles restarts the worker when Python code changes. E2E: run it directly.
  start("worker", "uv", E2E ? py("secvote.workers") : py("watchfiles", "--filter", "python", "secvote.workers.__main__.main", "src"), {
    cwd: api,
    env: apiEnv,
  })
  await waitFor(`http://127.0.0.1:${PORTS.api}/readyz`, {}, "api")

  const web = join(ROOT, "apps", "web")
  start("web", "pnpm", ["exec", "next", "dev", "--port", String(PORTS.web)], {
    cwd: web,
    env: {
      SECVOTE_API_URL: `http://127.0.0.1:${PORTS.api}`,
      NEXT_PUBLIC_RPC_URL: rpc,
      NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID),
      ...(E2E ? { NEXT_DIST_DIR: ".next-e2e" } : OFFSET ? { NEXT_DIST_DIR: `.next-${OFFSET}` } : {}),
    },
  })
  await waitFor(`http://localhost:${PORTS.web}/`, {}, "web", 180_000)

  writeFileSync(join(STATE, "stack.json"), JSON.stringify({ rpc, api: `http://127.0.0.1:${PORTS.api}`, web: `http://localhost:${PORTS.web}`, mailbox, db, admin }, null, 2))
  const line = "─".repeat(60)
  console.log(`\n${line}\n  SecVote is ready → http://localhost:${PORTS.web}\n\n  Officer / admin login\n    email:    ${admin.email}\n    password: ${admin.password}\n${E2E ? "" : `  (saved in .e2e/dev-admin.json; it stays the same on every restart)\n`}${line}\n`)
}

main().catch((e) => {
  console.error(e)
  shutdown(1)
})

