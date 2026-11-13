// FFI helper for Foundry tests: produces real Semaphore v4 commitments and proofs.
//   node scripts/proof.mjs commitment <seed>
//   node scripts/proof.mjs prove <seed> <scope> <message> <member,member,...>
// Members are identity seeds or (all-digit) commitments, in on-chain tree order.
// Output is a 0x-prefixed ABI word stream so Solidity can abi.decode it.
import { Identity, Group, generateProof } from "@semaphore-protocol/core"

const word = (v) => BigInt(v).toString(16).padStart(64, "0")
const [cmd, ...args] = process.argv.slice(2)

if (cmd === "commitment") {
  process.stdout.write("0x" + word(new Identity(args[0]).commitment))
} else if (cmd === "prove") {
  const [seed, scope, message, members] = args
  const toCommitment = (m) => (/^\d+$/.test(m) ? BigInt(m) : new Identity(m).commitment)
  const group = new Group(members.split(",").map(toCommitment))
  const p = await generateProof(new Identity(seed), group, BigInt(message), BigInt(scope))
  const words = [p.merkleTreeDepth, p.merkleTreeRoot, p.nullifier, p.message, p.scope, ...p.points]
  process.stdout.write("0x" + words.map(word).join(""))
  process.exit(0) // snarkjs keeps worker threads alive
} else {
  console.error("unknown command")
  process.exit(1)
}
