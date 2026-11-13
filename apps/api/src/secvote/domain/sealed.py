"""ECIES (eciespy, default config) — compatible with eciesjs in the browser."""

from __future__ import annotations

from ecies import decrypt
from eth_keys import keys  # type: ignore[attr-defined]


def public_key_of(secret_key: int) -> str:
    """0x-prefixed compressed secp256k1 public key (33 bytes), as eciesjs prints it."""
    pk = keys.PrivateKey(secret_key.to_bytes(32, "big")).public_key
    return "0x" + pk.to_compressed_bytes().hex()


def open_ballot(secret_key_hex: str, ciphertext: bytes) -> bytes | None:
    """Decrypt one sealed ballot. None if it does not decrypt (counted as invalid)."""
    try:
        return bytes(decrypt(secret_key_hex.removeprefix("0x"), ciphertext))
    except Exception:
        return None
