"""Shamir share recombination over the secp256k1 group order. Mirrors packages/shared/src/shamir.ts.

The API only ever *combines* shares, and only after voting has closed. Splitting happens in the
officer's browser during the key ceremony.
"""

from __future__ import annotations

from collections.abc import Sequence

N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def combine(shares: Sequence[tuple[int, int]]) -> int:
    if len(shares) < 2:
        raise ValueError("need at least 2 shares")
    if len({x for x, _ in shares}) != len(shares):
        raise ValueError("duplicate share")
    secret = 0
    for xa, ya in shares:
        num, den = 1, 1
        for xb, _ in shares:
            if xa == xb:
                continue
            num = num * (-xb) % N
            den = den * (xa - xb) % N
        secret = (secret + ya * num * pow(den, N - 2, N)) % N
    return secret
