from __future__ import annotations

from typing import Any

from beanie import PydanticObjectId
from fastapi import APIRouter, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from secvote.api.deps import SettingsDep, UserDep
from secvote.api.schemas import election_out, registration_out, user_out
from secvote.core.errors import NotFound
from secvote.db.models import AuditEvent, ChainTx, User
from secvote.domain.enums import RegistrationStatus, Role
from secvote.services import audit, elections, registrations, trustees
from secvote.services.auth import AuthService, require_role

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------- elections
@router.get("/elections")
async def list_elections(user: UserDep) -> dict[str, Any]:
    items = await elections.list_all(user)
    return {"items": [election_out(e, await elections.phase_of(e), admin=True) for e in items]}


@router.get("/elections/{election_id}")
async def get_election(election_id: str, user: UserDep) -> dict[str, Any]:
    require_role(user, Role.ADMIN, Role.OFFICER)
    e = await elections.get(election_id)
    out = election_out(e, await elections.phase_of(e), admin=True)
    out["roll_status"] = await elections.roll_status(e)
    out["trustees"] = await trustees.list_for(e) if e.mode == "sealed" else []
    out["ceremony_at"] = e.ceremony_at
    txs = (
        await ChainTx.find(ChainTx.election_id == e.id, ChainTx.kind != "cast_ballot")
        .sort("-created_at")
        .to_list()
    )
    out["transactions"] = [
        {"id": str(t.id), "kind": t.kind, "status": t.status, "tx_hash": t.tx_hash, "error": t.error}
        for t in txs[:50]
    ]
    return out


@router.post("/elections", status_code=status.HTTP_201_CREATED)
async def create_election(body: elections.ElectionIn, user: UserDep) -> dict[str, Any]:
    e = await elections.create_draft(user, body)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.put("/elections/{election_id}")
async def update_election(election_id: str, body: elections.ElectionIn, user: UserDep) -> dict[str, Any]:
    e = await elections.update_draft(user, election_id, body)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/publish")
async def publish(election_id: str, user: UserDep) -> dict[str, Any]:
    e = await elections.publish(user, election_id)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/freeze")
async def freeze(election_id: str, user: UserDep) -> dict[str, Any]:
    e = await elections.request_freeze(user, election_id)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/pause")
async def pause(election_id: str, user: UserDep) -> dict[str, Any]:
    e = await elections.set_paused(user, election_id, True)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/unpause")
async def unpause(election_id: str, user: UserDep) -> dict[str, Any]:
    e = await elections.set_paused(user, election_id, False)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/end-registration")
async def end_registration(election_id: str, user: UserDep, settings: SettingsDep) -> dict[str, Any]:
    e = await elections.shorten_schedule(user, election_id, start_voting=False, settings=settings)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/start-voting")
async def start_voting(election_id: str, user: UserDep, settings: SettingsDep) -> dict[str, Any]:
    e = await elections.shorten_schedule(user, election_id, start_voting=True, settings=settings)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.post("/elections/{election_id}/end-voting")
async def end_voting(election_id: str, user: UserDep, settings: SettingsDep) -> dict[str, Any]:
    e = await elections.end_voting(user, election_id, settings)
    return election_out(e, await elections.phase_of(e), admin=True)


@router.get("/elections/{election_id}/results")
async def results_preview(election_id: str, user: UserDep) -> dict[str, Any]:
    """Officials can see the count before it is published."""
    require_role(user, Role.ADMIN, Role.OFFICER)
    return await elections.results_view(await elections.get(election_id), official=True)


class TrusteeIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.post("/elections/{election_id}/trustees", status_code=status.HTTP_201_CREATED)
async def add_trustee(election_id: str, body: TrusteeIn, user: UserDep) -> dict[str, Any]:
    t = await trustees.add(user, election_id, body.email)
    return {"id": str(t.id), "slot": t.slot}


@router.delete("/elections/{election_id}/trustees/{trustee_id}")
async def remove_trustee(election_id: str, trustee_id: str, user: UserDep) -> dict[str, Any]:
    await trustees.remove(user, election_id, trustee_id)
    return {"ok": True}


