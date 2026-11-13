// Shamir secret sharing over the secp256k1 group order (a prime field). Mirrors secvote.domain.shamir.
// f(x) = s + a1·x + … + a(k-1)·x^(k-1) mod N; share i = (i, f(i)); any k shares rebuild s = f(0).
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

export type Share = { x: number; y: string } // y: 0x-prefixed 32-byte hex

const mod = (a: bigint) => ((a % N) + N) % N
const hex32 = (v: bigint) => "0x" + v.toString(16).padStart(64, "0")

function pow(b: bigint, e: bigint): bigint {
  let r = 1n
  b = mod(b)
  while (e > 0n) {
    if (e & 1n) r = (r * b) % N
    b = (b * b) % N
    e >>= 1n
  }
  return r
}
const inv = (a: bigint) => pow(a, N - 2n)

function randomScalar(): bigint {
  for (;;) {
    const b = crypto.getRandomValues(new Uint8Array(32))
    const v = BigInt("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""))
    if (v > 0n && v < N) return v
  }
}

export function split(secretHex: string, k = 2, n = 3): Share[] {
  const s = BigInt(secretHex.startsWith("0x") ? secretHex : "0x" + secretHex)
  if (!(s > 0n && s < N)) throw new Error("secret out of range")
  if (!(k >= 2 && k <= n && n <= 255)) throw new Error("bad threshold")
  const coeffs = [s, ...Array.from({ length: k - 1 }, randomScalar)]
  return Array.from({ length: n }, (_, i) => {
    const x = BigInt(i + 1)
    let y = 0n
    for (let j = coeffs.length - 1; j >= 0; j--) y = mod(y * x + coeffs[j]!)
    return { x: i + 1, y: hex32(y) }
  })
}

export function combine(shares: readonly Share[]): string {
  if (shares.length < 2) throw new Error("need at least 2 shares")
  if (new Set(shares.map((s) => s.x)).size !== shares.length) throw new Error("duplicate share")
  let s = 0n
  for (const a of shares) {
    let num = 1n
    let den = 1n
    for (const b of shares) {
      if (a.x === b.x) continue
      num = mod(num * BigInt(-b.x))
      den = mod(den * BigInt(a.x - b.x))
    }
    s = mod(s + BigInt(a.y) * num * inv(den))
  }
  return hex32(s)
}
