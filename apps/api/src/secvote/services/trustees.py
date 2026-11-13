"""Trustees and the 2-of-3 key ceremony for sealed elections (docs/adr/0002-sealed-ballots.md).

Lifecycle:
1. An admin adds three trustees to a draft sealed election.
2. Each trustee's browser makes a personal key pair and registers the public key.
3. The officer's browser runs the ceremony: makes the election key, splits it 2-of-3, encrypts each
   share to one trustee's public key, and uploads ONLY the election public key + encrypted shares.
4. After voting closes, trustees decrypt their share in the browser and upload it. With two valid
   shares the API rebuilds the key, checks it against the public key, and queues `revealKey`.
"""

from __future__ import annotations

import re
from itertools import combinations
from typing import Any

from beanie import PydanticObjectId
from pydantic import BaseModel, Field

from secvote.core.errors import AppError, Conflict, Forbidden, NotFound, WrongPhase
from secvote.db.models import Election, ElectionTrustee, User
from secvote.domain.enums import BallotMode, ElectionStatus, Phase, Role, TxKind
from secvote.domain.phases import now_utc
from secvote.domain.sealed import public_key_of
from secvote.domain.shamir import N, combine
from secvote.services import audit, txs
from secvote.services.auth import require_role
from secvote.services.elections import get, phase_of

TRUSTEES = 3
THRESHOLD = 2
_PUBKEY = re.compile(r"^0x0[23][0-9a-fA-F]{64}$")
_HEX = re.compile(r"^0x[0-9a-fA-F]+$")


class CeremonyShareIn(BaseModel):
    trustee_id: str
    encrypted_share: str = Field(max_length=2 + 2 * 1024)


class CeremonyIn(BaseModel):
    public_key: str
    shares: list[CeremonyShareIn] = Field(min_length=TRUSTEES, max_length=TRUSTEES)


def _check_pubkey(pk: str) -> str:
    if not _PUBKEY.match(pk):
        raise AppError("Expected a 33-byte compressed secp256k1 public key (0x02… or 0x03…)", code="bad_key")
    return pk.lower()


async def _draft_sealed(election_id: str) -> Election:
    e = await get(election_id)
    if e.mode != BallotMode.SEALED:
        raise AppError("Trustees are only used for sealed elections", code="not_sealed")
    if e.status not in (ElectionStatus.DRAFT, ElectionStatus.FAILED) or e.chain_address:
        raise WrongPhase("Trustees and the key ceremony are fixed once the election is published")
    return e


async def _invalidate_ceremony(e: Election) -> None:
    if e.public_key:
        e.public_key = None
        e.ceremony_at = None
        await e.save()
    await ElectionTrustee.find(ElectionTrustee.election_id == e.id).update(
        {"$set": {"encrypted_share": None}}
    )


# ---------------------------------------------------------------- admin
async def list_for(e: Election) -> list[dict[str, Any]]:
    rows = await ElectionTrustee.find(ElectionTrustee.election_id == e.id).sort("+slot").to_list()
    users = {u.id: u for u in await User.find({"_id": {"$in": [r.user_id for r in rows]}}).to_list()}
    return [
        {
            "id": str(r.id),
            "slot": r.slot,
            "name": users[r.user_id].name if r.user_id in users else "?",
            "email": users[r.user_id].email if r.user_id in users else "?",
            "public_key": r.trustee_public_key,
            "key_registered": r.trustee_public_key is not None,
            "share_issued": r.encrypted_share is not None,
            "share_uploaded": r.share is not None,
        }
        for r in rows
    ]


async def add(actor: User, election_id: str, email: str) -> ElectionTrustee:
    require_role(actor, Role.ADMIN)
    e = await _draft_sealed(election_id)
    user = await User.find_one(User.email == email.strip().lower(), User.deleted_at == None)
    if user is None or not user.email_verified:
        raise NotFound("No verified SecVote account with that email. Ask them to sign up first.")
    taken = await ElectionTrustee.find(ElectionTrustee.election_id == e.id).to_list()
    if any(t.user_id == user.id for t in taken):
        raise Conflict("Already a trustee for this election")
    if len(taken) >= TRUSTEES:
        raise Conflict(f"An election has exactly {TRUSTEES} trustees")
    slot = next(i for i in range(1, TRUSTEES + 1) if i not in {t.slot for t in taken})
    assert e.id is not None and user.id is not None
    t = ElectionTrustee(election_id=e.id, user_id=user.id, slot=slot)
    await t.insert()
    if Role.TRUSTEE not in user.roles:
        user.roles.append(Role.TRUSTEE)
        await user.save()
    await _invalidate_ceremony(e)
    await audit.record(actor.id, "trustee.add", f"election:{e.id}", {"user": str(user.id), "slot": slot})
    return t


async def remove(actor: User, election_id: str, trustee_id: str) -> None:
    require_role(actor, Role.ADMIN)
    e = await _draft_sealed(election_id)
    t = (
        await ElectionTrustee.get(PydanticObjectId(trustee_id))
        if PydanticObjectId.is_valid(trustee_id)
        else None
    )
    if t is None or t.election_id != e.id:
        raise NotFound("Trustee not found")
    await t.delete()
    await _invalidate_ceremony(e)
    await audit.record(actor.id, "trustee.remove", f"election:{e.id}", {"slot": t.slot})


