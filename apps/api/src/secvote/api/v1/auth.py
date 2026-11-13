from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

from secvote.api.deps import (
    SESSION_COOKIE,
    AuthDep,
    OptionalUserDep,
    SettingsDep,
    UserDep,
    clear_session_cookies,
    set_session_cookies,
)
from secvote.api.schemas import user_out
from secvote.core.errors import Conflict
from secvote.db.models import User
from secvote.domain.enums import Role
from secvote.domain.phases import now_utc
from secvote.services import audit
from secvote.services.auth import OTP_RESET_PASSWORD

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=10, max_length=256)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)


class OtpRequestIn(BaseModel):
    email: EmailStr


class OtpVerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, auth: AuthDep) -> dict[str, Any]:
    await auth.register(body.email, body.name, body.password)
    return {"ok": True, "next": "verify_email"}


@router.post("/otp/request")
async def otp_request(body: OtpRequestIn, auth: AuthDep) -> dict[str, Any]:
    await auth.request_otp(body.email)
    return {"ok": True}


@router.post("/otp/verify")
async def otp_verify(
    body: OtpVerifyIn, auth: AuthDep, response: Response, settings: SettingsDep
) -> dict[str, Any]:
    user = await auth.verify_otp(body.email, body.code)
    set_session_cookies(response, settings, await auth.create_session(user))
    return {"user": user_out(user)}


@router.post("/login")
async def login(body: LoginIn, auth: AuthDep, response: Response, settings: SettingsDep) -> dict[str, Any]:
    user = await auth.authenticate(body.email, body.password)
    set_session_cookies(response, settings, await auth.create_session(user))
    return {"user": user_out(user)}


class ResetIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=10, max_length=256)


@router.post("/password/forgot")
async def password_forgot(body: OtpRequestIn, auth: AuthDep) -> dict[str, Any]:
    """Always answers ok, so it can't be used to find out which emails have accounts."""
    await auth.request_otp(body.email, purpose=OTP_RESET_PASSWORD)
    return {"ok": True}


@router.post("/password/reset")
async def password_reset(body: ResetIn, auth: AuthDep) -> dict[str, Any]:
    await auth.reset_password(body.email, body.code, body.password)
    return {"ok": True}


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


@router.post("/password/change")
async def password_change(
    body: ChangePasswordIn,
    user: UserDep,
    request: Request,
    response: Response,
    auth: AuthDep,
    settings: SettingsDep,
) -> dict[str, Any]:
    """Signs out every other device; this one gets a fresh session so it stays signed in."""
    await auth.change_password(user, body.current_password, body.new_password)
    await auth.destroy_session(request.cookies.get(SESSION_COOKIE))
    set_session_cookies(response, settings, await auth.create_session(user))
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response, auth: AuthDep) -> dict[str, Any]:
    await auth.destroy_session(request.cookies.get(SESSION_COOKIE))
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/config")
async def auth_config(settings: SettingsDep) -> dict[str, Any]:
    """Public sign-up rules, so the UI can tell people which email to use."""
    return {"allowed_email_domains": [d.lower().lstrip("@") for d in settings.allowed_email_domains]}


@router.get("/me")
async def me(user: OptionalUserDep, request: Request, response: Response) -> dict[str, Any]:
    """Who am I? Returns {"user": null} when signed out (not an error), and clears a stale
    session cookie, e.g. after the API restarted and in-memory sessions were lost."""
    if user is None and request.cookies.get(SESSION_COOKIE):
        clear_session_cookies(response)
    return {"user": user_out(user) if user else None}


@router.post("/me/delete")
async def delete_me(user: UserDep, request: Request, response: Response, auth: AuthDep) -> dict[str, Any]:
    """DPDP: erase personal data. Registrations keep only the (public) commitment."""
    if (
        Role.ADMIN in user.roles
        and await User.find({"roles": Role.ADMIN.value, "deleted_at": None}).count() <= 1
    ):
        raise Conflict(
            "You are the only admin. Make someone else an admin before deleting your account.",
            code="last_admin",
        )
    user.email = f"deleted-{user.id}@deleted.invalid"
    user.name = "Deleted user"
    user.password_hash = "!"  # noqa: S105 - not a password, a disabled marker
    user.deleted_at = now_utc()
    await user.save()
    await audit.record(user.id, "user.delete", f"user:{user.id}")
    await auth.destroy_session(request.cookies.get(SESSION_COOKIE))
    clear_session_cookies(response)
    return {"ok": True}
