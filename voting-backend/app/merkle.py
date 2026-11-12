from __future__ import annotations
from typing import List

"""
Merkle tree builder compatible with OpenZeppelin's MerkleProof.verify().

OpenZeppelin hashes sibling pairs in SORTED order:
    parent = keccak256( min(left, right) || max(left, right) )

This module builds the full tree from a list of leaves (already-hashed
32-byte values) and can produce a proof for any leaf.
"""
from web3 import Web3


def _hash_pair(a: bytes, b: bytes) -> bytes:
    if a <= b:
        return Web3.keccak(a + b)
    return Web3.keccak(b + a)


class MerkleTree:
    def __init__(self, leaves: List[bytes]):
        if not leaves:
            raise ValueError("MerkleTree needs at least one leaf")
        self.leaves = sorted(leaves)
        self.layers = self._build_layers(self.leaves)

    def _build_layers(self, leaves: List[bytes]) -> List[List[bytes]]:
        layers = [leaves]
        current = leaves
        while len(current) > 1:
            next_layer = []
            for i in range(0, len(current), 2):
                left = current[i]
                if i + 1 < len(current):
                    right = current[i + 1]
                else:
                    # odd node out: duplicate it against itself
                    right = left
                next_layer.append(_hash_pair(left, right))
            layers.append(next_layer)
            current = next_layer
        return layers

    @property
    def root(self) -> bytes:
        return self.layers[-1][0]

    def get_proof(self, leaf: bytes) -> List[bytes]:
        try:
            index = self.leaves.index(leaf)
        except ValueError:
            raise ValueError("Leaf not found in tree")

        proof = []
        for layer in self.layers[:-1]:
            is_right_node = index % 2 == 1
            pair_index = index - 1 if is_right_node else index + 1
            if pair_index < len(layer):
                proof.append(layer[pair_index])
            else:
                # odd node out: during tree construction this was hashed
                # against itself, so the proof must include itself too,
                # or the reconstructed root won't match.
                proof.append(layer[index])
            index //= 2
        return proof
