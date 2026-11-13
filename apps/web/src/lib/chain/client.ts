// Direct, read-only chain access. The browser checks critical facts (frozen root, scope, phase)
// against the contract itself instead of trusting the API.
import { createPublicClient, defineChain, http, type Address } from "viem"
import { electionAbi } from "@secvote/shared/contracts"

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337)

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 31337 ? "Anvil (local)" : `Chain ${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })

export async function readElectionFacts(address: Address) {
  const [scope, frozen, frozenRoot, memberCount, ballotCount, mode, publicKey] = await Promise.all([
    publicClient.readContract({ address, abi: electionAbi, functionName: "scope" }),
    publicClient.readContract({ address, abi: electionAbi, functionName: "frozen" }),
    publicClient.readContract({ address, abi: electionAbi, functionName: "frozenRoot" }),
    publicClient.readContract({ address, abi: electionAbi, functionName: "memberCount" }),
    publicClient.readContract({ address, abi: electionAbi, functionName: "ballotCount" }),
    publicClient.readContract({ address, abi: electionAbi, functionName: "mode" }),
    publicClient.readContract({ address, abi: electionAbi, functionName: "publicKey" }),
  ])
  // The sealed-ballot public key is read from the CHAIN, never trusted from the API.
  return { scope, frozen, frozenRoot, memberCount, ballotCount, sealed: mode === 1, publicKey }
}

export { electionAbi }
