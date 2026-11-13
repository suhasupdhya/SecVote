#!/usr/bin/env node
// Deploys SecVote's contracts to a real network (testnet or mainnet) and records the addresses.
//
//   DEPLOYER_KEY=0x... RELAYER_ADDRESS=0x... node scripts/deploy-contracts.mjs --rpc https://sepolia.base.org
//
// - DEPLOYER_KEY: a funded key used once for deployment (it becomes the factory admin). Keep it offline afterwards.
// - RELAYER_ADDRESS: the address of SECVOTE_RELAYER_PRIVATE_KEY (the server's day-to-day key).
// - SEMAPHORE_ADDRESS (optional): reuse an existing Semaphore v4 deployment instead of deploying one.
// Writes packages/contracts/deployments/<chainId>.json (commit it) and packages/shared/deployments.json
// (copied to the server; the API and worker read it).
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const contracts = join(root, "packages", "contracts")
const args = process.argv.slice(2)
const rpc = args[args.indexOf("--rpc") + 1]
if (!args.includes("--rpc") || !rpc) throw new Error("usage: node scripts/deploy-contracts.mjs --rpc <RPC URL>")
for (const name of ["DEPLOYER_KEY", "RELAYER_ADDRESS"])
  if (!process.env[name]) throw new Error(`${name} is required (see the comment at the top of this script)`)

const bin = (name) => {
  const local = join(homedir(), ".foundry", "bin", process.platform === "win32" ? `${name}.exe` : name)
  return existsSync(local) ? local : name
}
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { stdio: "inherit", ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${argv[0]} failed`)
}

const chainId = spawnSync(bin("cast"), ["chain-id", "--rpc-url", rpc], { encoding: "utf8" }).stdout?.trim()
if (!chainId) throw new Error(`could not reach ${rpc}`)
if (["31337", "31338", "31339"].includes(chainId)) throw new Error("that's a local test chain: use `pnpm dev` instead")
console.log(`deploying to chain ${chainId} via ${rpc}`)

run(bin("forge"), ["build"], { cwd: contracts })
run(
  bin("forge"),
  ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--private-key", process.env.DEPLOYER_KEY, "--slow"],
  { cwd: contracts, env: { ...process.env } },
)
run(process.execPath, [join(contracts, "scripts", "gen-abis.mjs")], { cwd: contracts })

const dep = JSON.parse(readFileSync(join(contracts, "deployments", `${chainId}.json`), "utf8"))
console.log(`\nDeployed on chain ${chainId}:\n  ElectionFactory ${dep.electionFactory}\n  Semaphore       ${dep.semaphore}`)
console.log("\nNext: commit packages/contracts/deployments/" + chainId + ".json, and put packages/shared/deployments.json on the server.")
