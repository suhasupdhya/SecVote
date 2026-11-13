// docs/ballot-format.md, in TypeScript. Pure; shared by the browser, the verify page and the verifier CLI.
// Must match packages/contracts/src/BallotFormat.sol and apps/api/src/secvote/domain/ballot.py byte for byte.
import { keccak256 } from "viem"

export const NOTA = 0xfe
export const ABSTAIN = 0xff
export const MAX_RACES = 32
export const OPEN_BALLOT_SIZE = 64
export const SEALED_PLAINTEXT_SIZE = 256
export const SEALED_BALLOT_SIZE = 353 // 65 ephemeral pk + 16 nonce + 16 tag + 256 ciphertext

export type Method = "plurality" | "irv"
export type RaceSpec = { candidates: number; method: Method }

export class BallotFormatError extends Error {}

// ------------------------------------------------------------------ open ballot v1 (64 bytes)
export function encodeOpen(choices: readonly number[]): Uint8Array {
  if (choices.length < 1 || choices.length > MAX_RACES) throw new BallotFormatError("race count out of range")
  const out = new Uint8Array(OPEN_BALLOT_SIZE)
  out[0] = 0x01
  out[1] = 0x00
  out[2] = choices.length
  choices.forEach((c, i) => {
    if (!Number.isInteger(c) || c < 0 || c > 0xff) throw new BallotFormatError("choice must be a byte")
    out[3 + i] = c
  })
  return out
}

export function decodeOpen(ballot: Uint8Array, candidateCounts: readonly number[], allowNota: boolean): number[] {
  if (ballot.length !== OPEN_BALLOT_SIZE) throw new BallotFormatError("bad length")
  if (ballot[0] !== 0x01 || ballot[1] !== 0x00) throw new BallotFormatError("bad header")
  if (ballot[2] !== candidateCounts.length) throw new BallotFormatError("bad race count")
  const choices: number[] = []
  candidateCounts.forEach((n, i) => {
    const c = ballot[3 + i]!
    if (!(c < n || c === ABSTAIN || (allowNota && c === NOTA))) throw new BallotFormatError(`bad choice ${c} for race ${i}`)
    choices.push(c)
  })
  for (let j = 3 + candidateCounts.length; j < OPEN_BALLOT_SIZE; j++) {
    if (ballot[j] !== 0) throw new BallotFormatError("non-canonical padding")
  }
  return choices
}

// ------------------------------------------------------------------ sealed ballot v2 plaintext (256 bytes)
/** One entry per race: [] = blank, [c] = single choice (plurality) or a ranking (IRV, most preferred first). */
export type SealedChoices = number[][]

function checkRace(choice: readonly number[], race: RaceSpec, allowNota: boolean, i: number): void {
  if (race.method === "plurality") {
    if (choice.length > 1) throw new BallotFormatError(`race ${i}: one choice only`)
    if (choice.length === 1) {
      const c = choice[0]!
      if (!(c < race.candidates || (allowNota && c === NOTA))) throw new BallotFormatError(`race ${i}: bad choice ${c}`)
    }
  } else {
    if (choice.length > race.candidates) throw new BallotFormatError(`race ${i}: too many rankings`)
    if (new Set(choice).size !== choice.length) throw new BallotFormatError(`race ${i}: duplicate ranking`)
    for (const c of choice) if (!(c >= 0 && c < race.candidates)) throw new BallotFormatError(`race ${i}: bad candidate ${c}`)
  }
}

export function encodeSealed(choices: SealedChoices, races: readonly RaceSpec[], allowNota: boolean): Uint8Array {
  if (choices.length !== races.length || races.length < 1 || races.length > MAX_RACES) throw new BallotFormatError("race count mismatch")
  const out = new Uint8Array(SEALED_PLAINTEXT_SIZE)
  out[0] = 0x02
  out[1] = 0x01
  out[2] = races.length
  let p = 3
  choices.forEach((choice, i) => {
    checkRace(choice, races[i]!, allowNota, i)
    if (p + 1 + choice.length > SEALED_PLAINTEXT_SIZE) throw new BallotFormatError("ballot too large")
    out[p++] = choice.length
    for (const c of choice) out[p++] = c
  })
  return out
}

export function decodeSealed(pt: Uint8Array, races: readonly RaceSpec[], allowNota: boolean): SealedChoices {
  if (pt.length !== SEALED_PLAINTEXT_SIZE) throw new BallotFormatError("bad length")
  if (pt[0] !== 0x02 || pt[1] !== 0x01) throw new BallotFormatError("bad header")
  if (pt[2] !== races.length) throw new BallotFormatError("bad race count")
  let p = 3
  const out: SealedChoices = []
  races.forEach((race, i) => {
    if (p >= SEALED_PLAINTEXT_SIZE) throw new BallotFormatError("truncated")
    const k = pt[p++]!
    if (p + k > SEALED_PLAINTEXT_SIZE) throw new BallotFormatError("truncated")
    const choice = Array.from(pt.slice(p, p + k))
    p += k
    checkRace(choice, race, allowNota, i)
    out.push(choice)
  })
  for (let j = p; j < SEALED_PLAINTEXT_SIZE; j++) if (pt[j] !== 0) throw new BallotFormatError("non-canonical padding")
  return out
}

/** Semaphore `message` binding a proof to these exact ballot bytes: uint256(keccak256(ballot)). */
export function messageFor(ballot: Uint8Array): bigint {
  return BigInt(keccak256(ballot))
}
