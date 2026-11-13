// Generates packages/shared/test-vectors/vectors.json, which BOTH the TS and Python test suites check.
// Run: pnpm --filter @secvote/shared vectors
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { NOTA, ABSTAIN, encodeOpen, encodeSealed, type RaceSpec } from "../src/ballot"
import { canonicalJson, resultHash, tallyOpen, tallySealed } from "../src/tally"
import { split } from "../src/shamir"
import { newKeyPair, sealBallot } from "../src/sealed"

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")
const races: RaceSpec[] = [
  { candidates: 3, method: "plurality" },
  { candidates: 4, method: "irv" },
  { candidates: 2, method: "plurality" },
]

const sealedBallots: (Uint8Array | null)[] = [
  encodeSealed([[0], [0, 1], [1]], races, true),
  encodeSealed([[0], [1, 0], [NOTA]], races, true),
  encodeSealed([[2], [2, 1, 0], []], races, true),
  encodeSealed([[1], [3, 2], [0]], races, true),
  encodeSealed([[NOTA], [3], [0]], races, true),
  encodeSealed([[], [], []], races, true),
  encodeSealed([[0], [2, 3, 0, 1], [1]], races, true),
  null, // failed to decrypt
  Uint8Array.from({ length: 256 }, (_, i) => (i === 0 ? 2 : i === 1 ? 1 : i === 2 ? 3 : 7)), // malformed
]
const openBallots = [encodeOpen([0, 1]), encodeOpen([2, ABSTAIN]), encodeOpen([NOTA, 1]), encodeOpen([0, 0])]

const sealed = tallySealed(sealedBallots, races, true)
const open = tallyOpen(openBallots, [3, 2], true)
const { secretKey, publicKey } = newKeyPair()
const pt = encodeSealed([[1], [2, 0], [0]], races, true)

const vectors = {
  tallies: [
    { mode: "sealed", races, allowNota: true, ballots: sealedBallots.map((b) => (b ? hex(b) : null)), canonical: canonicalJson(sealed), hash: resultHash(sealed) },
    { mode: "open", candidateCounts: [3, 2], allowNota: true, ballots: openBallots.map(hex), canonical: canonicalJson(open), hash: resultHash(open) },
  ],
  shamir: { secret: secretKey, shares: split(secretKey) },
  ecies: { secretKey, publicKey, plaintext: hex(pt), ciphertext: hex(sealBallot(publicKey, pt)) },
}

const dir = fileURLToPath(new URL("../test-vectors/", import.meta.url))
mkdirSync(dir, { recursive: true })
writeFileSync(dir + "vectors.json", JSON.stringify(vectors, null, 2) + "\n")
console.log("wrote test-vectors/vectors.json", resultHash(sealed))
