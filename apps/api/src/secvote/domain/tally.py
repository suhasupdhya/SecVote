"""Counting rules + canonical result hash (docs/ballot-format.md). Mirrors packages/shared/src/tally.ts.

Both implementations are checked against packages/shared/test-vectors/vectors.json.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, Literal

from eth_utils import keccak

from secvote.domain.ballot import (
    ABSTAIN,
    NOTA,
    SEALED_PLAINTEXT_SIZE,
    BallotFormatError,
    decode_open,
)

Method = Literal["plurality", "irv"]
RaceSpec = tuple[int, Method]  # (candidate count, method)


def decode_sealed(pt: bytes, races: Sequence[RaceSpec], allow_nota: bool) -> list[list[int]]:
    if len(pt) != SEALED_PLAINTEXT_SIZE:
        raise BallotFormatError("bad length")
    if pt[0] != 0x02 or pt[1] != 0x01:
        raise BallotFormatError("bad header")
    if pt[2] != len(races):
        raise BallotFormatError("bad race count")
    p = 3
    out: list[list[int]] = []
    for i, (n, method) in enumerate(races):
        if p >= SEALED_PLAINTEXT_SIZE:
            raise BallotFormatError("truncated")
        k = pt[p]
        p += 1
        if p + k > SEALED_PLAINTEXT_SIZE:
            raise BallotFormatError("truncated")
        choice = list(pt[p : p + k])
        p += k
        if method == "plurality":
            if k > 1 or (k == 1 and not (choice[0] < n or (allow_nota and choice[0] == NOTA))):
                raise BallotFormatError(f"race {i}: bad choice")
        else:
            if k > n or len(set(choice)) != k or any(c >= n for c in choice):
                raise BallotFormatError(f"race {i}: bad ranking")
        out.append(choice)
    if any(pt[p:]):
        raise BallotFormatError("non-canonical padding")
    return out


def _plurality_winner(counts: list[int]) -> int:
    top = max(counts, default=0)
    if top == 0:
        return -1
    winners = [i for i, c in enumerate(counts) if c == top]
    return winners[0] if len(winners) == 1 else -1


def run_irv(n: int, rankings: Sequence[Sequence[int]]) -> tuple[list[dict[str, Any]], int]:
    """Instant-runoff. Deterministic: elimination ties go to the highest index."""
    continuing = set(range(n))
    rounds: list[dict[str, Any]] = []
    while True:
        counts = [0] * n
        exhausted = 0
        for r in rankings:
            top = next((c for c in r if c in continuing), None)
            if top is None:
                exhausted += 1
            else:
                counts[top] += 1
        rounds.append({"counts": counts, "exhausted": exhausted})
        total = sum(counts)
        if total == 0:
            return rounds, -1
        majority = next((c for c in sorted(continuing) if counts[c] * 2 > total), None)
        if majority is not None:
            return rounds, majority
        if len(continuing) == 1:
            return rounds, next(iter(continuing))
        loser = max(continuing, key=lambda c: (-counts[c], c))
        continuing.discard(loser)


def tally_open(ballots: Sequence[bytes], candidate_counts: Sequence[int], allow_nota: bool) -> dict[str, Any]:
    races: list[dict[str, Any]] = [
        {"method": "plurality", "counts": [0] * n, "nota": 0, "abstain": 0, "invalid": 0, "winner": -1}
        for n in candidate_counts
    ]
    for b in ballots:
        for i, c in enumerate(decode_open(b, candidate_counts, allow_nota)):
            r = races[i]
            if c == NOTA:
                r["nota"] += 1
            elif c == ABSTAIN:
                r["abstain"] += 1
            else:
                r["counts"][c] += 1
    for r in races:
        r["winner"] = _plurality_winner(r["counts"])
    return {"v": 2, "mode": "open", "races": races}


def tally_sealed(
    plaintexts: Sequence[bytes | None], races: Sequence[RaceSpec], allow_nota: bool
) -> dict[str, Any]:
    decoded: list[list[list[int]] | None] = []
    for pt in plaintexts:
        try:
            decoded.append(decode_sealed(pt, races, allow_nota) if pt is not None else None)
        except BallotFormatError:
            decoded.append(None)
    invalid = sum(1 for d in decoded if d is None)
    valid = [d for d in decoded if d is not None]
    out: list[dict[str, Any]] = []
    for i, (n, method) in enumerate(races):
        choices = [v[i] for v in valid]
        abstain = sum(1 for c in choices if not c)
        if method == "plurality":
            counts = [0] * n
            nota = 0
            for c in choices:
                if not c:
                    continue
                if c[0] == NOTA:
                    nota += 1
                else:
                    counts[c[0]] += 1
            out.append(
                {
                    "method": "plurality",
                    "counts": counts,
                    "nota": nota,
                    "abstain": abstain,
                    "invalid": invalid,
                    "winner": _plurality_winner(counts),
                }
            )
        else:
            rankings = [c for c in choices if c]
            first = [0] * n
            for r in rankings:
                first[r[0]] += 1
            rounds, winner = run_irv(n, rankings)
            out.append(
                {
                    "method": "irv",
                    "first": first,
                    "rounds": rounds,
                    "abstain": abstain,
                    "invalid": invalid,
                    "winner": winner,
                }
            )
    return {"v": 2, "mode": "sealed", "races": out}


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def result_hash(result: dict[str, Any]) -> str:
    return "0x" + keccak(text=canonical_json(result)).hex()


def encode_sealed(choices: Sequence[Sequence[int]], races: Sequence[RaceSpec], allow_nota: bool) -> bytes:
    """Reference encoder (the browser normally does this). Validates with decode_sealed."""
    out = bytearray(SEALED_PLAINTEXT_SIZE)
    out[0], out[1], out[2] = 0x02, 0x01, len(races)
    p = 3
    for choice in choices:
        out[p] = len(choice)
        p += 1
        for c in choice:
            out[p] = c
            p += 1
    decode_sealed(bytes(out), races, allow_nota)
    return bytes(out)
