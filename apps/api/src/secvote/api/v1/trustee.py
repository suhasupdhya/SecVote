"""Trustee endpoints. Shares are only ever handled encrypted, except the post-close release."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from secvote.api.deps import UserDep
from secvote.services import trustees

router = APIRouter(prefix="/trustee", tags=["trustee"])


@router.get("/elections")
async def my_elections(user: UserDep) -> dict[str, Any]:
    return {"items": await trustees.my_elections(user)}


class KeyIn(BaseModel):
    public_key: str = Field(max_length=80)


@router.post("/elections/{election_id}/key")
async def register_key(election_id: str, body: KeyIn, user: UserDep) -> dict[str, Any]:
    t = await trustees.register_key(user, election_id, body.public_key)
    return {"ok": True, "slot": t.slot}


@router.get("/elections/{election_id}/share")
async def my_share(election_id: str, user: UserDep) -> dict[str, Any]:
    return await trustees.my_share(user, election_id)


class ShareIn(BaseModel):
    x: int = Field(ge=1, le=3)
    y: str = Field(pattern=r"^0x[0-9a-fA-F]{1,64}$")


@router.post("/elections/{election_id}/share")
async def release_share(election_id: str, body: ShareIn, user: UserDep) -> dict[str, Any]:
    return await trustees.upload_share(user, election_id, body.x, body.y)
