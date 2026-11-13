"""Election lifecycle: draft -> publish (deploy via outbox) -> phases on chain -> results."""

from __future__ import annotations

import hashlib
import re
import secrets
from collections import Counter
from datetime import datetime
from typing import Any, Literal

from beanie import PydanticObjectId
from beanie.operators import In
from eth_utils import keccak
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from secvote.core.config import Settings
from secvote.core.errors import AppError, Conflict, NotFound, WrongPhase
from secvote.db.models import Ballot, Candidate, Election, Race, User
from secvote.domain import ballot as ballot_fmt
from secvote.domain import tally as tally_mod
from secvote.domain.enums import BallotMode, ElectionStatus, Phase, Role, TxKind
from secvote.domain.phases import as_utc, phase_at, validate_schedule
from secvote.services import audit, txs
from secvote.services.auth import require_role
from secvote.services.clock import chain_now


# ---------------------------------------------------------------- input schemas
class CandidateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    manifesto: str = Field(default="", max_length=10_000)


class RaceIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    method: Literal["plurality", "irv"] = "plurality"
    candidates: list[CandidateIn] = Field(min_length=1, max_length=ballot_fmt.MAX_CANDIDATES)


class ElectionIn(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    org: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=5_000)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9-]{3,64}$")
    races: list[RaceIn] = Field(min_length=1, max_length=ballot_fmt.MAX_RACES)
    allow_nota: bool = True
    high_stakes: bool = False
    mode: BallotMode = BallotMode.OPEN
    reg_start: datetime
    reg_end: datetime
    vote_start: datetime
    vote_end: datetime


def _slugify(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48] or "election"
    return f"{base}-{secrets.token_hex(3)}"


def _short_id() -> str:
    return secrets.token_hex(4)


def ref_for(election_id: PydanticObjectId, salt: str = "") -> str:
    return "0x" + keccak(text=f"{election_id}{salt}").hex()


async def phase_of(e: Election) -> Phase:
    return phase_at(await chain_now(), e.reg_start, e.reg_end, e.vote_start, e.vote_end)


# ---------------------------------------------------------------- queries
async def get(election_id_or_slug: str) -> Election:
    e: Election | None = None
    if PydanticObjectId.is_valid(election_id_or_slug):
        e = await Election.get(PydanticObjectId(election_id_or_slug))
    if e is None:
        e = await Election.find_one(Election.slug == election_id_or_slug)
    if e is None:
        raise NotFound("Election not found")
    return e


async def get_public(election_id_or_slug: str) -> Election:
    e = await get(election_id_or_slug)
    if e.status != ElectionStatus.PUBLISHED:
        raise NotFound("Election not found")
    return e


async def list_public() -> list[Election]:
    return await Election.find(Election.status == ElectionStatus.PUBLISHED).sort("-vote_start").to_list()


async def list_all(actor: User) -> list[Election]:
    require_role(actor, Role.ADMIN, Role.OFFICER)
    return await Election.find_all().sort("-created_at").to_list()


# ---------------------------------------------------------------- drafts
def _build(data: ElectionIn) -> dict[str, Any]:
    try:
        validate_schedule(data.reg_start, data.reg_end, data.vote_start, data.vote_end)
    except ValueError as exc:
        raise AppError(str(exc), code="bad_schedule") from None
    if data.mode == BallotMode.OPEN and any(r.method != "plurality" for r in data.races):
        raise AppError("Ranked-choice races need sealed ballots", code="irv_needs_sealed")
    titles = [r.title.strip().casefold() for r in data.races]
    if len(set(titles)) != len(titles):
        raise AppError("Two posts have the same title", code="duplicate_post")
    for r in data.races:
        names = [c.name.strip().casefold() for c in r.candidates]
        if len(set(names)) != len(names):
            raise AppError(f"{r.title}: two candidates have the same name", code="duplicate_candidate")
    races = [
        Race(
            id=_short_id(),
            title=r.title,
            method=r.method,
            candidates=[Candidate(id=_short_id(), name=c.name, manifesto=c.manifesto) for c in r.candidates],
        )
        for r in data.races
    ]
    return {
        "title": data.title,
        "org": data.org,
        "description": data.description,
        "races": races,
        "allow_nota": data.allow_nota,
        "high_stakes": data.high_stakes,
        "mode": data.mode,
        "reg_start": as_utc(data.reg_start),
        "reg_end": as_utc(data.reg_end),
        "vote_start": as_utc(data.vote_start),
        "vote_end": as_utc(data.vote_end),
    }


