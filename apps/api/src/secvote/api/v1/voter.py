from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, UploadFile, status
from pydantic import BaseModel, Field

from secvote.api.deps import SettingsDep, UserDep
from secvote.api.schemas import registration_out
from secvote.core.errors import AppError
from secvote.db.models import Election
from secvote.services import elections, registrations

router = APIRouter(tags=["registrations"])


@router.post("/elections/{election_id}/registrations", status_code=status.HTTP_201_CREATED)
async def apply(
    election_id: str,
    user: UserDep,
    settings: SettingsDep,
    reg_no: str = Form(min_length=2, max_length=40),
    department: str = Form(min_length=2, max_length=120),
    year: int = Form(ge=1, le=10),
    consent: bool = Form(...),
    id_document: UploadFile = File(...),
) -> dict[str, Any]:
    if not consent:
        raise AppError("Consent is required to process your ID proof", code="consent_required")
    data = await id_document.read(settings.max_upload_bytes + 1)
    reg = await registrations.apply(
        settings, user, election_id, reg_no=reg_no, department=department, year=year, file_bytes=data
    )
    return registration_out(reg)


@router.get("/me/registrations")
async def my_registrations(user: UserDep) -> dict[str, Any]:
    regs = await registrations.mine(user)
    by_id = await elections.elections_by_ids(list({r.election_id for r in regs}))
    out = []
    for r in regs:
        e: Election | None = by_id.get(r.election_id)
        item = registration_out(r, e)
        item["phase"] = await elections.phase_of(e) if e else None
        out.append(item)
    return {"items": out}


class CommitmentIn(BaseModel):
    commitment: str = Field(min_length=1, max_length=80)
    enrol_code: str = Field(pattern=r"^\d{6}$")


class EnrolCodeIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/registrations/{registration_id}/enrol-code/verify")
async def verify_enrol_code(
    registration_id: str, body: EnrolCodeIn, user: UserDep, settings: SettingsDep
) -> dict[str, Any]:
    await registrations.verify_enrol_code(settings, user, registration_id, body.code)
    return {"ok": True}


@router.post("/registrations/{registration_id}/enrol-code/resend")
async def resend_enrol_code(registration_id: str, user: UserDep, settings: SettingsDep) -> dict[str, Any]:
    return registration_out(await registrations.resend_enrol_code(settings, user, registration_id))


@router.post("/registrations/{registration_id}/commitment")
async def submit_commitment(
    registration_id: str, body: CommitmentIn, user: UserDep, settings: SettingsDep
) -> dict[str, Any]:
    return registration_out(
        await registrations.submit_commitment(
            settings, user, registration_id, body.commitment, body.enrol_code
        )
    )
