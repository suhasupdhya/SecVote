"""Tamper-evident, hash-chained audit log of *official* actions.

Never write "voter X voted": the system cannot know it, and that is the point.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from beanie import PydanticObjectId
from pymongo.errors import DuplicateKeyError

from secvote.db.models import AuditEvent
from secvote.domain.phases import now_utc

GENESIS = "0" * 64


def _digest(
    prev_hash: str, seq: int, actor: str, action: str, target: str, data: dict[str, Any], at: str
) -> str:
    body = json.dumps(
        {
            "prev": prev_hash,
            "seq": seq,
            "actor": actor,
            "action": action,
            "target": target,
            "data": data,
            "at": at,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(body.encode()).hexdigest()


async def record(
    actor_id: PydanticObjectId | None, action: str, target: str, data: dict[str, Any] | None = None
) -> AuditEvent:
    data = data or {}
    for _ in range(10):  # retry on concurrent append (unique seq)
        last = await AuditEvent.find_all().sort("-seq").limit(1).first_or_none()
        seq = (last.seq + 1) if last else 1
        prev = last.hash if last else GENESIS
        at = now_utc().replace(microsecond=0)  # Mongo stores milliseconds; keep the hash input stable
        h = _digest(prev, seq, str(actor_id), action, target, data, at.isoformat())
        ev = AuditEvent(
            seq=seq, actor_id=actor_id, action=action, target=target, data=data, at=at, prev_hash=prev, hash=h
        )
        try:
            await ev.insert()
            return ev
        except DuplicateKeyError:
            continue
    raise RuntimeError("audit log contention")


async def verify_chain() -> bool:
    prev = GENESIS
    async for ev in AuditEvent.find_all().sort("+seq"):
        at = ev.at.replace(microsecond=0)
        if ev.prev_hash != prev or ev.hash != _digest(
            prev, ev.seq, str(ev.actor_id), ev.action, ev.target, ev.data, at.isoformat()
        ):
            return False
        prev = ev.hash
    return True
