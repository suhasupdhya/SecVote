"""Enqueue on-chain writes into the outbox. Only the worker ever signs or sends."""

from __future__ import annotations

from typing import Any

from beanie import PydanticObjectId
from beanie.operators import In

from secvote.db.models import ChainTx
from secvote.domain.enums import TxKind, TxStatus

OPEN = [TxStatus.PENDING, TxStatus.SENT]


async def enqueue(
    kind: TxKind,
    election_id: PydanticObjectId | None,
    payload: dict[str, Any],
    ballot_id: str | None = None,
) -> ChainTx:
    tx = ChainTx(kind=kind, election_id=election_id, payload=payload, ballot_id=ballot_id)
    await tx.insert()
    return tx


async def open_tx(kind: TxKind, election_id: PydanticObjectId) -> ChainTx | None:
    return await ChainTx.find_one(
        ChainTx.kind == kind, ChainTx.election_id == election_id, In(ChainTx.status, OPEN)
    )
