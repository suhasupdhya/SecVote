// Counting rules + canonical result hash (docs/ballot-format.md). Mirrors secvote.domain.tally in Python.
import { keccak256, stringToBytes } from "viem"
import { ABSTAIN, NOTA, decodeOpen, decodeSealed, type RaceSpec, type SealedChoices } from "./ballot"

export type PluralityResult = {
  method: "plurality"
  counts: number[]
  nota: number
  abstain: number
  invalid: number
  winner: number
}
export type IrvRound = { counts: number[]; exhausted: number }
export type IrvResult = {
  method: "irv"
  first: number[]
  rounds: IrvRound[]
  abstain: number
  invalid: number
  winner: number
}
export type RaceResult = PluralityResult | IrvResult
export type ElectionResult = { v: 2; mode: "open" | "sealed"; races: RaceResult[] }

function pluralityWinner(counts: number[]): number {
  const max = Math.max(0, ...counts)
  if (max === 0) return -1
  const top = counts.flatMap((c, i) => (c === max ? [i] : []))
  return top.length === 1 ? top[0]! : -1
}

/** Instant-runoff. `rankings` excludes blank ballots. Deterministic: ties eliminate the highest index. */
export function runIrv(n: number, rankings: readonly (readonly number[])[]): { rounds: IrvRound[]; winner: number } {
  const continuing = new Set(Array.from({ length: n }, (_, i) => i))
  const rounds: IrvRound[] = []
  for (;;) {
    const counts = new Array<number>(n).fill(0)
    let exhausted = 0
    for (const r of rankings) {
      const top = r.find((c) => continuing.has(c))
      if (top === undefined) exhausted++
      else counts[top]!++
    }
    rounds.push({ counts, exhausted })
    const total = counts.reduce((a, b) => a + b, 0)
    if (total === 0) return { rounds, winner: -1 }
    const majority = [...continuing].find((c) => counts[c]! * 2 > total)
    if (majority !== undefined) return { rounds, winner: majority }
    if (continuing.size === 1) return { rounds, winner: [...continuing][0]! }
    let loser = -1
    for (const c of continuing) {
      if (loser === -1 || counts[c]! < counts[loser]! || (counts[c] === counts[loser] && c > loser)) loser = c
    }
    continuing.delete(loser)
  }
}

export function tallyOpen(ballots: readonly Uint8Array[], candidateCounts: readonly number[], allowNota: boolean): ElectionResult {
  const races: PluralityResult[] = candidateCounts.map((n) => ({
    method: "plurality",
    counts: new Array<number>(n).fill(0),
    nota: 0,
    abstain: 0,
    invalid: 0,
    winner: -1,
  }))
  for (const b of ballots) {
    // Open ballots were validated by the contract, so decoding cannot fail for anything on chain.
    decodeOpen(b, candidateCounts, allowNota).forEach((c, i) => {
      const r = races[i]!
      if (c === NOTA) r.nota++
      else if (c === ABSTAIN) r.abstain++
      else r.counts[c]!++
    })
  }
  for (const r of races) r.winner = pluralityWinner(r.counts)
  return { v: 2, mode: "open", races }
}

/** `plaintexts[i]` is the decrypted ballot, or null if it failed to decrypt. */
export function tallySealed(plaintexts: readonly (Uint8Array | null)[], specs: readonly RaceSpec[], allowNota: boolean): ElectionResult {
  const decoded: (SealedChoices | null)[] = plaintexts.map((pt) => {
    if (!pt) return null
    try {
      return decodeSealed(pt, specs, allowNota)
    } catch {
      return null
    }
  })
  const invalid = decoded.filter((d) => d === null).length
  const valid = decoded.filter((d): d is SealedChoices => d !== null)
  const races: RaceResult[] = specs.map((spec, i) => {
    const choices = valid.map((v) => v[i]!)
    const abstain = choices.filter((c) => c.length === 0).length
    if (spec.method === "plurality") {
      const counts = new Array<number>(spec.candidates).fill(0)
      let nota = 0
      for (const c of choices) {
        if (c.length === 0) continue
        if (c[0] === NOTA) nota++
        else counts[c[0]!]!++
      }
      return { method: "plurality", counts, nota, abstain, invalid, winner: pluralityWinner(counts) }
    }
    const rankings = choices.filter((c) => c.length > 0)
    const first = new Array<number>(spec.candidates).fill(0)
    for (const r of rankings) first[r[0]!]!++
    const { rounds, winner } = runIrv(spec.candidates, rankings)
    return { method: "irv", first, rounds, abstain, invalid, winner }
  })
  return { v: 2, mode: "sealed", races }
}

/** Sorted keys, no whitespace. Values here are only integers, arrays, objects and fixed ASCII strings. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`
  }
  if (typeof value === "number" && !Number.isInteger(value)) throw new Error("canonical JSON allows integers only")
  return JSON.stringify(value)
}

export function resultHash(result: ElectionResult): `0x${string}` {
  return keccak256(stringToBytes(canonicalJson(result)))
}
