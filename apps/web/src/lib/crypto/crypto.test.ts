import { describe, expect, it } from "vitest"
import { ABSTAIN, NOTA, decodeOpen, encodeOpen, messageFor, toHex } from "./ballot"
import { createIdentity, decryptIdentity, encryptIdentity, loadLocal, parseBackup, saveLocal } from "./identity"
import { buildGroup } from "./proof"
import { Group } from "@semaphore-protocol/core"

describe("ballot format (docs/ballot-format.md)", () => {
  it("matches the spec test vectors", () => {
    expect(toHex(encodeOpen([1, 0])).slice(0, 18)).toBe("0x0100020100000000")
    expect(toHex(encodeOpen([NOTA, ABSTAIN])).slice(0, 18)).toBe("0x010002feff000000")
    expect(encodeOpen([0]).length).toBe(64)
  })

  it("round-trips", () => {
    const b = encodeOpen([2, 1, ABSTAIN])
    expect(decodeOpen(b, [3, 2, 4], false)).toEqual([2, 1, ABSTAIN])
  })

  it("rejects malformed ballots", () => {
    const good = encodeOpen([0, 0])
    expect(() => decodeOpen(good.slice(0, 63), [3, 2], true)).toThrow("bad length")
    const pad = good.slice(); pad[63] = 1
    expect(() => decodeOpen(pad, [3, 2], true)).toThrow("non-canonical")
    expect(() => decodeOpen(encodeOpen([3, 0]), [3, 2], true)).toThrow("bad choice")
    expect(() => decodeOpen(encodeOpen([NOTA, 0]), [3, 2], false)).toThrow("bad choice")
  })

  it("message equals the Python/Solidity value (cross-language vector)", () => {
    // python: secvote.domain.ballot.message_for(encode_open([1, 0]))
    expect(messageFor(encodeOpen([1, 0])).toString()).toBe(PY_MESSAGE_1_0)
  })
})

describe("identity backup", () => {
  it("encrypts and decrypts with the passphrase only", async () => {
    const id = createIdentity()
    const enc = await encryptIdentity(id, "correct horse battery", "election-1")
    expect(JSON.stringify(enc)).not.toContain(id.export())
    const back = await decryptIdentity(parseBackup(JSON.stringify(enc)), "correct horse battery")
    expect(back.commitment).toBe(id.commitment)
    await expect(decryptIdentity(enc, "wrong passphrase!")).rejects.toThrow("Wrong passphrase")
  })

  it("binds the backup to its election", async () => {
    const enc = await encryptIdentity(createIdentity(), "correct horse battery", "election-1")
    await expect(decryptIdentity({ ...enc, electionId: "election-2" }, "correct horse battery")).rejects.toThrow()
  })

  it("rejects short passphrases", async () => {
    await expect(encryptIdentity(createIdentity(), "short", "e")).rejects.toThrow("at least")
  })

  it("stores encrypted identities in IndexedDB", async () => {
    const enc = await encryptIdentity(createIdentity(), "correct horse battery", "election-db")
    await saveLocal(enc)
    expect((await loadLocal("election-db"))?.commitment).toBe(enc.commitment)
  })
})

describe("group check", () => {
  it("refuses a roll that does not match the frozen root", () => {
    const ids = [createIdentity(), createIdentity()].map((i) => i.commitment.toString())
    const root = new Group(ids.map(BigInt)).root.toString()
    expect(buildGroup(ids, root).size).toBe(2)
    expect(() => buildGroup([...ids, createIdentity().commitment.toString()], root)).toThrow("does not match")
  })
})

const PY_MESSAGE_1_0 = "46365139996198721177735923626742013720044077415595951588823047921441901919218"
