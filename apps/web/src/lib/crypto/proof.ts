// Builds the Semaphore proof in the browser. The server never sees the identity secret.
import { generateProof, Group, type Identity } from "@semaphore-protocol/core"
import { messageFor } from "./ballot"

export type ProofPayload = {
  merkleTreeDepth: number
  merkleTreeRoot: string
  nullifier: string
  message: string
  scope: string
  points: string[]
}

/** Rebuild the group from the public roll and check it matches the root frozen on chain. */
export function buildGroup(commitments: readonly string[], frozenRoot: string): Group {
  const group = new Group(commitments.map((c) => BigInt(c)))
  if (group.root.toString() !== BigInt(frozenRoot).toString()) {
    throw new Error("The roll served by the API does not match the root frozen on chain. Do not vote; report this.")
  }
  return group
}

/** Where the proving files (semaphore-<depth>.wasm / .zkey) are served from. Production serves them from the
 * site itself (set at build time), so voting doesn't depend on, or reveal voters to, a third-party server.
 * Unset (development): the library downloads them from its default public host. */
const ARTIFACTS = process.env.NEXT_PUBLIC_SNARK_ARTIFACTS_URL?.replace(/\/$/, "")

/** The circuit depth the proof will use: the length of the member's Merkle proof (at least 1). */
export function treeDepth(group: Group, index: number): number {
  return Math.max(1, group.generateMerkleProof(index).siblings.length)
}

export async function proveBallot(
  identity: Identity,
  group: Group,
  ballot: Uint8Array,
  scope: string,
): Promise<ProofPayload> {
  const index = group.indexOf(identity.commitment)
  if (index < 0) throw new Error("Your identity is not in the frozen roll for this election")
  const depth = treeDepth(group, index)
  const artifacts = ARTIFACTS ? { wasm: `${ARTIFACTS}/semaphore-${depth}.wasm`, zkey: `${ARTIFACTS}/semaphore-${depth}.zkey` } : undefined
  const p = await generateProof(identity, group, messageFor(ballot), BigInt(scope), depth, artifacts)
  return {
    merkleTreeDepth: p.merkleTreeDepth,
    merkleTreeRoot: p.merkleTreeRoot.toString(),
    nullifier: p.nullifier.toString(),
    message: p.message.toString(),
    scope: p.scope.toString(),
    points: p.points.map((x) => x.toString()),
  }
}
