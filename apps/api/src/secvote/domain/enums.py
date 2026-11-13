from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    VOTER = "voter"
    OWNER = "owner"  # shown as "Super admin": also an admin; the only role that can make or remove admins
    ADMIN = "admin"
    OFFICER = "officer"
    TRUSTEE = "trustee"
    OBSERVER = "observer"


class ElectionStatus(StrEnum):
    DRAFT = "draft"  # editable, not on chain
    DEPLOYING = "deploying"  # create_election tx queued
    PUBLISHED = "published"  # on chain; phase comes from timestamps
    FAILED = "failed"  # deployment failed


class Phase(StrEnum):
    """Mirror of Election.Phase on-chain (derived from timestamps)."""

    PENDING = "pending"
    REGISTRATION = "registration"
    AWAITING_VOTE = "awaiting_vote"
    VOTING = "voting"
    CLOSED = "closed"


class BallotMode(StrEnum):
    OPEN = "open"
    SEALED = "sealed"  # Phase 4


class RegistrationStatus(StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"  # waiting for the voter's browser to submit a commitment
    REJECTED = "rejected"
    COMMITMENT_SUBMITTED = "commitment_submitted"  # queued for addMembers
    ENROLLED = "enrolled"  # commitment is in the on-chain group


class TxKind(StrEnum):
    CREATE_ELECTION = "create_election"
    ADD_MEMBERS = "add_members"
    REPLACE_MEMBER = "replace_member"  # lost-passphrase reset, before the roll is frozen
    FREEZE = "freeze"
    CAST_BALLOT = "cast_ballot"
    PAUSE = "pause"
    UNPAUSE = "unpause"
    DECLARE_RESULT = "declare_result"
    END_REGISTRATION = "end_registration"
    START_VOTING = "start_voting"
    END_VOTING = "end_voting"
    REVEAL_KEY = "reveal_key"


class TxStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    CONFIRMED = "confirmed"
    FAILED = "failed"
