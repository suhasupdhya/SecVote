"""Public, read-only election data. Everything here can also be read straight from the chain."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from secvote.api.schemas import election_out
from secvote.services import ballots, elections, registrations

router = APIRouter(prefix="/elections", tags=["elections"])


@router.get("")
async def list_elections() -> dict[str, Any]:
    items = await elections.list_public()
    return {"items": [election_out(e, await elections.phase_of(e)) for e in items]}


@router.get("/{election_id}")
async def get_election(election_id: str) -> dict[str, Any]:
    e = await elections.get_public(election_id)
    return election_out(e, await elections.phase_of(e))


@router.get("/{election_id}/turnout")
async def turnout(election_id: str) -> dict[str, Any]:
    return await elections.turnout(await elections.get_public(election_id))


@router.get("/{election_id}/ballots")
async def bulletin(
    election_id: str, skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)
) -> dict[str, Any]:
    return await ballots.bulletin(await elections.get_public(election_id), skip, limit)


@router.get("/{election_id}/results")
async def results(election_id: str) -> dict[str, Any]:
    """Public results: withheld until the election officer declares them on chain."""
    e = await elections.get_public(election_id)
    return await elections.results_view(e, official=False)


@router.get("/{election_id}/members")
async def members(election_id: str) -> dict[str, Any]:
    """The roll as public commitments in tree order. The browser rebuilds the group from this and
    checks the root against the chain before proving."""
    e = await elections.get_public(election_id)
    return {"frozen": e.frozen, "frozen_root": e.frozen_root, "commitments": await registrations.members(e)}


@router.get("/{election_id}/roll-check")
async def roll_check(election_id: str, commitment: str = Query(max_length=80)) -> dict[str, Any]:
    return await registrations.roll_check(await elections.get_public(election_id), commitment)
