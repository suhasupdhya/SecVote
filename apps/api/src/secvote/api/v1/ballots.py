"""Anonymous ballot endpoints. No session, no CSRF, no IP or user logging."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from fastapi import APIRouter, Request, status

from secvote.api.deps import SettingsDep
from secvote.core.errors import RateLimited
from secvote.core.redis import get_redis
from secvote.services import ballots

router = APIRouter(prefix="/ballots", tags=["ballots"])

# Rotates on every process start, so the short-lived rate-limit keys cannot be mapped back to IPs.
_RL_SALT = secrets.token_bytes(32)


def client_address(request: Request, settings: SettingsDep) -> str:
    """The visitor's address: from the trusted proxy's header when configured, else the connecting peer."""
    if settings.client_ip_header:
        forwarded = request.headers.get(settings.client_ip_header, "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


async def _rate_limit(request: Request, settings: SettingsDep) -> None:
    ip = client_address(request, settings)
    key = "rl:ballot:" + hmac.new(_RL_SALT, ip.encode(), hashlib.sha256).hexdigest()[:24]
    r = get_redis(settings)
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 60)
    if n > settings.ballot_rate_limit_per_minute:
        raise RateLimited("Too many submissions from this network; try again shortly")


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def submit_ballot(body: ballots.BallotIn, request: Request, settings: SettingsDep) -> dict[str, Any]:
    await _rate_limit(request, settings)
    return await ballots.submit(settings, body)


@router.get("/{ballot_id}")
async def ballot_status(ballot_id: str) -> dict[str, Any]:
    return await ballots.status(ballot_id)
