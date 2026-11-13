// Voter identity: created in the browser, never sent anywhere. Only the commitment leaves the device.
// Storage: encrypted with a passphrase (scrypt -> AES-256-GCM) in IndexedDB, plus a downloadable backup file.
// One identity per election, so commitments cannot link a person across elections.
import { Identity } from "@semaphore-protocol/core"
import { scrypt } from "@noble/hashes/scrypt.js"
import { makeBackupCard, readBackupFile, saveBlob } from "./backup-card"

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const
const DB_NAME = "secvote"
const STORE = "identities"
export const MIN_PASSPHRASE = 10

export type EncryptedIdentity = {
  v: 1
  kdf: "scrypt"
  n: number
  r: number
  p: number
  salt: string // base64
  iv: string // base64
  ct: string // base64 (AES-GCM ciphertext of the exported private key)
  commitment: string
  electionId: string
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function createIdentity(): Identity {
  return new Identity()
}

async function aesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = scrypt(new TextEncoder().encode(passphrase.normalize("NFKC")), salt, SCRYPT)
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function encryptIdentity(id: Identity, passphrase: string, electionId: string): Promise<EncryptedIdentity> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters`)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(passphrase, salt)
  const aad = new TextEncoder().encode(`secvote:${electionId}:${id.commitment}`)
  const pt = new TextEncoder().encode(id.export())
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, pt))
  return {
    v: 1,
    kdf: "scrypt",
    n: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(ct),
    commitment: id.commitment.toString(),
    electionId,
  }
}

export async function decryptIdentity(enc: EncryptedIdentity, passphrase: string): Promise<Identity> {
  const key = await aesKey(passphrase, unb64(enc.salt))
  const aad = new TextEncoder().encode(`secvote:${enc.electionId}:${enc.commitment}`)
  let pt: ArrayBuffer
  try {
    pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(enc.iv) as BufferSource, additionalData: aad },
      key,
      unb64(enc.ct) as BufferSource,
    )
  } catch {
    throw new Error("Wrong passphrase or damaged backup")
  }
  const id = Identity.import(new TextDecoder().decode(pt))
  if (id.commitment.toString() !== enc.commitment) throw new Error("Backup does not match its commitment")
  return id
}

export function parseBackup(text: string): EncryptedIdentity {
  let data: Partial<EncryptedIdentity>
  try {
    data = JSON.parse(text) as Partial<EncryptedIdentity>
  } catch {
    throw new Error("Not a SecVote identity backup")
  }
  if (data.v !== 1 || !data.ct || !data.commitment || !data.electionId) throw new Error("Not a SecVote identity backup")
  return data as EncryptedIdentity
}

// ---------------------------------------------------------------- IndexedDB
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const saveLocal = (enc: EncryptedIdentity) => tx("readwrite", (s) => s.put(enc, enc.electionId))
export const loadLocal = (electionId: string) =>
  tx<EncryptedIdentity | undefined>("readonly", (s) => s.get(electionId) as IDBRequest<EncryptedIdentity | undefined>)

/** Save the encrypted identity as a backup card image (PNG) the voter can keep or print. */
export async function downloadBackup(enc: EncryptedIdentity, election: { slug: string; title: string; org: string }): Promise<void> {
  const fp = enc.commitment
  const card = await makeBackupCard(JSON.stringify(enc), {
    heading: "Voting identity backup",
    title: election.title,
    subtitle: election.org,
    facts: [
      ["Fingerprint", `${fp.slice(0, 10)}…${fp.slice(-6)}`],
      ["Saved on", new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
    ],
    notes: [
      "Keep this image safe. To vote on another device, open the ballot page, upload this image and enter your passphrase.",
      "Nobody can use it without your passphrase. Don't post it publicly.",
    ],
  })
  saveBlob(card, `secvote-identity-${election.slug}.png`)
}

/** Read a backup card image (or an older .json backup) back into an encrypted identity. */
export async function readIdentityBackup(file: File): Promise<EncryptedIdentity> {
  return parseBackup(await readBackupFile(file))
}
