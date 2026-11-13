from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request, Response

from secvote.core.config import Settings, get_settings
from secvote.core.errors import Forbidden, Unauthorized
from secvote.core.redis import get_redis
from secvote.core.security import constant_time_eq
from secvote.db.models import User
from secvote.services.auth import AuthService, Session

SESSION_COOKIE = "sv_session"
CSRF_COOKIE = "sv_csrf"
CSRF_HEADER = "x-csrf-token"

SettingsDep = Annotated[Settings, Depends(get_settings)]


def auth_service(settings: SettingsDep) -> AuthService:
    return AuthService(settings, get_redis(settings))


AuthDep = Annotated[AuthService, Depends(auth_service)]


async def optional_user(request: Request, auth: AuthDep) -> User | None:
    resolved = await auth.resolve_session(request.cookies.get(SESSION_COOKIE))
    if resolved is None:
        return None
    user, csrf = resolved
    request.state.csrf = csrf
    return user


async def current_user(request: Request, user: Annotated[User | None, Depends(optional_user)]) -> User:
    if user is None:
        raise Unauthorized("Please sign in")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        sent = request.headers.get(CSRF_HEADER, "")
        if not sent or not constant_time_eq(sent, getattr(request.state, "csrf", "")):
            raise Forbidden("Missing or invalid CSRF token", code="csrf")
    return user


UserDep = Annotated[User, Depends(current_user)]
OptionalUserDep = Annotated[User | None, Depends(optional_user)]


def set_session_cookies(response: Response, settings: Settings, session: Session) -> None:
    common = {"secure": settings.cookie_secure, "samesite": "lax", "path": "/", "max_age": session.ttl}
    response.set_cookie(SESSION_COOKIE, session.token, httponly=True, **common)  # type: ignore[arg-type]
    # Readable by JS on purpose: double-submit CSRF token, also checked against the server session.
    response.set_cookie(CSRF_COOKIE, session.csrf, httponly=False, **common)  # type: ignore[arg-type]


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
