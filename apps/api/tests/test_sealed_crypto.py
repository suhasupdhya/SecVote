"""Python must agree with the TypeScript reference byte for byte (packages/shared/test-vectors)."""

from __future__ import annotations

import json

import pytest

from secvote.core.config import REPO_ROOT
from secvote.domain import tally
from secvote.domain.sealed import open_ballot, public_key_of
from secvote.domain.shamir import combine

VECTORS = json.loads((REPO_ROOT / "packages" / "shared" / "test-vectors" / "vectors.json").read_text())


@pytest.mark.parametrize("t", VECTORS["tallies"], ids=lambda t: t["mode"])
def test_tally_matches_typescript(t: dict) -> None:  # type: ignore[type-arg]
    if t["mode"] == "open":
        res = tally.tally_open([bytes.fromhex(b) for b in t["ballots"]], t["candidateCounts"], t["allowNota"])
    else:
        races = [(r["candidates"], r["method"]) for r in t["races"]]
        res = tally.tally_sealed(
            [bytes.fromhex(b) if b else None for b in t["ballots"]], races, t["allowNota"]
        )
    assert tally.canonical_json(res) == t["canonical"]
    assert tally.result_hash(res) == t["hash"]


def test_shamir_any_two_shares() -> None:
    sh = [(s["x"], int(s["y"], 16)) for s in VECTORS["shamir"]["shares"]]
    secret = int(VECTORS["shamir"]["secret"], 16)
    assert combine([sh[0], sh[1]]) == secret
    assert combine([sh[2], sh[0]]) == secret
    assert combine([sh[1], sh[2]]) == secret
    with pytest.raises(ValueError):
        combine([sh[0]])


def test_ecies_decrypts_browser_ciphertext() -> None:
    e = VECTORS["ecies"]
    assert public_key_of(int(e["secretKey"], 16)) == e["publicKey"]
    assert open_ballot(e["secretKey"], bytes.fromhex(e["ciphertext"])) == bytes.fromhex(e["plaintext"])
    assert open_ballot("0x" + "11" * 32, bytes.fromhex(e["ciphertext"])) is None  # wrong key -> invalid


def test_irv_rules() -> None:
    rounds, winner = tally.run_irv(3, [[0], [0], [1], [1], [2, 0]])
    assert [r["counts"] for r in rounds] == [[2, 2, 1], [3, 2, 0]] and winner == 0
    rounds, winner = tally.run_irv(3, [[0], [1], [2]])
    assert rounds[1] == {"counts": [1, 1, 0], "exhausted": 1} and winner == 0
