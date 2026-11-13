"""Anonymous ballot relay.

POST /ballots carries no session and is never tied to a person. We do cheap checks, simulate the
call, and queue it in the outbox. The relayer cannot swap the ballot (proof.message binds it) and
cannot forge proofs (it has no secrets).
"""

from __future__ import annotations

import secrets
from typing import Any

from pydantic import BaseModel, Field

from secvote.chain import get_chain
from secvote.core.config import Settings
from secvote.core.errors import AppError, Conflict, NotFound, WrongPhase
from secvote.db.models import Ballot, ChainTx, Election
from secvote.domain import ballot as fmt
from secvote.domain.enums import BallotMode, ElectionStatus, Phase, TxKind, TxStatus
from secvote.services import txs
from secvote.services.elections import get, phase_of


class ProofIn(BaseModel):
    merkleTreeDepth: int = Field(ge=1, le=32)
    merkleTreeRoot: str
    nullifier: str
    message: str
    scope: str
    points: list[str] = Field(min_length=8, max_length=8)


class BallotIn(BaseModel):
    election_id: str
    proof: ProofIn
    ballot: str = Field(pattern=r"^0x[0-9a-fA-F]+$", max_length=2 + 2 * fmt.SEALED_BALLOT_SIZE)


def _int(v: str) -> int:
    try:
        return int(v, 0) if v.startswith("0x") else int(v)
    except ValueError:
        raise AppError("Malformed proof", code="bad_proof") from None


async def submit(settings: Settings, data: BallotIn) -> dict[str, Any]:
    e: Election = await get(data.election_id)
    if e.status != ElectionStatus.PUBLISHED or not e.chain_address:
        raise NotFound("Election not found")
    if await phase_of(e) != Phase.VOTING:
        raise WrongPhase("Voting is not open")
    if not e.frozen or e.frozen_root is None:
        raise WrongPhase("The roll is not frozen yet")

    raw = bytes.fromhex(data.ballot[2:])
    if e.mode == BallotMode.SEALED:
        # Encrypted: we cannot (and must not be able to) read it. Only the size is checked.
        if len(raw) != fmt.SEALED_BALLOT_SIZE:
            raise AppError("Invalid sealed ballot size", code="bad_ballot")
    else:
        try:
            fmt.decode_open(raw, [len(r.candidates) for r in e.races], e.allow_nota)
        except fmt.BallotFormatError as exc:
            raise AppError(f"Invalid ballot: {exc}", code="bad_ballot") from None

    p = data.proof
    if _int(p.scope) != int(e.scope or 0):
        raise AppError("Proof is for a different election", code="wrong_scope")
    if _int(p.message) != fmt.message_for(raw):
        raise AppError("Proof is not bound to this ballot", code="message_mismatch")
    if _int(p.merkleTreeRoot) != int(e.frozen_root):
        raise AppError("Proof does not use the frozen roll", code="wrong_root")
    nullifier = str(_int(p.nullifier))
    if await Ballot.find_one(Ballot.election_id == e.id, Ballot.nullifier == nullifier):
        raise Conflict("A ballot with this nullifier was already cast", code="already_voted")
    if await ChainTx.find_one(
        {
            "kind": TxKind.CAST_BALLOT.value,
            "payload.nullifier": nullifier,
            "status": {"$in": ["pending", "sent"]},
        }
    ):
        raise Conflict("This ballot is already being submitted", code="already_submitted")

    proof = {k: str(_int(v)) if isinstance(v, str) else v for k, v in p.model_dump().items() if k != "points"}
    proof["points"] = [str(_int(x)) for x in p.points]
    reason = await get_chain(settings).simulate_cast(e.chain_address, proof, raw)
    if reason is not None:
        if "NullifierUsed" in reason or "SameNullifier" in reason:  # cast on chain, not indexed yet
            raise Conflict("A ballot with this nullifier was already cast", code="already_voted")
        raise AppError(f"The contract would reject this ballot: {reason}", code="simulation_failed")

    ballot_id = secrets.token_urlsafe(12)
    await txs.enqueue(
        TxKind.CAST_BALLOT,
        e.id,
        {"address": e.chain_address, "proof": proof, "ballot": data.ballot.lower(), "nullifier": nullifier},
        ballot_id=ballot_id,
    )
    return {"ballot_id": ballot_id, "nullifier": nullifier, "status": TxStatus.PENDING}


async def status(ballot_id: str) -> dict[str, Any]:
    tx = await ChainTx.find_one(ChainTx.ballot_id == ballot_id)
    if tx is None or tx.kind != TxKind.CAST_BALLOT:
        raise NotFound("Unknown ballot id")
    indexed = await Ballot.find_one(Ballot.ballot_id == ballot_id)
    return {
        "ballot_id": ballot_id,
        "election_id": str(tx.election_id),
        "status": tx.status,
        "tx_hash": tx.tx_hash,
        "block_number": tx.block_number,
        "nullifier": tx.payload.get("nullifier"),
        "on_bulletin": indexed is not None,
        "index": indexed.index if indexed else None,
        "error": tx.error if tx.status == TxStatus.FAILED else None,
    }


async def bulletin(e: Election, skip: int = 0, limit: int = 100) -> dict[str, Any]:
    q = Ballot.find(Ballot.election_id == e.id)
    total = await q.count()
    items = await q.sort("+index").skip(skip).limit(min(limit, 500)).to_list()
    return {
        "total": total,
        "items": [
            {
                "index": b.index,
                "nullifier": b.nullifier,
                # Open-mode ballot bytes reveal choices, so they stay hidden until results are published.
                # Open ballots reveal choices, so they stay hidden until results are published.
                # Sealed ballots are ciphertext and are always shown.
                "ballot": b.ballot if (e.result_hash or e.mode == BallotMode.SEALED) else None,
                "tx_hash": b.tx_hash,
                "block_number": b.block_number,
                "block_time": b.block_time,
            }
            for b in items
        ],
    }
