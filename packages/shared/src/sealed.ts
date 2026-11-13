// ECIES (secp256k1, HKDF-SHA256, AES-256-GCM) via eciesjs default config. Python side: eciespy.
import { PrivateKey, decrypt, encrypt } from "eciesjs"
import { SEALED_BALLOT_SIZE, SEALED_PLAINTEXT_SIZE } from "./ballot"

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h)

export function newKeyPair(): { secretKey: string; publicKey: string } {
  const sk = new PrivateKey()
  return { secretKey: "0x" + sk.toHex(), publicKey: "0x" + sk.publicKey.toHex() }
}

export function publicKeyOf(secretKeyHex: string): string {
  return "0x" + PrivateKey.fromHex(strip(secretKeyHex)).publicKey.toHex()
}

export function encryptTo(publicKeyHex: string, data: Uint8Array): Uint8Array {
  return encrypt(strip(publicKeyHex), data)
}

export function decryptWith(secretKeyHex: string, data: Uint8Array): Uint8Array {
  return decrypt(strip(secretKeyHex), data)
}

export function sealBallot(publicKeyHex: string, plaintext: Uint8Array): Uint8Array {
  if (plaintext.length !== SEALED_PLAINTEXT_SIZE) throw new Error("sealed plaintext must be 256 bytes")
  const ct = encryptTo(publicKeyHex, plaintext)
  if (ct.length !== SEALED_BALLOT_SIZE) throw new Error(`unexpected ciphertext size ${ct.length}`)
  return ct
}

/** Returns null for anything that does not decrypt (counted as an invalid ballot). */
export function openBallot(secretKeyHex: string, ciphertext: Uint8Array): Uint8Array | null {
  try {
    return decryptWith(secretKeyHex, ciphertext)
  } catch {
    return null
  }
}
