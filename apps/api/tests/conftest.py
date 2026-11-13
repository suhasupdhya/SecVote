from __future__ import annotations

import json
import os
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from pymongo import AsyncMongoClient

from secvote.core.config import Settings, get_settings
from secvote.core.redis import reset_redis
from secvote.db import close_db, init_db
from secvote.domain.phases import now_utc
from secvote.main import create_app
from secvote.services import clock

PDF = b"%PDF-1.4\n% test id card\n%%EOF\n"
ADMIN_PW = "admin-password-123"
VOTER_PW = "voter-password-123"


@pytest.fixture(scope="session")
def tmp_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("secvote")


@pytest.fixture(scope="session")
def settings(tmp_root: Path) -> Settings:
    return Settings(
        _env_file=None,  # never read the developer's apps/api/.env
        env="test",
        email_backend="console",
        mongodb_uri=os.environ.get("SECVOTE_TEST_MONGODB_URI", "mongodb://127.0.0.1:27017"),
        mongodb_db=f"secvote_test_{uuid.uuid4().hex[:8]}",
        redis_url="",
        chain_required=False,
        allowed_email_domains=["example.edu.in"],
        upload_dir=tmp_root / "uploads",
        mailbox_file=tmp_root / "mailbox.jsonl",
        otp_resend_cooldown_seconds=0,
    )


@pytest.fixture(scope="session", autouse=True)
async def db(settings: Settings) -> AsyncIterator[None]:
    await init_db(settings)
    yield
    client: AsyncMongoClient[Any] = AsyncMongoClient(settings.mongodb_uri)
    await client.drop_database(settings.mongodb_db)
    await client.close()
    await close_db()


@pytest.fixture(autouse=True)
def _fresh_redis() -> None:
    reset_redis()
    clock.reset_cache()


@pytest.fixture(scope="session")
def app(settings: Settings) -> Any:
    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    return application


def _client(app: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")


@pytest.fixture
async def client(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with _client(app) as c:
        yield c


@pytest.fixture
def new_client(app: Any) -> Any:
    return lambda: _client(app)


def last_otp(settings: Settings, email: str) -> str:
    lines = [json.loads(x) for x in settings.mailbox_file.read_text().splitlines()]
    body = next(m["body"] for m in reversed(lines) if m["to"] == email)
    return next(
        tok.rstrip(".") for tok in body.split() if tok.rstrip(".").isdigit() and len(tok.rstrip(".")) == 6
    )


def enrol_code(settings: Settings, email: str) -> str:
    """The enrolment code from the most recent approval email sent to this address."""
    lines = [json.loads(x) for x in settings.mailbox_file.read_text().splitlines()]
    body = next(m["body"] for m in reversed(lines) if m["to"] == email and "enrolment" in m["subject"])
    return next(
        tok.rstrip(".") for tok in body.split() if tok.rstrip(".").isdigit() and len(tok.rstrip(".")) == 6
    )


def csrf(c: httpx.AsyncClient) -> dict[str, str]:
    return {"x-csrf-token": c.cookies.get("sv_csrf") or ""}


async def signup_voter(c: httpx.AsyncClient, settings: Settings, email: str | None = None) -> str:
    email = email or f"v{uuid.uuid4().hex[:8]}@example.edu.in"
    r = await c.post(
        "/api/v1/auth/register", json={"email": email, "name": "Test Voter", "password": VOTER_PW}
    )
    assert r.status_code == 201, r.text
    r = await c.post("/api/v1/auth/otp/verify", json={"email": email, "code": last_otp(settings, email)})
    assert r.status_code == 200, r.text
    return email


async def make_admin(c: httpx.AsyncClient, email: str | None = None) -> str:
    from secvote.db.models import User
    from secvote.domain.enums import Role
    from secvote.services.auth import AuthService

    email = email or f"a{uuid.uuid4().hex[:8]}@example.edu.in"
    if not await User.find_one({"roles": "admin"}):
        await AuthService.bootstrap_admin(email, "Admin", ADMIN_PW)
    else:
        from secvote.core import security

        await User(
            email=email,
            name="Admin 2",
            password_hash=security.hash_password(ADMIN_PW),
            roles=[Role.ADMIN, Role.OFFICER],
            email_verified=True,
        ).insert()
    r = await c.post("/api/v1/auth/login", json={"email": email, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    return email


def election_body(**overrides: Any) -> dict[str, Any]:
    t = now_utc()
    body = {
        "title": "Student Council 2026",
        "org": "Example College",
        "races": [
            {"title": "President", "candidates": [{"name": "Asha"}, {"name": "Bala"}, {"name": "Chitra"}]},
            {"title": "Secretary", "candidates": [{"name": "Dev"}, {"name": "Esha"}]},
        ],
        "allow_nota": True,
        "high_stakes": False,
        "reg_start": (t - timedelta(minutes=5)).isoformat(),
        "reg_end": (t + timedelta(hours=1)).isoformat(),
        "vote_start": (t + timedelta(hours=2)).isoformat(),
        "vote_end": (t + timedelta(hours=3)).isoformat(),
    }
    body.update(overrides)
    return body


async def published_election(c: httpx.AsyncClient, **overrides: Any) -> dict[str, Any]:
    """Create + publish, then simulate the worker confirming the deployment."""
    from secvote.db.models import Election
    from secvote.domain.enums import ElectionStatus

    r = await c.post("/api/v1/admin/elections", json=election_body(**overrides), headers=csrf(c))
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    r = await c.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(c))
    assert r.status_code == 200, r.text
    e = await Election.get(eid)
    assert e is not None
    e.status = ElectionStatus.PUBLISHED
    e.chain_address = "0x" + uuid.uuid4().hex[:40].ljust(40, "0")
    e.scope = "12345"
    await e.save()
    return r.json()
