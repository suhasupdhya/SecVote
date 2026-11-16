"""When the email provider fails, people get a clear message (not a server error) and can simply try again."""

from __future__ import annotations

import uuid

import httpx
import pytest

from secvote.core.config import Settings
from secvote.db.models import User
from secvote.services import auth as auth_service
from secvote.services import email as email_service

from .conftest import VOTER_PW, last_otp


class _BrokenSmtp:
    calls = 0

    async def send(self, to: str, subject: str, body: str) -> None:
        async def fail() -> None:
            _BrokenSmtp.calls += 1
            raise TimeoutError("The read operation timed out")

        await email_service._with_retry("SMTP", fail)


async def test_signup_email_failure_is_a_clear_error_and_can_be_retried(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(email_service, "RETRY_DELAY", 0)
    email = f"u{uuid.uuid4().hex[:6]}@example.edu.in"
    body = {"email": email, "name": "U V", "password": VOTER_PW}

    monkeypatch.setattr(auth_service, "get_email_sender", lambda _s: _BrokenSmtp())
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "email_failed"
    assert "try again" in r.json()["error"]["message"]
    assert _BrokenSmtp.calls == 2  # one automatic retry
    assert await User.find_one(User.email == email) is None  # no half-made account left behind

    # Email works again: the same signup now goes through, without "email already taken".
    monkeypatch.undo()
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 201
    r = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": last_otp(settings, email)})
    assert r.status_code == 200
