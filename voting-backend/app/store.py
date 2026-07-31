from __future__ import annotations
from typing import Set, Dict
from fastapi import HTTPException, status
from dataclasses import dataclass, field

"""
In-memory store — tracks elections, eligible voters, secrets, and OTP verification state.
"""

@dataclass
class ElectionRecord:
    election_id: int
    address: str
    domain: str
    title: str = "Demo Election"
    eligible_voters: Set[str] = field(default_factory=set)
    secrets: Dict[str, str] = field(default_factory=dict)  # voter_id -> secret
    otp_verified: Dict[str, bool] = field(default_factory=dict) # voter_id -> is_verified
    merkle_tree: object = None  # app.merkle.MerkleTree, set once secrets are generated


class Store:
    def __init__(self):
        self.elections: Dict[int, ElectionRecord] = {}

    def add_election(self, election_id: int, address: str, domain: str, title: str = "Demo Election"):
        self.elections[election_id] = ElectionRecord(
            election_id=election_id,
            address=address,
            domain=domain,
            title=title
        )

    def get(self, election_id: int) -> ElectionRecord:
        if election_id not in self.elections:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No election registered with ID #{election_id}"
            )
        return self.elections[election_id]


store = Store()