@router.post("/elections/{election_id}/ceremony")
async def key_ceremony(election_id: str, body: trustees.CeremonyIn, user: UserDep) -> dict[str, Any]:
    e = await trustees.run_ceremony(user, election_id, body)
    return {"public_key": e.public_key, "ceremony_at": e.ceremony_at}


@router.post("/elections/{election_id}/declare")
async def declare(election_id: str, user: UserDep) -> dict[str, Any]:
    return {"result_hash": await elections.declare_result(user, election_id)}


# ---------------------------------------------------------------- eligibility list
class EligibilityIn(BaseModel):
    reg_nos: list[str] | None = Field(
        default=None, max_length=registrations.MAX_ELIGIBLE
    )  # None: keep the list
    eligible_only: bool = False


@router.get("/elections/{election_id}/eligibility")
async def get_eligibility(election_id: str, user: UserDep) -> dict[str, Any]:
    return await registrations.eligibility(user, election_id)


@router.put("/elections/{election_id}/eligibility")
async def put_eligibility(
    election_id: str, body: EligibilityIn, user: UserDep, settings: SettingsDep
) -> dict[str, Any]:
    return await registrations.set_eligibility(settings, user, election_id, body.reg_nos, body.eligible_only)


# ---------------------------------------------------------------- registrations review
@router.get("/elections/{election_id}/registrations")
async def review_queue(
    election_id: str, user: UserDep, status: RegistrationStatus | None = Query(default=None)
) -> dict[str, Any]:
    return {"items": await registrations.review_queue(user, election_id, status)}


@router.get("/registrations/{registration_id}/document")
async def registration_document(registration_id: str, user: UserDep, settings: SettingsDep) -> FileResponse:
    path, ctype = await registrations.document_for_review(settings, user, registration_id)
    return FileResponse(path, media_type=ctype, headers={"Cache-Control": "no-store"})


@router.post("/registrations/{registration_id}/approve")
async def approve(registration_id: str, user: UserDep, settings: SettingsDep) -> dict[str, Any]:
    return registration_out(await registrations.approve(user, registration_id, settings))


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/registrations/{registration_id}/reject")
async def reject(
    registration_id: str, body: RejectIn, user: UserDep, settings: SettingsDep
) -> dict[str, Any]:
    return registration_out(await registrations.reject(user, registration_id, body.reason, settings))


# ---------------------------------------------------------------- users & audit
class RoleIn(BaseModel):
    role: Role


@router.post("/users/{user_id}/roles")
async def grant_role(user_id: str, body: RoleIn, user: UserDep) -> dict[str, Any]:
    if not PydanticObjectId.is_valid(user_id):
        raise NotFound("User not found")
    return user_out(await AuthService.grant_role(user, PydanticObjectId(user_id), body.role))


@router.delete("/users/{user_id}/roles/{role}")
async def revoke_role(user_id: str, role: Role, user: UserDep) -> dict[str, Any]:
    if not PydanticObjectId.is_valid(user_id):
        raise NotFound("User not found")
    return user_out(await AuthService.revoke_role(user, PydanticObjectId(user_id), role))


@router.get("/users")
async def search_users(user: UserDep, q: str = Query("", max_length=120)) -> dict[str, Any]:
    users = await AuthService.search_users(user, q)
    return {"items": [{**user_out(u), "created_at": u.created_at} for u in users]}


@router.delete("/elections/{election_id}")
async def delete_draft(election_id: str, user: UserDep) -> dict[str, Any]:
    await elections.delete_draft(user, election_id)
    return {"ok": True}


@router.get("/audit")
async def audit_log(user: UserDep, limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    require_role(user, Role.ADMIN, Role.OBSERVER)
    events = await AuditEvent.find_all().sort("-seq").limit(limit).to_list()
    actor_ids = list({ev.actor_id for ev in events if ev.actor_id})
    names = {u.id: u.name for u in await User.find({"_id": {"$in": actor_ids}}).to_list()}
    return {
        "chain_valid": await audit.verify_chain(),
        "items": [
            {
                "seq": ev.seq,
                "actor": names.get(ev.actor_id, "Former user") if ev.actor_id else "System",
                "actor_id": str(ev.actor_id) if ev.actor_id else None,
                "action": ev.action,
                "target": ev.target,
                "data": ev.data,
                "at": ev.at,
                "hash": ev.hash,
            }
            for ev in events
        ],
    }
