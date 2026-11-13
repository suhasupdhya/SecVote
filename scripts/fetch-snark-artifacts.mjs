#!/usr/bin/env node
// Downloads the Semaphore proving files so the site can serve them itself (production).
//
//   node scripts/fetch-snark-artifacts.mjs [--max-depth 16 (or SNARK_MAX_DEPTH)] [--out apps/web/public/snark-artifacts]
//
// A voting roll of N people needs depth ceil(log2(N)): depth 16 covers 65,536 voters, 20 covers ~1 million.
// Files that are already present are kept. A SHA-256 list (SHA256SUMS) is written next to them, so a later
// download can be compared with it. Build the web app with NEXT_PUBLIC_SNARK_ARTIFACTS_URL=/snark-artifacts.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Must match the version @semaphore-protocol/proof asks for (it pins 4.13.0 for Semaphore 4.14.x).
const VERSION = "4.13.0"
const BASE = `https://snark-artifacts.pse.dev/semaphore/${VERSION}/semaphore`

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const maxDepth = Number(opt("--max-depth", process.env.SNARK_MAX_DEPTH || "16"))
const out = resolve(root, opt("--out", "apps/web/public/snark-artifacts"))
if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 32) throw new Error("--max-depth must be 1..32")
mkdirSync(out, { recursive: true })

const sums = []
for (let depth = 1; depth <= maxDepth; depth++) {
  for (const ext of ["wasm", "zkey"]) {
    const name = `semaphore-${depth}.${ext}`
    const path = join(out, name)
    if (!existsSync(path)) {
      const res = await fetch(`${BASE}-${depth}.${ext}`)
      if (!res.ok) throw new Error(`download failed for ${name}: HTTP ${res.status}`)
      writeFileSync(path, Buffer.from(await res.arrayBuffer()))
      console.log(`downloaded ${name}`)
    }
    sums.push(`${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${name}`)
  }
}
writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n")
console.log(`proving files for depths 1-${maxDepth} are in ${out}`)
