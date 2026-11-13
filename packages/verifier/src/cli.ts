#!/usr/bin/env -S npx tsx
// secvote-verify --rpc <url> --election <0xaddress> [--from-block <n>] [--json]
//
// Independently recounts a SecVote election using ONLY public chain data:
//   1. reads the contract (mode, races, revealed key, declared result hash),
//   2. fetches every BallotCast event,
//   3. decrypts sealed ballots with the revealed key (or decodes open ballots),
//   4. tallies them with the published rules (docs/ballot-format.md),
//   5. compares keccak256(canonical result) with the hash the officer declared on chain.
// Exit code 0 = MATCH, 1 = MISMATCH / not declared, 2 = usage or connection error.
import { createPublicClient, http, isAddress, type Address } from "viem"
import { verifyElection } from "@secvote/shared"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<number> {
  const rpc = arg("rpc")
  const election = arg("election")
  if (!rpc || !election || !isAddress(election)) {
    console.error("usage: secvote-verify --rpc <url> --election <0xaddress> [--from-block <n>] [--json]")
    return 2
  }
  const client = createPublicClient({ transport: http(rpc) })
  const json = process.argv.includes("--json")
  const report = await verifyElection(client, election as Address, {
    fromBlock: arg("from-block") ? BigInt(arg("from-block")!) : 0n,
    onProgress: (m) => !json && console.error(`… ${m}`),
  })

  if (json) {
    console.log(JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2))
  } else {
    console.log(`\nElection   ${report.address}  (${report.mode})`)
    console.log(`Ballots    ${report.ballots}`)
    report.result?.races.forEach((r, i) => {
      const counts = r.method === "irv" ? r.rounds[r.rounds.length - 1]!.counts : r.counts
      const extra = r.method === "plurality" ? `  nota ${r.nota}` : `  rounds ${r.rounds.length}`
      console.log(`Race ${i}     ${r.method.padEnd(9)} [${counts.join(", ")}]${extra}  abstain ${r.abstain}  invalid ${r.invalid}  winner ${r.winner}`)
    })
    console.log(`Computed   ${report.computedHash ?? "—"}`)
    console.log(`Declared   ${report.declaredHash ?? "—"}`)
    for (const n of report.notes) console.log(`Note       ${n}`)
    console.log(report.matches ? "\nMATCH: the declared result is exactly what the ballots on chain add up to." : "\nNO MATCH")
  }
  return report.matches ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  },
)