async def create_draft(actor: User, data: ElectionIn) -> Election:
    require_role(actor, Role.ADMIN)
    assert actor.id is not None
    e = Election(slug=data.slug or _slugify(data.title), created_by=actor.id, **_build(data))
    try:
        await e.insert()
    except DuplicateKeyError:
        raise Conflict("Slug already in use", code="slug_taken") from None
    await audit.record(actor.id, "election.create", f"election:{e.id}", {"title": e.title})
    return e


async def update_draft(actor: User, election_id: str, data: ElectionIn) -> Election:
    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    # FAILED = the deployment never took (or its contract vanished); republishing deploys afresh.
    if e.status not in (ElectionStatus.DRAFT, ElectionStatus.FAILED):
        raise WrongPhase("Only drafts can be edited; the published config is on chain")
    for k, v in _build(data).items():
        setattr(e, k, v)
    if e.public_key:  # races or mode changed: the ceremony must be redone
        e.public_key = None
        e.ceremony_at = None
        await _reset_ceremony(e)
    if data.slug:
        e.slug = data.slug
    await e.save()
    await audit.record(actor.id, "election.update", f"election:{e.id}")
    return e


async def delete_draft(actor: User, election_id: str) -> None:
    """Only a draft that was never put on chain can be deleted; published elections are permanent."""
    from secvote.db.models import ElectionTrustee, EligibleVoter, Registration

    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    if e.status not in (ElectionStatus.DRAFT, ElectionStatus.FAILED) or e.chain_address or e.ref:
        raise WrongPhase("Only drafts that were never published can be deleted")
    await ElectionTrustee.find(ElectionTrustee.election_id == e.id).delete()
    await Registration.find(Registration.election_id == e.id).delete()
    await EligibleVoter.find(EligibleVoter.election_id == e.id).delete()
    await e.delete()
    await audit.record(actor.id, "election.delete_draft", f"election:{e.id}", {"title": e.title})


async def _reset_ceremony(e: Election) -> None:
    from secvote.db.models import ElectionTrustee

    await ElectionTrustee.find(ElectionTrustee.election_id == e.id).update(
        {"$set": {"encrypted_share": None}}
    )


async def _detach_from_chain(e: Election) -> None:
    """Republishing after the chain was reset: drop the dead contract's mirror so the election starts
    clean on the new chain. Approved voters keep their commitments and are re-added to the new roll."""
    from secvote.db.models import ChainCursor, ChainTx, Member, Registration
    from secvote.domain.enums import RegistrationStatus as S
    from secvote.domain.enums import TxStatus

    assert e.id is not None
    if e.chain_address:
        await ChainCursor.find(ChainCursor.key == e.chain_address.lower()).delete()
    await Member.find(Member.election_id == e.id).delete()
    await Ballot.find(Ballot.election_id == e.id).delete()
    await ChainTx.find(
        ChainTx.election_id == e.id, In(ChainTx.status, [TxStatus.PENDING, TxStatus.SENT])
    ).update({"$set": {"status": TxStatus.FAILED.value, "error": "superseded: election republished"}})
    await Registration.find(
        Registration.election_id == e.id, In(Registration.status, [S.ENROLLED, S.COMMITMENT_SUBMITTED])
    ).update({"$set": {"status": S.COMMITMENT_SUBMITTED.value, "added_tx_id": None, "member_index": None}})
    e.chain_address = e.scope = e.frozen_root = e.result_hash = None
    e.revealed_key = None
    e.result = None
    e.deploy_block = None
    e.frozen = e.paused = False
    e.member_count = e.ballot_count = 0


