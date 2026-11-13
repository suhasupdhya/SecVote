"""Accounts, email OTP and server-side sessions. Knows nothing about FastAPI."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from beanie import PydanticObjectId
from pymongo.errors import DuplicateKeyError
from redis.asyncio import Redis

from secvote.core import security
from secvote.core.config import Settings
from secvote.core.errors import Conflict, Forbidden, NotFound, RateLimited, Unauthorized
from secvote.db.models import User
from secvote.domain.enums import Role
from secvote.domain.phases import as_utc, now_utc
from secvote.identity import get_identity_provider
from secvote.services import audit
from secvote.services.email import get_email_sender

OTP_VERIFY_EMAIL = "verify_email"
OTP_RESET_PASSWORD = "reset_password"  # noqa: S105 - an OTP purpose label, not a password
PRIVILEGED = {Role.ADMIN, Role.OFFICER, Role.TRUSTEE}
LOGIN_MAX_FAILS = 10
LOGIN_FAIL_WINDOW = 15 * 60


@dataclass(frozen=True)
class Session:
    token: str
    csrf: str
    user_id: str
    ttl: int


def require_role(user: User, *roles: Role) -> None:
    """Role checks live in services, not only in routes."""
    if not any(user.has_role(r) for r in roles):
        raise Forbidden("You do not have permission to do this")


class AuthService:
    def __init__(self, settings: Settings, redis: Redis) -> None:
        self.s = settings
        self.r = redis

    # ------------------------------------------------------------ accounts
    async def register(self, email: str, name: str, password: str) -> User:
        email = email.strip().lower()
        get_identity_provider(self.s).check_signup(email)
        if len(password) < 10:
            raise Conflict("Password must be at least 10 characters", code="weak_password")
        user = User(email=email, name=name.strip(), password_hash=security.hash_password(password))
        try:
            await user.insert()
        except DuplicateKeyError:
            raise Conflict("An account with this email already exists", code="email_taken") from None
        await self.request_otp(email)
        return user

    async def authenticate(self, email: str, password: str) -> User:
        email = email.strip().lower()
        fail_key = f"login_fail:{email}"
        fails = int(await self.r.get(fail_key) or 0)
        if fails >= LOGIN_MAX_FAILS:
            raise RateLimited("Too many failed attempts. Try again later.")
        user = await User.find_one(User.email == email, User.deleted_at == None)
        if not security.verify_password(user.password_hash if user else None, password) or user is None:
            await self.r.incr(fail_key)
            await self.r.expire(fail_key, LOGIN_FAIL_WINDOW)
            raise Unauthorized("Wrong email or password", code="bad_credentials")
        await self.r.delete(fail_key)
        if not user.email_verified:
            raise Forbidden("Verify your email first", code="email_not_verified")
        if security.needs_rehash(user.password_hash):
            user.password_hash = security.hash_password(password)
            await user.save()
        return user

    # ------------------------------------------------------------ OTP
    def _otp_keys(self, purpose: str, email: str) -> tuple[str, str, str]:
        base = f"{purpose}:{email.lower()}"
        return f"otp:{base}", f"otp_attempts:{base}", f"otp_cooldown:{base}"

    async def request_otp(self, email: str, purpose: str = OTP_VERIFY_EMAIL) -> None:
        email = email.strip().lower()
        code_key, attempts_key, cooldown_key = self._otp_keys(purpose, email)
        cooldown = self.s.otp_resend_cooldown_seconds
        if cooldown > 0 and not await self.r.set(cooldown_key, "1", ex=cooldown, nx=True):
            raise RateLimited("Please wait before requesting another code")
        user = await User.find_one(User.email == email, User.deleted_at == None)
        if user is None or (purpose == OTP_VERIFY_EMAIL and user.email_verified):
            return  # do not reveal whether the account exists
        code = security.new_otp()
        digest = security.otp_digest(self.s.otp_pepper.get_secret_value(), purpose, email, code)
        await self.r.set(code_key, digest, ex=self.s.otp_ttl_seconds)
        await self.r.delete(attempts_key)
        minutes = self.s.otp_ttl_seconds // 60
        if purpose == OTP_RESET_PASSWORD:
            subject = "Reset your SecVote password"
            body = (
                f"Your SecVote password reset code is {code}. It expires in {minutes} minutes.\n\n"
                "If you didn't ask to reset your password, ignore this email: your password stays the same."
            )
        else:
            subject = "Your SecVote code"
            body = f"Your SecVote verification code is {code}. It expires in {minutes} minutes."
        await get_email_sender(self.s).send(email, subject, body)

    async def verify_otp(self, email: str, code: str, purpose: str = OTP_VERIFY_EMAIL) -> User:
        email = email.strip().lower()
        code_key, attempts_key, _ = self._otp_keys(purpose, email)
        stored = await self.r.get(code_key)
        if stored is None:
            raise Unauthorized("Code expired or not requested", code="otp_invalid")
        attempts = await self.r.incr(attempts_key)
        await self.r.expire(attempts_key, self.s.otp_ttl_seconds)
        if attempts > self.s.otp_max_attempts:
            await self.r.delete(code_key)
            raise RateLimited("Too many attempts. Request a new code.")
        digest = security.otp_digest(self.s.otp_pepper.get_secret_value(), purpose, email, code.strip())
        if not security.constant_time_eq(str(stored), digest):
            raise Unauthorized("Wrong code", code="otp_invalid")
        await self.r.delete(code_key, attempts_key)
        user = await User.find_one(User.email == email)
        if user is None:
            raise NotFound("Account not found")
        if purpose == OTP_VERIFY_EMAIL and not user.email_verified:
            user.email_verified = True
            await user.save()
        return user

    async def reset_password(self, email: str, code: str, password: str) -> User:
        """Forgot-password: the emailed code proves control of the mailbox. Signs out every other session."""
        if len(password) < 10:
            raise Conflict("Password must be at least 10 characters", code="weak_password")
        user = await self.verify_otp(email, code, purpose=OTP_RESET_PASSWORD)
        if user.deleted_at is not None:
            raise NotFound("Account not found")
        user.password_hash = security.hash_password(password)
        user.email_verified = True
        user.sessions_valid_after = now_utc()
        await user.save()
        await self.r.delete(f"login_fail:{user.email}")
        await audit.record(user.id, "user.reset_password", f"user:{user.id}")
        return user

    async def change_password(self, user: User, current: str, new: str) -> None:
        """Signed-in change. Every existing session (including this one) stops working; the caller
        issues a fresh session for the device that made the change."""
        if not security.verify_password(user.password_hash, current):
            raise Unauthorized("Your current password is not correct", code="bad_credentials")
        if len(new) < 10:
            raise Conflict("Password must be at least 10 characters", code="weak_password")
        if new == current:
            raise Conflict("Choose a password different from your current one", code="same_password")
        user.password_hash = security.hash_password(new)
        user.sessions_valid_after = now_utc()
        await user.save()
        await audit.record(user.id, "user.change_password", f"user:{user.id}")

    # ------------------------------------------------------------ sessions
    def _skey(self, token: str) -> str:
        return "sess:" + security.token_key(self.s.session_secret.get_secret_value(), token)

    async def create_session(self, user: User) -> Session:
        token, csrf = security.new_token(), security.new_token(16)
        ttl = self.s.admin_session_ttl_seconds if PRIVILEGED & set(user.roles) else self.s.session_ttl_seconds
        payload = {"uid": str(user.id), "csrf": csrf, "iat": now_utc().timestamp()}
        await self.r.set(self._skey(token), json.dumps(payload), ex=ttl)
        return Session(token=token, csrf=csrf, user_id=str(user.id), ttl=ttl)

    async def resolve_session(self, token: str | None) -> tuple[User, str] | None:
        if not token:
            return None
        raw = await self.r.get(self._skey(token))
        if raw is None:
            return None
        data = json.loads(raw)
        user = await User.get(PydanticObjectId(data["uid"]))
        if user is None or user.deleted_at is not None:
            return None
        if user.sessions_valid_after and data.get("iat", 0) < as_utc(user.sessions_valid_after).timestamp():
            return None  # signed in before a password reset
        return user, data["csrf"]

    async def destroy_session(self, token: str | None) -> None:
        if token:
            await self.r.delete(self._skey(token))

    # ------------------------------------------------------------ admin bootstrap
    @staticmethod
    async def bootstrap_admin(email: str, name: str, password: str) -> User:
        if await User.find_one({"roles": Role.ADMIN.value}):
            raise Conflict("An admin already exists; bootstrap is one-time only")
        user = User(
            email=email.strip().lower(),
            name=name,
            password_hash=security.hash_password(password),
            roles=[Role.ADMIN, Role.OFFICER],
            email_verified=True,
        )
        await user.insert()
        await audit.record(user.id, "bootstrap_admin", f"user:{user.id}")
        return user

    @staticmethod
    async def grant_role(actor: User, user_id: PydanticObjectId, role: Role) -> User:
        require_role(actor, Role.ADMIN)
        user = await User.get(user_id)
        if user is None:
            raise NotFound("User not found")
        if role not in user.roles:
            user.roles.append(role)
            await user.save()
            await audit.record(actor.id, "grant_role", f"user:{user.id}", {"role": role.value})
        return user

    @staticmethod
    async def revoke_role(actor: User, user_id: PydanticObjectId, role: Role) -> User:
        require_role(actor, Role.ADMIN)
        if role == Role.VOTER:
            raise Conflict("Everyone keeps the voter role")
        user = await User.get(user_id)
        if user is None:
            raise NotFound("User not found")
        if role == Role.ADMIN:
            if user.id == actor.id:
                raise Conflict("You cannot remove your own admin role", code="self_lockout")
            if await User.find({"roles": Role.ADMIN.value, "deleted_at": None}).count() <= 1:
                raise Conflict("At least one admin must remain", code="last_admin")
        if role in user.roles:
            user.roles.remove(role)
            await user.save()
            await audit.record(actor.id, "revoke_role", f"user:{user.id}", {"role": role.value})
        return user

    @staticmethod
    async def search_users(actor: User, q: str, limit: int = 50) -> list[User]:
        require_role(actor, Role.ADMIN)
        import re

        filt: dict[str, Any] = {"deleted_at": None}
        if q.strip():
            rx = {"$regex": re.escape(q.strip()), "$options": "i"}
            filt["$or"] = [{"email": rx}, {"name": rx}]
        return await User.find(filt).sort("-created_at").limit(limit).to_list()
