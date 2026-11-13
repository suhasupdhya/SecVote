// A trustee's personal key for one election: generated in their browser, never sent anywhere.
// Only its public half is registered; election key shares are encrypted to it.
// Stored passphrase-encrypted (scrypt -> AES-256-GCM) in IndexedDB, plus a downloadable backup.
import { scrypt } from "@noble/hashes/scrypt.js"
import { newKeyPair, publicKeyOf } from "@secvote/shared"
import { makeBackupCard, readBackupFile, saveBlob } from "./backup-card"

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const
export const MIN_PASSPHRASE = 10

export type SealedTrusteeKey = {
  v: 1
  kind: "secvote-trustee-key"
  electionId: string
  publicKey: string
  salt: string
  iv: string
  ct: string
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function aes(pass: string, salt: Uint8Array) {
  const raw = scrypt(new TextEncoder().encode(pass.normalize("NFKC")), salt, SCRYPT)
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function createTrusteeKey(passphrase: string, electionId: string): Promise<SealedTrusteeKey> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters`)
  const { secretKey, publicKey } = newKeyPair()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = new TextEncoder().encode(`secvote-trustee:${electionId}:${publicKey}`)
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await aes(passphrase, salt), new TextEncoder().encode(secretKey))
  return { v: 1, kind: "secvote-trustee-key", electionId, publicKey, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) }
}

export async function unlockTrusteeKey(k: SealedTrusteeKey, passphrase: string): Promise<string> {
  const aad = new TextEncoder().encode(`secvote-trustee:${k.electionId}:${k.publicKey}`)
  let pt: ArrayBuffer
  try {
    pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(k.iv) as BufferSource, additionalData: aad },
      await aes(passphrase, unb64(k.salt)),
      unb64(k.ct) as BufferSource,
    )
  } catch {
    throw new Error("Wrong passphrase or damaged key file")
  }
  const sk = new TextDecoder().decode(pt)
  if (publicKeyOf(sk) !== k.publicKey) throw new Error("Key file does not match its public key")
  return sk
}

export function parseTrusteeKey(text: string): SealedTrusteeKey {
  let k: Partial<SealedTrusteeKey>
  try {
    k = JSON.parse(text) as Partial<SealedTrusteeKey>
  } catch {
    throw new Error("Not a SecVote trustee key file")
  }
  if (k.kind !== "secvote-trustee-key" || !k.ct || !k.publicKey || !k.electionId) throw new Error("Not a SecVote trustee key file")
  return k as SealedTrusteeKey
}

// ---------------------------------------------------------------- IndexedDB
const DB = "secvote-trustee"
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore("keys")
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
export async function saveTrusteeKey(k: SealedTrusteeKey): Promise<void> {
  const d = await db()
  await new Promise<void>((res, rej) => {
    const t = d.transaction("keys", "readwrite")
    t.objectStore("keys").put(k, k.electionId)
    t.oncomplete = () => res()
    t.onerror = () => rej(t.error)
  })
}
export async function loadTrusteeKey(electionId: string): Promise<SealedTrusteeKey | undefined> {
  const d = await db()
  return new Promise((res, rej) => {
    const r = d.transaction("keys").objectStore("keys").get(electionId)
    r.onsuccess = () => res(r.result as SealedTrusteeKey | undefined)
    r.onerror = () => rej(r.error)
  })
}

/** Save the sealed trustee key as a backup card image (PNG) the trustee can keep or print. */
export async function downloadTrusteeKey(k: SealedTrusteeKey, election: { slug: string; title: string; org: string }, slot: number): Promise<void> {
  const card = await makeBackupCard(JSON.stringify(k), {
    heading: "Trustee key backup",
    title: election.title,
    subtitle: election.org,
    facts: [
      ["Trustee", `Slot ${slot} of 3`],
      ["Public key", `${k.publicKey.slice(0, 12)}…${k.publicKey.slice(-6)}`],
      ["Saved on", new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
    ],
    notes: [
      "After voting closes you need this image and your trustee passphrase to release your share so the votes can be counted.",
      "Nobody can use it without your passphrase. Keep it private.",
    ],
  })
  saveBlob(card, `secvote-trustee-key-${election.slug}.png`)
}

/** Read a trustee backup card (or an older .json key file). */
export async function readTrusteeKeyFile(file: File): Promise<SealedTrusteeKey> {
  return parseTrusteeKey(await readBackupFile(file))
}