async def run_ceremony(actor: User, election_id: str, data: CeremonyIn) -> Election:
    """Stores the election public key and the three *encrypted* shares. Never sees the private key."""
    require_role(actor, Role.ADMIN, Role.OFFICER)
    e = await _draft_sealed(election_id)
    pk = _check_pubkey(data.public_key)
    trustees = {
        str(t.id): t for t in await ElectionTrustee.find(ElectionTrustee.election_id == e.id).to_list()
    }
    if len(trustees) != TRUSTEES or any(t.trustee_public_key is None for t in trustees.values()):
        raise WrongPhase(f"All {TRUSTEES} trustees must register their keys first")
    if {s.trustee_id for s in data.shares} != set(trustees):
        raise AppError("Exactly one encrypted share per trustee is required", code="bad_shares")
    for s in data.shares:
        if not _HEX.match(s.encrypted_share):
            raise AppError("Encrypted share must be hex", code="bad_shares")
        t = trustees[s.trustee_id]
        t.encrypted_share = s.encrypted_share.lower()
        t.share = None
        t.share_uploaded_at = None
        await t.save()
    e.public_key = pk
    e.ceremony_at = now_utc()
    await e.save()
    await audit.record(actor.id, "election.key_ceremony", f"election:{e.id}", {"public_key": pk})
    return e


# ---------------------------------------------------------------- trustee
async def _mine(user: User, election_id: str) -> tuple[Election, ElectionTrustee]:
    require_role(user, Role.TRUSTEE)
    e = await get(election_id)
    t = await ElectionTrustee.find_one(
        ElectionTrustee.election_id == e.id, ElectionTrustee.user_id == user.id
    )
    if t is None:
        raise Forbidden("You are not a trustee for this election")
    return e, t


async def my_elections(user: User) -> list[dict[str, Any]]:
    rows = await ElectionTrustee.find(ElectionTrustee.user_id == user.id).to_list()
    out = []
    for t in rows:
        e = await Election.get(t.election_id)
        if e is None:
            continue
        out.append(
            {
                "election_id": str(e.id),
                "slug": e.slug,
                "title": e.title,
                "org": e.org,
                "status": e.status,
                "phase": await phase_of(e) if e.status == ElectionStatus.PUBLISHED else None,
                "slot": t.slot,
                "key_registered": t.trustee_public_key is not None,
                "trustee_public_key": t.trustee_public_key,
                "ceremony_done": e.public_key is not None,
                "share_issued": t.encrypted_share is not None,
                "share_uploaded": t.share is not None,
                "key_revealed": e.revealed_key is not None,
                "vote_end": e.vote_end,
            }
        )
    return out


async def register_key(user: User, election_id: str, public_key: str) -> ElectionTrustee:
    e, t = await _mine(user, election_id)
    if e.status != ElectionStatus.DRAFT or e.chain_address:
        raise WrongPhase("Trustee keys are fixed once the election is published")
    t.trustee_public_key = _check_pubkey(public_key)
    await t.save()
    await _invalidate_ceremony(e)  # shares were encrypted to the old key
    await audit.record(user.id, "trustee.register_key", f"election:{e.id}", {"slot": t.slot})
    return t


async def my_share(user: User, election_id: str) -> dict[str, Any]:
    e, t = await _mine(user, election_id)
    if t.encrypted_share is None:
        raise NotFound("The key ceremony has not issued your share yet")
    return {
        "slot": t.slot,
        "encrypted_share": t.encrypted_share,
        "trustee_public_key": t.trustee_public_key,
        "election_public_key": e.public_key,
    }


async def upload_share(user: User, election_id: str, x: int, y: str) -> dict[str, Any]:
    """Accepted only after voting has closed. Two valid shares rebuild the key and queue revealKey."""
    e, t = await _mine(user, election_id)
    if e.status != ElectionStatus.PUBLISHED or not e.chain_address:
        raise WrongPhase("The election is not on chain")
    if await phase_of(e) != Phase.CLOSED:
        raise WrongPhase("Shares can only be released after voting has closed")
    if e.revealed_key:
        raise Conflict("The election key has already been revealed")
    if x != t.slot:
        raise AppError("That share belongs to a different trustee slot", code="wrong_slot")
    if not _HEX.match(y) or not 0 < int(y, 16) < N:
        raise AppError("Malformed share", code="bad_share")
    t.share = "0x" + int(y, 16).to_bytes(32, "big").hex()
    t.share_uploaded_at = now_utc()
    await t.save()
    await audit.record(user.id, "trustee.release_share", f"election:{e.id}", {"slot": t.slot})
    return await try_reconstruct(e)


async def try_reconstruct(e: Election) -> dict[str, Any]:
    shares = [
        (t.slot, int(t.share, 16))
        for t in await ElectionTrustee.find(ElectionTrustee.election_id == e.id).to_list()
        if t.share
    ]
    if len(shares) < THRESHOLD:
        return {"released": len(shares), "needed": THRESHOLD, "reconstructed": False}
    for subset in combinations(shares, THRESHOLD):
        secret = combine(list(subset))
        if public_key_of(secret) == e.public_key:
            assert e.id is not None
            if not await txs.open_tx(TxKind.REVEAL_KEY, e.id):
                await txs.enqueue(TxKind.REVEAL_KEY, e.id, {"key": "0x" + secret.to_bytes(32, "big").hex()})
                await audit.record(None, "election.key_reconstructed", f"election:{e.id}")
            return {"released": len(shares), "needed": THRESHOLD, "reconstructed": True}
    return {
        "released": len(shares),
        "needed": THRESHOLD,
        "reconstructed": False,
        "error": "The released shares don't rebuild the election key. One share is wrong; a third trustee is needed.",
    }
