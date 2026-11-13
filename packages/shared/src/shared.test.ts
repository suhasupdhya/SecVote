import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { NOTA, decodeSealed, encodeOpen, encodeSealed, type RaceSpec } from "./ballot"
import { canonicalJson, resultHash, runIrv, tallyOpen, tallySealed } from "./tally"
import { combine, split } from "./shamir"
import { newKeyPair, openBallot, publicKeyOf, sealBallot } from "./sealed"

const RACES: RaceSpec[] = [
  { candidates: 3, method: "plurality" },
  { candidates: 3, method: "irv" },
]

describe("sealed ballot v2", () => {
  it("round-trips plurality, NOTA, blank and rankings", () => {
    const pt = encodeSealed([[NOTA], [2, 0, 1]], RACES, true)
    expect(pt.length).toBe(256)
    expect(Array.from(pt.slice(0, 10))).toEqual([2, 1, 2, 1, NOTA, 3, 2, 0, 1, 0])
    expect(decodeSealed(pt, RACES, true)).toEqual([[NOTA], [2, 0, 1]])
    expect(decodeSealed(encodeSealed([[], []], RACES, false), RACES, false)).toEqual([[], []])
  })

  it("rejects bad ballots", () => {
    expect(() => encodeSealed([[0, 1], []], RACES, true)).toThrow("one choice")
    expect(() => encodeSealed([[NOTA], []], RACES, false)).toThrow("bad choice")
    expect(() => encodeSealed([[0], [1, 1]], RACES, true)).toThrow("duplicate")
    expect(() => encodeSealed([[0], [NOTA]], RACES, true)).toThrow("bad candidate")
    const pt = encodeSealed([[0], [1]], RACES, true)
    pt[255] = 9
    expect(() => decodeSealed(pt, RACES, true)).toThrow("padding")
  })

  it("encrypts to exactly 353 bytes and decrypts with the right key only", () => {
    const { secretKey, publicKey } = newKeyPair()
    expect(publicKeyOf(secretKey)).toBe(publicKey)
    const pt = encodeSealed([[1], [0, 2]], RACES, true)
    const ct = sealBallot(publicKey, pt)
    expect(ct.length).toBe(353)
    expect(openBallot(secretKey, ct)).toEqual(pt)
    expect(openBallot(newKeyPair().secretKey, ct)).toBeNull()
  })
})

describe("IRV", () => {
  it("eliminates the lowest and transfers votes", () => {
    // A:2 B:2 C:1 -> C out, its vote goes to A -> A 3/5 wins
    const r = runIrv(3, [[0], [0], [1], [1], [2, 0]])
    expect(r.rounds.map((x) => x.counts)).toEqual([
      [2, 2, 1],
      [3, 2, 0],
    ])
    expect(r.winner).toBe(0)
  })
  it("breaks elimination ties by highest index and counts exhausted ballots", () => {
    const r = runIrv(3, [[0], [1], [2]])
    // all 1 -> eliminate 2 (highest index) -> exhausted 1 -> A 1, B 1 -> eliminate 1 -> A wins
    expect(r.rounds[1]).toEqual({ counts: [1, 1, 0], exhausted: 1 })
    expect(r.winner).toBe(0)
  })
  it("no ballots means no winner", () => {
    expect(runIrv(2, []).winner).toBe(-1)
  })
})

describe("tally + hash", () => {
  it("counts sealed ballots with invalid ones kept visible", () => {
    const res = tallySealed(
      [encodeSealed([[0], [1, 0]], RACES, true), encodeSealed([[NOTA], []], RACES, true), null],
      RACES,
      true,
    )
    expect(res.races[0]).toMatchObject({ counts: [1, 0, 0], nota: 1, abstain: 0, invalid: 1, winner: 0 })
    expect(res.races[1]).toMatchObject({ method: "irv", first: [0, 1, 0], abstain: 1, invalid: 1, winner: 1 })
  })
  it("open tally uses the same result shape", () => {
    const res = tallyOpen([encodeOpen([1, 0xff])], [2, 2], false)
    expect(res).toEqual({
      v: 2,
      mode: "open",
      races: [
        { method: "plurality", counts: [0, 1], nota: 0, abstain: 0, invalid: 0, winner: 1 },
        { method: "plurality", counts: [0, 0], nota: 0, abstain: 1, invalid: 0, winner: -1 },
      ],
    })
  })
  it("canonical JSON sorts keys and has no whitespace", () => {
    expect(canonicalJson({ b: [2, { d: 1, c: "x" }], a: -1 })).toBe('{"a":-1,"b":[2,{"c":"x","d":1}]}')
    expect(resultHash(tallyOpen([], [1], false))).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe("shamir 2-of-3", () => {
  it("any two shares rebuild the secret, one does not", () => {
    const { secretKey } = newKeyPair()
    const [a, b, c] = split(secretKey)
    expect(combine([a!, b!])).toBe(secretKey)
    expect(combine([c!, a!])).toBe(secretKey)
    expect(combine([b!, c!])).toBe(secretKey)
    expect(() => combine([a!])).toThrow()
  })
})

describe("cross-language vectors (packages/shared/test-vectors)", () => {
  const v = JSON.parse(readFileSync(fileURLToPath(new URL("../test-vectors/vectors.json", import.meta.url)), "utf8"))
  it("tally hashes match the recorded vectors", () => {
    for (const t of v.tallies) {
      const res =
        t.mode === "open"
          ? tallyOpen(t.ballots.map((h: string) => Buffer.from(h, "hex")), t.candidateCounts, t.allowNota)
          : tallySealed(t.ballots.map((h: string | null) => (h ? Buffer.from(h, "hex") : null)), t.races, t.allowNota)
      expect(canonicalJson(res)).toBe(t.canonical)
      expect(resultHash(res)).toBe(t.hash)
    }
  })
  it("shamir and ECIES vectors", () => {
    expect(combine(v.shamir.shares.slice(0, 2))).toBe(v.shamir.secret)
    expect(Buffer.from(openBallot(v.ecies.secretKey, Buffer.from(v.ecies.ciphertext, "hex"))!).toString("hex")).toBe(v.ecies.plaintext)
  })
})