async def publish(actor: User, election_id: str) -> Election:
    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    if e.status not in (ElectionStatus.DRAFT, ElectionStatus.FAILED):
        raise WrongPhase("Election is already published")
    if as_utc(e.reg_end) <= await chain_now():
        # Nobody could register, so nobody could ever vote: the dates need moving first.
        raise AppError(
            "Registration would already be closed. Edit the draft's dates before publishing.",
            code="bad_schedule",
        )
    if e.mode == BallotMode.SEALED and not e.public_key:
        raise AppError("Run the trustee key ceremony before publishing a sealed election", code="no_ceremony")
    assert e.id is not None
    republish = e.ref is not None
    if e.chain_address:
        await _detach_from_chain(e)
    # A fresh deployment id on every re-publish, so it can never collide with an earlier contract.
    e.ref = ref_for(e.id, f":{secrets.token_hex(4)}" if republish else "")
    e.status = ElectionStatus.DEPLOYING
    e.chain_error = None
    await e.save()
    await txs.enqueue(
        TxKind.CREATE_ELECTION,
        e.id,
        {
            "ref": e.ref,
            "reg_start": int(as_utc(e.reg_start).timestamp()),
            "reg_end": int(as_utc(e.reg_end).timestamp()),
            "vote_start": int(as_utc(e.vote_start).timestamp()),
            "vote_end": int(as_utc(e.vote_end).timestamp()),
            "mode": 1 if e.mode == BallotMode.SEALED else 0,
            "allow_nota": e.allow_nota,
            "candidate_counts": [len(r.candidates) for r in e.races],
            "race_methods": [1 if r.method == "irv" else 0 for r in e.races],
            "public_key": e.public_key if e.mode == BallotMode.SEALED else "0x",
        },
    )
    await audit.record(actor.id, "election.publish", f"election:{e.id}", {"ref": e.ref})
    return e


# ---------------------------------------------------------------- officer actions
async def _published(election_id: str) -> Election:
    e = await get(election_id)
    if e.status != ElectionStatus.PUBLISHED or not e.chain_address:
        raise WrongPhase("Election is not on chain yet")
    return e


async def request_freeze(actor: User | None, election_id: str) -> Election:
    """Anyone may freeze on chain after reg_end; the API exposes it to officers and the worker."""
    if actor is not None:
        require_role(actor, Role.ADMIN, Role.OFFICER)
    e = await _published(election_id)
    if e.frozen:
        raise Conflict("Roll is already frozen")
    if await phase_of(e) in (Phase.PENDING, Phase.REGISTRATION):
        raise WrongPhase("Registration has not ended")
    assert e.id is not None
    if not await txs.open_tx(TxKind.FREEZE, e.id):
        await txs.enqueue(TxKind.FREEZE, e.id, {})
        await audit.record(actor.id if actor else None, "election.freeze", f"election:{e.id}")
    return e


async def set_paused(actor: User, election_id: str, paused: bool) -> Election:
    require_role(actor, Role.OFFICER)
    e = await _published(election_id)
    assert e.id is not None
    if paused and e.result_hash:
        raise WrongPhase("The result has been declared; the election is complete and can't be paused")
    kind = TxKind.PAUSE if paused else TxKind.UNPAUSE
    if not await txs.open_tx(kind, e.id):
        await txs.enqueue(kind, e.id, {})
        await audit.record(actor.id, f"election.{kind.value}", f"election:{e.id}")
    return e


async def roll_status(e: Election) -> dict[str, int]:
    """Registrations that would miss the roll if registration closed right now."""
    from secvote.db.models import Registration  # local: avoid a cycle with services.registrations
    from secvote.domain.enums import RegistrationStatus as S

    async def n(status: S) -> int:
        return await Registration.find(
            Registration.election_id == e.id, Registration.status == status
        ).count()

    return {
        "pending_review": await n(S.PENDING_REVIEW),
        "approved_no_identity": await n(S.APPROVED),
        "joining_roll": await n(S.COMMITMENT_SUBMITTED),
        "enrolled": await n(S.ENROLLED),
    }


