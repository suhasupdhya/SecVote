"""Test-only stand-ins for what browsers do in a sealed election (key ceremony, trustee keys)."""

from __future__ import annotations

import json
import secrets

from ecies import decrypt, encrypt

from secvote.domain.sealed import public_key_of
from secvote.domain.shamir import N


def keypair() -> tuple[str, str]:
    sk = secrets.randbelow(N - 1) + 1
    return "0x" + sk.to_bytes(32, "big").hex(), public_key_of(sk)


def split(secret_hex: str) -> list[tuple[int, str]]:
    s = int(secret_hex, 16)
    a1 = secrets.randbelow(N - 1) + 1
    return [(x, "0x" + ((s + a1 * x) % N).to_bytes(32, "big").hex()) for x in (1, 2, 3)]


def seal_share(trustee_pk: str, x: int, y: str) -> str:
    return "0x" + encrypt(trustee_pk.removeprefix("0x"), json.dumps({"x": x, "y": y}).encode()).hex()


def open_share(trustee_sk: str, encrypted: str) -> dict:  # type: ignore[type-arg]
    return json.loads(decrypt(trustee_sk.removeprefix("0x"), bytes.fromhex(encrypted.removeprefix("0x"))))


def seal_ballot(election_pk: str, plaintext: bytes) -> bytes:
    return bytes(encrypt(election_pk.removeprefix("0x"), plaintext))
