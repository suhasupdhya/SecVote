# ADR 0002: Sealed ballots and a 2-of-3 trustee key ceremony

**Status:** accepted · 2026-11-13

## Context
Open ballots are counted on-chain as they arrive. Results are live, and anyone reading the contract can see them before polls close, which can sway late voters. We want nobody, including officials, server operators and chain readers, to learn any count until voting has closed, while keeping the result universally verifiable.

## Decision
- **Encrypt every ballot in the browser** with ECIES (secp256k1, HKDF-SHA256, AES-256-GCM) to a per-election public key. Plaintexts are padded to 256 bytes, so every ciphertext is 353 bytes.
- **Fix the public key in the contract** at creation. The voter's browser reads it from the chain, so a compromised API can't substitute its own key.
- **Split the private key 2-of-3 with Shamir** (polynomial over the secp256k1 group order) in the officer's browser during a key ceremony:
  - Each share is ECIES-encrypted to a trustee's personal key, which that trustee generated in their own browser.
  - The server stores only these encrypted shares and **never sees a share in plaintext before voting closes**.
- **Reveal after close:** each trustee decrypts their share in the browser and uploads it.
  - The API accepts shares only once the contract reports `Closed`.
  - With two shares it reconstructs the key, checks it against the public key, and the officer account publishes it via `revealKey`.
- **Tally off-chain** in the worker. Anyone can repeat the tally from `BallotCast` events plus the revealed key (verify page, `packages/verifier` CLI), and the declared `resultHash` must match.
- **Ranked-choice (IRV)** is available only for sealed elections, since open-mode tallies run on-chain and stay plurality-only.

## Consequences and limits
- **The dealer sees the key once.** The officer's browser generates the key before splitting it, so a malicious officer could keep a copy and decrypt early. A distributed key generation removes this, but that's future work.
- **Trustees can collude:** any two trustees together can decrypt early. Choose them from different groups (e.g. faculty advisor, election officer, student observer).
- **Liveness:** if two of the three trustees can't produce their shares, the election can't be tallied. That is the price of no single person being able to peek.
- **No partial results:** there is no turnout-by-candidate before close. Turnout (ballot count) stays public.
