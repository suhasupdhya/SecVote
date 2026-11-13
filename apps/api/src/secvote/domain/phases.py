from __future__ import annotations

from datetime import UTC, datetime

from secvote.domain.enums import Phase


def now_utc() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    """Mongo returns naive datetimes; they are always UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def phase_at(
    t: datetime, reg_start: datetime, reg_end: datetime, vote_start: datetime, vote_end: datetime
) -> Phase:
    t = as_utc(t)
    if t < as_utc(reg_start):
        return Phase.PENDING
    if t < as_utc(reg_end):
        return Phase.REGISTRATION
    if t < as_utc(vote_start):
        return Phase.AWAITING_VOTE
    if t < as_utc(vote_end):
        return Phase.VOTING
    return Phase.CLOSED


def validate_schedule(
    reg_start: datetime, reg_end: datetime, vote_start: datetime, vote_end: datetime
) -> None:
    if not (as_utc(reg_start) < as_utc(reg_end) <= as_utc(vote_start) < as_utc(vote_end)):
        raise ValueError("schedule must satisfy reg_start < reg_end <= vote_start < vote_end")
