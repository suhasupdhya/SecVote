# SecVote v2 threat model

Scope: institutional elections (student council, clubs, associations). This model does not cover government elections.

## Assets
1. **Ballot secrecy**: nobody can link a ballot to a person.
2. **Eligibility**: only approved voters vote, and each votes at most once.
3. **Integrity**: every ballot cast is counted as cast, and the count is reproducible by anyone.
4. **Availability**: a voter can cast a ballot during the voting window.
5. **Personal data**: email, reg no, and ID-proof files.

## Trust assumptions
- The voter's device is not compromised (see Limitations).
- The chain (Anvil locally, a public testnet for the demo) executes contracts correctly and is publicly readable.
- Semaphore v4 circuits and verifier are sound (audited, widely used).
- Election officials decide eligibility honestly *enough*. Their power is limited to the registration window and is publicly visible (member count, events).

## Attackers and controls (STRIDE)

| Attacker | Threat (STRIDE) | Control |
|---|---|---|
| **Outside attacker** | Spoofing: logs in as a voter or admin | Argon2id passwords; email OTP (HMAC + pepper, 5 attempts, 5 min TTL); httpOnly SameSite cookies + CSRF; rate limits |
| | Tampering: edits ballots in transit | The ballot is bound to the proof (`message = keccak(ballot)`); the contract rejects any change |
| | Information disclosure: reads the DB | The DB holds no person ↔ nullifier/ballot link; ID files are stored outside the web root and purged after results |
| | DoS on the relayer | Anonymous endpoint behind rate limits; **self-submit escape hatch** (the voter sends the proof from any wallet) |
| **Malicious voter** | Double voting | Nullifier = H(identity secret, scope), stored on-chain; second use reverts (`Election__NullifierUsed`) |
| | Voting in another election with the same proof | `scope` is per election (chainId + address); mismatch reverts |
| | Front-running another voter's proof to burn it | Election keeps its own nullifier set and uses `verifyProof` (view); `Semaphore.validateProof` griefing has no effect (tested) |
| | Uploading malicious files | Type allow-list via magic bytes, 5 MB cap, random names, served only to reviewers |
| **Dishonest admin** | Adding ghost voters mid-election (v1 #5) | `addMembers` only in `[regStart, regEnd)`; `freeze()` stores `frozenRoot`; ballots must use `frozenRoot` exactly |
| | Quietly pausing or closing (v1 #6) | Phases enforced by contract timestamps; pause is on-chain, officer-only and emits events |
| | Approving fake registrations | Two-person approval for high-stakes elections; the public member count can be compared with the official roll; hash-chained audit log |
| | Seeing who voted for whom | Impossible by design: the server never sees the identity secret, and the commitment is never revealed by a proof |
| **Compromised server** | Casting votes for voters (v1 #3) | The server has no voter secrets and cannot build proofs |
| | Swapping or dropping relayed ballots | Swap fails because the proof is bound to the ballot; drops are detected by the ballot tracker plus the self-submit escape hatch |
| | Timing correlation of login to ballot | `POST /ballots` sends no cookies and logs no IP or user; the client adds a random delay; self-submit avoids the server entirely |
| | Silently redeploying the chain (v1 #7) | No auto-redeploy: the API refuses to start if contract code is missing at the configured address |
| **Early results** (anyone) | Reading counts before close | Sealed mode: ballots are ECIES ciphertext on chain; the key exists only as 2-of-3 shares, each encrypted to a trustee's own browser key; the API accepts share releases only after the contract reports `Closed` |
| **Compromised server** | Swapping the encryption key | The voter's browser reads the public key from the contract, not the API |
| **Colluding trustees** | Decrypting early | Shamir 2-of-3 spread across separate groups; documented as a residual risk (ADR 0002) |
| **Dishonest dealer** | Keeping a copy of the key at the ceremony | Residual risk: the officer's browser sees the key once (DKG is future work); every ceremony is audit-logged |
| **Dishonest tally** | Declaring a false result | Anyone recounts from chain data with `/verify` or the CLI and compares with the declared hash |

## v1 attack → v2 test mapping
| v1 issue | Test |
|---|---|
| #1 votes linkable | `ballots` collection has no user field (API model test); proof reveals no commitment |
| #2 Merkle proof not ZK | `test_Real_*` (Groth16 Semaphore proofs) |
| #4 double vote after restart | `test_V1_4_RevertWhen_DoubleVote`, `test_Real_MemberVotesOnce` |
| #5 root change mid-election | `test_V1_5_*` |
| #6 pause only off-chain | `test_V1_6_RevertWhen_Paused` |
| #9 seeded admin | No seed code; `secvote-bootstrap-admin` CLI |
| #11 weak OTP | API tests: OTP attempt limit, TTL, HMAC |

## Limitations (stated openly)
- Eligibility is still trusted to officials.
- A voter can prove how they voted by revealing their secret, so vote selling is possible (MACI-style key changes are future work).
- Network metadata: the relayer sees the sender's IP. Self-submit mitigates this.
- Malware on the voter's device can change a ballot before proving.
- Generating a proof downloads circuit artifacts and takes a few seconds.
