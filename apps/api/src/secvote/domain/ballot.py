"""Python implementation of docs/ballot-format.md (open ballot v1). Must match BallotFormat.sol."""

from __future__ import annotations

from collections.abc import Sequence

from eth_utils import keccak

VERSION = 0x01
MODE_OPEN = 0x00
OPEN_BALLOT_SIZE = 64
SEALED_PLAINTEXT_SIZE = 256
SEALED_BALLOT_SIZE = 353  # ECIES: 65 ephemeral pk + 16 nonce + 16 tag + 256
NOTA = 0xFE
ABSTAIN = 0xFF
MAX_RACES = 32
MAX_CANDIDATES = 200


class BallotFormatError(ValueError):
    pass


def encode_open(choices: Sequence[int]) -> bytes:
    if not 1 <= len(choices) <= MAX_RACES:
        raise BallotFormatError("race count out of range")
    out = bytearray(OPEN_BALLOT_SIZE)
    out[0] = VERSION
    out[1] = MODE_OPEN
    out[2] = len(choices)
    for i, c in enumerate(choices):
        if not 0 <= c <= 0xFF:
            raise BallotFormatError("choice must be a byte")
        out[3 + i] = c
    return bytes(out)


def decode_open(ballot: bytes, candidate_counts: Sequence[int], allow_nota: bool) -> list[int]:
    if len(ballot) != OPEN_BALLOT_SIZE:
        raise BallotFormatError("bad length")
    if ballot[0] != VERSION or ballot[1] != MODE_OPEN:
        raise BallotFormatError("bad header")
    races = len(candidate_counts)
    if ballot[2] != races:
        raise BallotFormatError("bad race count")
    choices: list[int] = []
    for i in range(races):
        c = ballot[3 + i]
        if not (c < candidate_counts[i] or c == ABSTAIN or (allow_nota and c == NOTA)):
            raise BallotFormatError(f"bad choice {c} for race {i}")
        choices.append(c)
    if any(ballot[3 + races :]):
        raise BallotFormatError("non-canonical padding")
    return choices


def message_for(ballot: bytes) -> int:
    """Semaphore `message` that binds a proof to these exact ballot bytes."""
    return int.from_bytes(keccak(ballot), "big")