async def shorten_schedule(
    actor: User, election_id: str, *, start_voting: bool, settings: Settings | None = None
) -> Election:
    """End registration now (and freeze the roll), optionally opening voting immediately.

    Enforced on chain: only the officer, only forward in time, never while paused. We additionally
    refuse while commitments are still being written to the roll, so nobody approved is silently cut off.
    """
    require_role(actor, Role.OFFICER)
    e = await _published(election_id)
    assert e.id is not None
    phase = await phase_of(e)
    allowed = (Phase.REGISTRATION, Phase.AWAITING_VOTE) if start_voting else (Phase.REGISTRATION,)
    if phase not in allowed:
        raise WrongPhase(
            "Voting can only be started early before it has begun"
            if start_voting
            else "Registration is not open, so it can't be ended early"
        )
    if e.paused:
        raise WrongPhase("Unpause the election first")
    if phase == Phase.REGISTRATION:
        if await txs.open_tx(TxKind.ADD_MEMBERS, e.id) or (await roll_status(e))["joining_roll"]:
            raise Conflict(
                "Approved voters are still being added to the on-chain roll. Wait a few seconds and try again.",
                code="roll_busy",
            )
    if e.member_count == 0:
        # Freezing an empty roll locks everyone out for good: approved voters who haven't created their
        # voting identity yet could never be added, and nobody could vote.
        status = await roll_status(e)
        waiting = status["approved_no_identity"] + status["pending_review"]
        raise Conflict(
            "Nobody is on the voter roll yet, so nobody could vote. "
            + (
                f"{waiting} applicant{'s are' if waiting != 1 else ' is'} still being reviewed or creating "
                "their voting identity; wait for them first."
                if waiting
                else "Wait until approved voters have created their voting identity."
            ),
            code="empty_roll",
        )
    kind = TxKind.START_VOTING if start_voting else TxKind.END_REGISTRATION
    if settings is not None and settings.chain_required and e.chain_address:
        from secvote.chain import get_chain

        fn = "startVotingNow" if start_voting else "endRegistrationNow"
        reason = await get_chain(settings).simulate_officer_call(e.chain_address, fn)
        if reason == "unsupported":
            raise AppError(
                "This election was deployed with an older contract that can't change its schedule. "
                "Elections you create from now on support it.",
                code="not_supported",
            )
        if reason is not None:
            raise WrongPhase(f"The contract would reject this right now: {reason}")
    if not await txs.open_tx(kind, e.id):
        await txs.enqueue(kind, e.id, {})
        await audit.record(
            actor.id, f"election.{kind.value}", f"election:{e.id}", {"from_phase": phase.value}
        )
    return e


async def end_voting(actor: User, election_id: str, settings: Settings | None = None) -> Election:
    """Close voting now (officer). Refused while relayed ballots are still on their way to the chain,
    so no accepted ballot is cut off."""
    from secvote.db.models import ChainTx
    from secvote.domain.enums import TxStatus

    require_role(actor, Role.OFFICER)
    e = await _published(election_id)
    assert e.id is not None
    if await phase_of(e) != Phase.VOTING:
        raise WrongPhase("Voting is not open")
    if e.paused:
        raise WrongPhase("Unpause the election first")
    in_flight = await ChainTx.find(
        ChainTx.election_id == e.id,
        ChainTx.kind == TxKind.CAST_BALLOT,
        In(ChainTx.status, [TxStatus.PENDING, TxStatus.SENT]),
    ).count()
    if in_flight:
        raise Conflict(
            f"{in_flight} ballot{'s are' if in_flight != 1 else ' is'} still being recorded on chain. "
            "Wait a few seconds so nobody's vote is cut off.",
            code="ballots_in_flight",
        )
    if settings is not None and settings.chain_required and e.chain_address:
        from secvote.chain import get_chain

        reason = await get_chain(settings).simulate_officer_call(e.chain_address, "endVotingNow")
        if reason == "unsupported":
            raise AppError(
                "This election was deployed with an older contract that can't end voting early. "
                "Elections you create from now on support it.",
                code="not_supported",
            )
        if reason is not None:
            raise WrongPhase(f"The contract would reject this right now: {reason}")
    if not await txs.open_tx(TxKind.END_VOTING, e.id):
        await txs.enqueue(TxKind.END_VOTING, e.id, {})
        await audit.record(actor.id, "election.end_voting", f"election:{e.id}", {"ballots": e.ballot_count})
    return e


