# Ballot format (v1)

The one spec that the browser (`apps/web/src/lib/crypto/ballot.ts`), the API (`secvote.domain.ballot`), the contract (`packages/contracts/src/BallotFormat.sol`) and any independent verifier implement. If they disagree, this document wins and the code is a bug.

## Open ballot: version 1, mode 0

The ballot is a fixed **64 bytes**.

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | 1 | version | `0x01` |
| 1 | 1 | mode | `0x00` (open) |
| 2 | 1 | raceCount `R` | Must equal the election's number of races (1–32) |
| 3 | R | choices | One byte per race, in race order (see below) |
| 3+R | 61−R | padding | All `0x00`. Non-zero padding is rejected, so every ballot has exactly one encoding |

Each choice byte means:

- `0 … n−1`: the index of a candidate in that race (n ≤ 200)
- `0xFE`: **NOTA**, accepted only if the election has `allowNota = true`
- `0xFF`: **ABSTAIN**, leaving that race blank

Candidate indexes follow the order in which candidates appear in the election's race definition at freeze time. The API stores that order, and it never changes after registration opens.

## Binding the ballot to the proof

```
message = uint256(keccak256(ballotBytes))
scope   = Election.scope() = uint256(keccak256(abi.encode(chainId, electionAddress)))
```

The Semaphore proof is generated with this `message` and `scope`. `Election.castBallot` recomputes both and rejects any mismatch. A relayer that changes even one byte of the ballot invalidates the proof.

Semaphore hashes `message` and `scope` again inside the circuit, using `keccak256(x) >> 8` to fit the SNARK field. Callers pass the raw `uint256`.

## Results layout

`Election.results(race)` returns `n + 2` counts: `[candidate 0, …, candidate n−1, NOTA, ABSTAIN]`.

## Sealed ballot: version 2, mode 1

Sealed ballots support both race methods: plurality and instant-runoff (IRV).

### Plaintext: always exactly 256 bytes

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | 1 | version | `0x02` |
| 1 | 1 | mode | `0x01` (sealed) |
| 2 | 1 | raceCount `R` | Must equal the election's number of races |
| 3 | … | races | For each race in order: one byte `k` (number of choices), then `k` choice bytes |
| … | … | padding | All `0x00` to byte 255. Non-zero padding makes the ballot invalid |

Each race block means:

- **`k = 0`:** blank for that race (counted as *abstain*).
- **Plurality race:** `k ≤ 1`. The choice is a candidate index `< n`, or `0xFE` (NOTA) if the election allows it.
- **IRV race:** `k ≤ n`, with distinct candidate indexes `< n`, most-preferred first. NOTA is not allowed in IRV races.

The plaintext is fixed at 256 bytes, so the ciphertext length leaks nothing. Every ballot, whatever it says, encrypts to the same size.

### Ciphertext: always exactly 353 bytes

ECIES on secp256k1, as produced by `eciesjs` 0.5 and `eciespy` 0.4 with their default configuration:

```
65 bytes  ephemeral public key (uncompressed)
16 bytes  AES-256-GCM nonce
16 bytes  AES-256-GCM tag
256 bytes encrypted plaintext
```

The key is derived with HKDF-SHA256 over `ephemeralPK ‖ sharedPoint`. The contract checks only the length, and `message = keccak256(ciphertext)` binds the proof to it.

The election **public key** (33-byte compressed secp256k1) is fixed in the contract at creation. The browser reads it **from the chain**, not from the API, before encrypting.

### Invalid sealed ballots

A ballot that fails to decrypt, has the wrong header, has a race block that breaks the rules above, or has non-zero padding is **invalid**. It is still on the bulletin board and is counted in every race's `invalid` total, so it never silently disappears.

## Counting rules

- **Plurality:** one count per candidate, plus `nota`, `abstain` and `invalid`. The winner is the unique highest count above zero; a tie, or no votes, gives `winner = -1`.
- **IRV:** ballots with `k = 0` are `abstain` and take no part in the rounds. In each round, every ballot counts for its highest-ranked candidate still in the race; a ballot with none left is `exhausted`.
  - A candidate with **more than half** of that round's counted ballots wins.
  - If only one candidate remains, they win.
  - If no ballots are counted, `winner = -1`.
  - Otherwise the candidate with the fewest votes is eliminated. **Ties go to the highest index**, so the result is deterministic and anyone can reproduce it.

## Result hash

The declared result is `keccak256(utf8(canonicalJson(result)))`, where `result` is built **only from chain data**, so an outsider can rebuild it with just an RPC URL and the contract address:

```json
{"mode":"sealed","races":[
  {"abstain":0,"counts":[3,1],"invalid":0,"method":"plurality","nota":1,"winner":0},
  {"abstain":1,"first":[2,2,1],"invalid":0,"method":"irv",
   "rounds":[{"counts":[2,2,1],"exhausted":0},{"counts":[3,2,0],"exhausted":0}],"winner":0}
],"v":2}
```

Canonical JSON means:
- object keys sorted,
- no whitespace,
- integers only,
- the only strings are the fixed ASCII values shown above.

Races appear in contract order and are identified by position, not by off-chain IDs. Open-mode elections use the same structure with `"mode":"open"`, every race `"method":"plurality"`, and `invalid` always `0`. Reference implementations live in `packages/shared/src/tally.ts` and `apps/api/src/secvote/domain/tally.py`; the shared test vectors in `packages/shared/test-vectors/` keep them identical.

## Test vectors

| Choices (2 races) | Hex (first 8 bytes, rest zero) |
|---|---|
| `[1, 0]` | `01 00 02 01 00 00 00 00` |
| `[NOTA, ABSTAIN]` | `01 00 02 fe ff 00 00 00` |
