"""Election phases follow *chain* time, which is what the contract enforces.

The worker records `offset = max(0, latest_block_time - wall_clock)` so a local Anvil that has been
time-warped (tests, demos) and the API agree on the phase. On a public chain the offset stays ~0.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta

from secvote.db.models import ChainCursor
from secvote.domain.phases import now_utc

_CACHE: dict[str, float] = {"offset": 0.0, "read_at": 0.0}
CLOCK_KEY = "clock"


async def chain_now() -> datetime:
    if time.monotonic() - _CACHE["read_at"] > 1.0:
        doc = await ChainCursor.find_one(ChainCursor.key == CLOCK_KEY)
        _CACHE["offset"] = float(doc.value) if doc else 0.0
        _CACHE["read_at"] = time.monotonic()
    return now_utc() + timedelta(seconds=_CACHE["offset"])


async def set_offset(offset_seconds: int) -> None:
    doc = await ChainCursor.find_one(ChainCursor.key == CLOCK_KEY)
    if doc is None:
        await ChainCursor(key=CLOCK_KEY, value=offset_seconds).insert()
    elif doc.value != offset_seconds:
        doc.value = offset_seconds
        await doc.save()
    _CACHE["read_at"] = 0.0


def reset_cache() -> None:
    _CACHE["read_at"] = 0.0
