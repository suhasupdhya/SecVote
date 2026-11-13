"""Beanie documents.

Rule: nothing here links a person to a nullifier or a ballot. `Ballot` has no user field, ever.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from secvote.domain.enums import (
    BallotMode,
    ElectionStatus,
    RegistrationStatus,
    Role,
    TxKind,
    TxStatus,
)
from secvote.domain.phases import now_utc


class User(Document):
    email: str  # validated as EmailStr at the API boundary
    name: str
    password_hash: str
    roles: list[Role] = Field(default_factory=lambda: [Role.VOTER])
    email_verified: bool = False
    created_at: datetime = Field(default_factory=now_utc)
    deleted_at: datetime | None = None
    # Sessions issued before this moment are rejected (set when the password is reset).
    sessions_valid_after: datetime | None = None

    class Settings:
        name = "users"
        indexes = [IndexModel([("email", ASCENDING)], unique=True)]

    def has_role(self, role: Role) -> bool:
        return role in self.roles


class VoterProfile(Document):
    user_id: PydanticObjectId
    reg_no: str
    department: str
    year: int

    class Settings:
        name = "voter_profiles"
        indexes = [
            IndexModel([("user_id", ASCENDING)], unique=True),
            IndexModel([("reg_no", ASCENDING)], unique=True),
        ]


class Candidate(BaseModel):
    id: str
    name: str
    manifesto: str = ""


class Race(BaseModel):
    id: str
    title: str
    seats: int = 1
    method: str = "plurality"  # "plurality" | "irv" (irv: sealed elections only)
    candidates: list[Candidate]


class Election(Document):
    slug: str
    title: str
    org: str
    description: str = ""
    races: list[Race]
    allow_nota: bool = True
    mode: BallotMode = BallotMode.OPEN
    high_stakes: bool = False
    reg_start: datetime
    reg_end: datetime
    vote_start: datetime
    vote_end: datetime
    status: ElectionStatus = ElectionStatus.DRAFT
    created_by: PydanticObjectId
    created_at: datetime = Field(default_factory=now_utc)
    # Off-chain eligibility list (see EligibleVoter). When set, only listed registration numbers may apply.
    eligible_only: bool = False

    # chain mirror (filled by the worker / indexer)
    ref: str | None = None  # bytes32 hex
    chain_address: str | None = None
    scope: str | None = None  # decimal string
    deploy_block: int | None = None
    frozen: bool = False
    frozen_root: str | None = None
    member_count: int = 0
    paused: bool = False
    ballot_count: int = 0
    result_hash: str | None = None
    public_key: str | None = None  # sealed mode: 0x compressed secp256k1, set by the key ceremony
    ceremony_at: datetime | None = None
    revealed_key: str | None = None  # sealed mode: published on chain after close
    result: dict[str, Any] | None = None  # canonical v2 result (sealed: computed by the worker after reveal)
    chain_error: str | None = None  # e.g. "contract missing: the chain was reset"

    class Settings:
        name = "elections"
        indexes = [
            IndexModel([("slug", ASCENDING)], unique=True),
            IndexModel([("chain_address", ASCENDING)], sparse=True),
        ]


class Registration(Document):
    user_id: PydanticObjectId
    election_id: PydanticObjectId
    status: RegistrationStatus = RegistrationStatus.PENDING_REVIEW
    reg_no: str
    department: str
    year: int
    document_id: PydanticObjectId | None = None
    approvals: list[PydanticObjectId] = Field(default_factory=list)
    rejected_by: PydanticObjectId | None = None
    reject_reason: str | None = None
    # 1 for the first application; a rejected voter may re-apply once (see registrations.MAX_ATTEMPTS).
    attempts: int = 1
    previous_reject_reason: str | None = None  # why the earlier attempt was rejected, shown to reviewers
    auto_approved: bool = False  # approved because the reg no was on the election's eligibility list
    commitment: str | None = None  # decimal string; public by design
    # One-time enrolment code emailed on approval (HMAC only; never the voting key).
    enrol_code_hash: str | None = None
    enrol_code_expires: datetime | None = None
    enrol_code_sent_at: datetime | None = None
    enrol_code_attempts: int = 0
    added_tx_id: PydanticObjectId | None = None
    member_index: int | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

    class Settings:
        name = "registrations"
        indexes = [
            IndexModel([("election_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
            IndexModel(
                [("election_id", ASCENDING), ("commitment", ASCENDING)],
                unique=True,
                partialFilterExpression={"commitment": {"$type": "string"}},
            ),
            IndexModel([("election_id", ASCENDING), ("status", ASCENDING)]),
        ]


class StoredDocument(Document):
    owner_id: PydanticObjectId
    election_id: PydanticObjectId
    kind: str = "id_proof"
    path: str  # relative to settings.upload_dir
    content_type: str
    size: int
    sha256: str
    delete_after: datetime | None = None
    created_at: datetime = Field(default_factory=now_utc)

    class Settings:
        name = "documents"


class ChainTx(Document):
    """Transaction outbox. Every on-chain write starts here."""

    kind: TxKind
    election_id: PydanticObjectId | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    status: TxStatus = TxStatus.PENDING
    nonce: int | None = None
    tx_hash: str | None = None
    raw_tx: str | None = None
    block_number: int | None = None
    attempts: int = 0
    error: str | None = None
    ballot_id: str | None = None  # cast_ballot only: anonymous receipt id
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

    class Settings:
        name = "chain_txs"
        indexes = [
            IndexModel([("status", ASCENDING), ("created_at", ASCENDING)]),
            IndexModel(
                [("ballot_id", ASCENDING)],
                unique=True,
                partialFilterExpression={"ballot_id": {"$type": "string"}},
            ),
            IndexModel([("kind", ASCENDING), ("payload.nullifier", ASCENDING)]),
            IndexModel([("nonce", ASCENDING)]),
        ]


class Ballot(Document):
    """Indexed copy of a BallotCast event. No user field, ever."""

    election_id: PydanticObjectId
    nullifier: str
    index: int
    ballot: str  # hex
    tx_hash: str
    block_number: int
    block_time: datetime
    ballot_id: str | None = None  # set when the ballot came through our relay

    class Settings:
        name = "ballots"
        indexes = [
            IndexModel([("election_id", ASCENDING), ("nullifier", ASCENDING)], unique=True),
            IndexModel([("election_id", ASCENDING), ("index", ASCENDING)]),
            IndexModel([("ballot_id", ASCENDING)], sparse=True),
        ]


class Member(Document):
    """Indexed copy of the on-chain roll (MembersAdded events), in tree order."""

    election_id: PydanticObjectId
    index: int
    commitment: str

    class Settings:
        name = "members"
        indexes = [IndexModel([("election_id", ASCENDING), ("index", ASCENDING)], unique=True)]


class ChainCursor(Document):
    key: str  # contract address or "clock"
    block: int = 0
    value: int = 0  # for "clock": chain-time offset in seconds

    class Settings:
        name = "chain_cursor"
        indexes = [IndexModel([("key", ASCENDING)], unique=True)]


class AuditEvent(Document):
    seq: int
    actor_id: PydanticObjectId | None
    action: str
    target: str
    data: dict[str, Any] = Field(default_factory=dict)
    at: datetime = Field(default_factory=now_utc)
    prev_hash: str
    hash: str

    class Settings:
        name = "audit_events"
        indexes = [IndexModel([("seq", DESCENDING)], unique=True)]


class ElectionTrustee(Document):
    """One of the three key holders for a sealed election. The server never sees a share in plaintext
    before voting closes: it stores only the share encrypted to the trustee's own browser-held key."""

    election_id: PydanticObjectId
    user_id: PydanticObjectId
    slot: int  # 1..3 (also the Shamir x-coordinate)
    trustee_public_key: str | None = None  # 0x compressed secp256k1, generated in the trustee's browser
    encrypted_share: str | None = None  # hex ECIES ciphertext (to trustee_public_key)
    share: str | None = None  # 0x hex, uploaded by the trustee only after voting has closed
    share_uploaded_at: datetime | None = None
    created_at: datetime = Field(default_factory=now_utc)

    class Settings:
        name = "trustees"
        indexes = [
            IndexModel([("election_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
            IndexModel([("election_id", ASCENDING), ("slot", ASCENDING)], unique=True),
            IndexModel([("user_id", ASCENDING)]),
        ]


class EligibleVoter(Document):
    """A registration number the election office has pre-approved for one election.
    Matching applicants are approved without manual review. Never exposed publicly."""

    election_id: PydanticObjectId
    reg_no: str  # normalised: stripped, upper-case

    class Settings:
        name = "eligible_voters"
        indexes = [IndexModel([("election_id", ASCENDING), ("reg_no", ASCENDING)], unique=True)]


ALL_MODELS: list[type[Document]] = [
    User,
    VoterProfile,
    Election,
    EligibleVoter,
    Registration,
    StoredDocument,
    ChainTx,
    Ballot,
    Member,
    ChainCursor,
    AuditEvent,
    ElectionTrustee,
]