# ---------------------------------------------------------------- results
def race_specs(e: Election) -> list[tally_mod.RaceSpec]:
    return [(len(r.candidates), "irv" if r.method == "irv" else "plurality") for r in e.races]


async def compute_result(e: Election) -> dict[str, Any] | None:
    """Canonical v2 result (docs/ballot-format.md), built from indexed BallotCast events only.
    Sealed elections can only be counted once the key has been revealed (the worker stores it)."""
    if e.mode == BallotMode.SEALED:
        return e.result
    ballots = [
        bytes.fromhex(b.ballot.removeprefix("0x")) async for b in Ballot.find(Ballot.election_id == e.id)
    ]
    return tally_mod.tally_open(ballots, [len(r.candidates) for r in e.races], e.allow_nota)


def display_races(e: Election, result: dict[str, Any]) -> list[dict[str, Any]]:
    """Attach names to the canonical result for display. `votes` = plurality count, or IRV final round."""
    out = []
    for race, r in zip(e.races, result["races"], strict=True):
        final = r["rounds"][-1]["counts"] if r["method"] == "irv" else r["counts"]
        out.append(
            {
                "race_id": race.id,
                "title": race.title,
                "method": r["method"],
                "candidates": [
                    {"id": c.id, "name": c.name, "votes": final[i]} for i, c in enumerate(race.candidates)
                ],
                "nota": r.get("nota", 0),
                "abstain": r["abstain"],
                "invalid": r["invalid"],
                "winner": r["winner"],
                "first": r.get("first"),
                "rounds": r.get("rounds"),
            }
        )
    return out


async def results_view(e: Election, *, official: bool) -> dict[str, Any]:
    """Results are withheld from the public until the officer declares them. Officials may preview.
    Withheld means no counts AND no hash (a hash of a small tally could be brute-forced)."""
    phase = await phase_of(e)
    published = e.result_hash is not None
    base: dict[str, Any] = {
        "mode": e.mode,
        "final": phase == Phase.CLOSED,
        "published": published,
        "preview": official and not published,
        "declared_hash": e.result_hash,
        "ballots": e.ballot_count,
    }
    base["awaiting_key"] = e.mode == BallotMode.SEALED and e.result is None
    if not published and not official:
        return {**base, "races": None, "computed_hash": None}
    res = await compute_result(e)
    if res is None:  # sealed, key not revealed yet: nobody can count
        return {**base, "races": None, "computed_hash": None}
    return {**base, "races": display_races(e, res), "computed_hash": tally_mod.result_hash(res)}


async def declare_result(actor: User, election_id: str) -> str:
    require_role(actor, Role.OFFICER)
    e = await _published(election_id)
    if await phase_of(e) != Phase.CLOSED:
        raise WrongPhase("Voting has not closed")
    if e.result_hash:
        raise Conflict("Result already declared")
    res = await compute_result(e)
    if res is None:
        raise WrongPhase("The trustees have not revealed the election key yet, so nothing can be counted")
    h = tally_mod.result_hash(res)
    assert e.id is not None
    if not await txs.open_tx(TxKind.DECLARE_RESULT, e.id):
        await txs.enqueue(TxKind.DECLARE_RESULT, e.id, {"result_hash": h})
        await audit.record(actor.id, "election.declare_result", f"election:{e.id}", {"result_hash": h})
    return h


async def turnout(e: Election) -> dict[str, Any]:
    """Count of nullifiers over time. Never per person."""
    buckets: Counter[str] = Counter()
    async for b in Ballot.find(Ballot.election_id == e.id).sort("+block_time"):
        buckets[as_utc(b.block_time).strftime("%Y-%m-%dT%H:00:00Z")] += 1
    series, running = [], 0
    for k in sorted(buckets):
        running += buckets[k]
        series.append({"hour": k, "ballots": running})
    return {
        "ballots": e.ballot_count,
        "members": e.member_count,
        "turnout": (e.ballot_count / e.member_count) if e.member_count else 0.0,
        "series": series,
    }


async def elections_by_ids(ids: list[PydanticObjectId]) -> dict[PydanticObjectId, Election]:
    return {e.id: e for e in await Election.find(In(Election.id, ids)).to_list() if e.id is not None}


def digest_file(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
