// Browser implementation of docs/ballot-format.md (open ballot v1). Pure; unit-tested.
// Must match packages/contracts/src/BallotFormat.sol and secvote.domain.ballot byte for byte.
import { bytesToHex, hexToBytes, keccak256 } from "viem"

export const VERSION = 0x01
export const MODE_OPEN = 0x00
export const OPEN_BALLOT_SIZE = 64
export const NOTA = 0xfe
export const ABSTAIN = 0xff
export const MAX_RACES = 32

export class BallotFormatError extends Error {}

export function encodeOpen(choices: readonly number[]): Uint8Array {
  if (choices.length < 1 || choices.length > MAX_RACES) throw new BallotFormatError("race count out of range")
  const out = new Uint8Array(OPEN_BALLOT_SIZE)
  out[0] = VERSION
  out[1] = MODE_OPEN
  out[2] = choices.length
  choices.forEach((c, i) => {
    if (!Number.isInteger(c) || c < 0 || c > 0xff) throw new BallotFormatError("choice must be a byte")
    out[3 + i] = c
  })
  return out
}

export function decodeOpen(ballot: Uint8Array, candidateCounts: readonly number[], allowNota: boolean): number[] {
  if (ballot.length !== OPEN_BALLOT_SIZE) throw new BallotFormatError("bad length")
  if (ballot[0] !== VERSION || ballot[1] !== MODE_OPEN) throw new BallotFormatError("bad header")
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

/** Semaphore `message` binding a proof to these exact ballot bytes: uint256(keccak256(ballot)). */
export function messageFor(ballot: Uint8Array): bigint {
  return BigInt(keccak256(ballot))
}

export const toHex = (b: Uint8Array) => bytesToHex(b)
export const fromHex = (h: `0x${string}`) => hexToBytes(h)
