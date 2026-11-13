"""Response shapes. Keep serialisation in one place so nothing private leaks by accident."""

from __future__ import annotations

from typing import Any

from secvote.db.models import Election, Registration, User
from secvote.domain.enums import Phase
from secvote.domain.reapply import MAX_ATTEMPTS, can_reapply


def user_out(u: User) -> dict[str, Any]:
    return {
        "id": str(u.id),
        "email": u.email,
        "name": u.name,
        "roles": [r.value for r in u.roles],
        "email_verified": u.email_verified,
    }


def election_out(e: Election, phase: Phase | None, *, admin: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(e.id),
        "slug": e.slug,
        "title": e.title,
        "org": e.org,
        "description": e.description,
        "races": [r.model_dump() for r in e.races],
        "allow_nota": e.allow_nota,
        "mode": e.mode,
        "high_stakes": e.high_stakes,
        "eligible_only": e.eligible_only,
        "reg_start": e.reg_start,
        "reg_end": e.reg_end,
        "vote_start": e.vote_start,
        "vote_end": e.vote_end,
        "status": e.status,
        "phase": phase,
        "chain": {
            "address": e.chain_address,
            "scope": e.scope,
            "frozen": e.frozen,
            "frozen_root": e.frozen_root,
            "member_count": e.member_count,
            "ballot_count": e.ballot_count,
            "paused": e.paused,
            "result_hash": e.result_hash,
            "deploy_block": e.deploy_block,
            "error": e.chain_error,
            "public_key": e.public_key,
            "revealed_key": e.revealed_key,
        },
    }
    if admin:
        out["created_at"] = e.created_at
    return out


def registration_out(r: Registration, election: Election | None = None) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "election_id": str(r.election_id),
        "election_title": election.title if election else None,
        "election_slug": election.slug if election else None,
        "status": r.status,
        "reg_no": r.reg_no,
        "department": r.department,
        "year": r.year,
        "commitment": r.commitment,
        "member_index": r.member_index,
        "reject_reason": r.reject_reason,
        "auto_approved": r.auto_approved,
        "attempts": r.attempts,
        "max_attempts": MAX_ATTEMPTS,
        "can_reapply": can_reapply(r),
        "enrol_code_sent": r.enrol_code_hash is not None,
        "enrol_code_expires": r.enrol_code_expires,
        "created_at": r.created_at,
    }
