// Universal verifiability: recount an election from chain data ONLY (an RPC URL + the contract address).
// Used by the web /verify page and by the standalone CLI in packages/verifier.
import { hexToBytes, type Address, type PublicClient } from "viem"
import { electionAbi } from "./contracts"
import type { RaceSpec } from "./ballot"
import { openBallot } from "./sealed"
import { canonicalJson, resultHash, tallyOpen, tallySealed, type ElectionResult } from "./tally"

export type VerifyReport = {
  address: Address
  mode: "open" | "sealed"
  races: RaceSpec[]
  ballots: number
  keyRevealed: boolean
  declaredHash: `0x${string}` | null
  computedHash: `0x${string}` | null
  result: ElectionResult | null
  canonical: string | null
  matches: boolean
  notes: string[]
}

const ZERO32 = `0x${"0".repeat(64)}` as const

export async function verifyElection(
  client: PublicClient,
  address: Address,
  opts: { fromBlock?: bigint; chunk?: bigint; onProgress?: (msg: string) => void } = {},
): Promise<VerifyReport> {
  const say = opts.onProgress ?? (() => {})
  const read = <T>(functionName: string) =>
    client.readContract({ address, abi: electionAbi, functionName: functionName as never }) as Promise<T>

  say("Reading the election contract…")
  const [mode, counts, methods, allowNota, revealedKey, declared, ballotCount] = await Promise.all([
    read<number>("mode"),
    read<readonly number[]>("candidateCounts"),
    read<readonly number[]>("raceMethods"),
    read<boolean>("allowNota"),
    read<`0x${string}`>("revealedKey"),
    read<`0x${string}`>("resultHash"),
    read<bigint>("ballotCount"),
  ])
  const races: RaceSpec[] = counts.map((n, i) => ({ candidates: Number(n), method: methods[i] === 1 ? "irv" : "plurality" }))
  const sealed = mode === 1
  const notes: string[] = []

  say("Fetching every BallotCast event…")
  const latest = await client.getBlockNumber()
  const chunk = opts.chunk ?? 10_000n
  const events: { index: bigint; ballot: `0x${string}` }[] = []
  for (let from = opts.fromBlock ?? 0n; from <= latest; from += chunk) {
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n
    const logs = await client.getContractEvents({ address, abi: electionAbi, eventName: "BallotCast", fromBlock: from, toBlock: to })
    for (const l of logs) {
      const a = l.args as { index: bigint; ballot: `0x${string}` }
      events.push({ index: a.index, ballot: a.ballot })
    }
  }
  events.sort((a, b) => (a.index < b.index ? -1 : 1))
  if (BigInt(events.length) !== ballotCount) notes.push(`Contract reports ${ballotCount} ballots but ${events.length} events were found.`)
  if (events.some((e, i) => e.index !== BigInt(i))) notes.push("Ballot indexes are not contiguous.")

  const declaredHash = declared === ZERO32 ? null : declared
  const keyRevealed = revealedKey !== "0x"
  let result: ElectionResult | null = null
  if (!sealed) {
    say(`Tallying ${events.length} open ballots…`)
    result = tallyOpen(events.map((e) => hexToBytes(e.ballot)), counts.map(Number), allowNota)
  } else if (keyRevealed) {
    say(`Decrypting ${events.length} sealed ballots with the revealed key…`)
    const plaintexts = events.map((e) => openBallot(revealedKey, hexToBytes(e.ballot)))
    result = tallySealed(plaintexts, races, allowNota)
  } else {
    notes.push("The election key has not been revealed yet, so sealed ballots cannot be counted.")
  }

  const computedHash = result ? resultHash(result) : null
  if (!declaredHash) notes.push("No result has been declared on chain yet.")
  return {
    address,
    mode: sealed ? "sealed" : "open",
    races,
    ballots: events.length,
    keyRevealed,
    declaredHash,
    computedHash,
    result,
    canonical: result ? canonicalJson(result) : null,
    matches: !!declaredHash && declaredHash === computedHash,
    notes,
  }
}
