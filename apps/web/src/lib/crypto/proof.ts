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

export async function proveBallot(
  identity: Identity,
  group: Group,
  ballot: Uint8Array,
  scope: string,
): Promise<ProofPayload> {
  if (group.indexOf(identity.commitment) < 0) throw new Error("Your identity is not in the frozen roll for this election")
  const p = await generateProof(identity, group, messageFor(ballot), BigInt(scope))
  return {
    merkleTreeDepth: p.merkleTreeDepth,
    merkleTreeRoot: p.merkleTreeRoot.toString(),
    nullifier: p.nullifier.toString(),
    message: p.message.toString(),
    scope: p.scope.toString(),
    points: p.points.map((x) => x.toString()),
  }
}
