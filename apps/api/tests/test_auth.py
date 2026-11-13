from __future__ import annotations

import uuid

import httpx

from secvote.core.config import Settings
from secvote.db.models import User

from .conftest import VOTER_PW, csrf, last_otp, signup_voter


async def test_signup_requires_institution_domain(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/api/v1/auth/register", json={"email": "x@gmail.com", "name": "X Y", "password": VOTER_PW}
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "email_domain_not_allowed"


async def test_signup_verify_login_logout(client: httpx.AsyncClient, settings: Settings) -> None:
    email = f"u{uuid.uuid4().hex[:6]}@example.edu.in"
    r = await client.post("/api/v1/auth/register", json={"email": email, "name": "U V", "password": VOTER_PW})
    assert r.status_code == 201

    # cannot log in before verifying
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": VOTER_PW})
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_not_verified"

    r = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": last_otp(settings, email)})
    assert r.status_code == 200
    assert client.cookies.get("sv_session") and client.cookies.get("sv_csrf")
    me = (await client.get("/api/v1/auth/me")).json()["user"]
    assert me["email"] == email and me["roles"] == ["voter"]

    user = await User.find_one(User.email == email)
    assert user is not None and user.password_hash.startswith("$argon2id$")

    await client.post("/api/v1/auth/logout")
    client.cookies.clear()
    assert (await client.get("/api/v1/auth/me")).json() == {"user": None}

    r = await client.post("/api/v1/auth/login", json={"email": email, "password": VOTER_PW})
    assert r.status_code == 200


async def test_otp_is_hashed_and_limited(client: httpx.AsyncClient, settings: Settings) -> None:
    from secvote.core.redis import get_redis

    email = f"o{uuid.uuid4().hex[:6]}@example.edu.in"
    await client.post("/api/v1/auth/register", json={"email": email, "name": "O P", "password": VOTER_PW})
    code = last_otp(settings, email)
    stored = await get_redis(settings).get(f"otp:verify_email:{email}")
    assert stored is not None and code not in stored and len(stored) == 64  # HMAC-SHA256 hex

    wrong = "000000" if code != "000000" else "111111"
    for _ in range(settings.otp_max_attempts):
        r = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": wrong})
        assert r.status_code == 401
    # sixth attempt locks the code, even if it is correct
    r = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": code})
    assert r.status_code == 429
    r = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": code})
    assert r.status_code == 401  # code destroyed; must request a new one


async def test_wrong_password_rejected(client: httpx.AsyncClient, settings: Settings) -> None:
    email = await signup_voter(client, settings)
    client.cookies.clear()
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "not-the-password"})
    assert r.status_code == 401


async def test_forgot_password(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    from secvote.core.redis import get_redis

    async with new_client() as old_device, new_client() as c:
        email = await signup_voter(old_device, settings)
        assert (await old_device.get("/api/v1/auth/me")).json()["user"] is not None

        # unknown addresses get the same answer, and no code is stored for them
        r = await c.post("/api/v1/auth/password/forgot", json={"email": "nobody@example.edu.in"})
        assert r.status_code == 200
        assert await get_redis(settings).get("otp:reset_password:nobody@example.edu.in") is None

        r = await c.post("/api/v1/auth/password/forgot", json={"email": email})
        assert r.status_code == 200
        code = last_otp(settings, email)
        # a sign-up code can't be used to reset, and vice versa
        r = await c.post("/api/v1/auth/otp/verify", json={"email": email, "code": code})
        assert r.status_code == 401
        r = await c.post(
            "/api/v1/auth/password/reset", json={"email": email, "code": code, "password": "short"}
        )
        assert r.status_code == 422
        new_pw = "a-brand-new-passphrase"
        r = await c.post(
            "/api/v1/auth/password/reset", json={"email": email, "code": code, "password": new_pw}
        )
        assert r.status_code == 200, r.text

        # the old password no longer works, the new one does, and the old session is signed out
        r = await c.post("/api/v1/auth/login", json={"email": email, "password": VOTER_PW})
        assert r.status_code == 401
        r = await c.post("/api/v1/auth/login", json={"email": email, "password": new_pw})
        assert r.status_code == 200
        assert (await old_device.get("/api/v1/auth/me")).json()["user"] is None
        assert (await c.get("/api/v1/auth/me")).json()["user"]["email"] == email
        # the code was used up
        r = await c.post(
            "/api/v1/auth/password/reset", json={"email": email, "code": code, "password": new_pw}
        )
        assert r.status_code == 401


async def test_change_password(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as laptop, new_client() as phone:
        email = await signup_voter(laptop, settings)
        r = await phone.post("/api/v1/auth/login", json={"email": email, "password": VOTER_PW})
        assert r.status_code == 200

        r = await laptop.post(
            "/api/v1/auth/password/change",
            json={"current_password": "wrong-password!", "new_password": "another-passphrase"},
            headers=csrf(laptop),
        )
        assert r.status_code == 401
        r = await laptop.post(
            "/api/v1/auth/password/change",
            json={"current_password": VOTER_PW, "new_password": VOTER_PW},
            headers=csrf(laptop),
        )
        assert r.status_code == 409 and r.json()["error"]["code"] == "same_password"
        r = await laptop.post(
            "/api/v1/auth/password/change",
            json={"current_password": VOTER_PW, "new_password": "another-passphrase"},
            headers=csrf(laptop),
        )
        assert r.status_code == 200, r.text
        # this device stays signed in with a fresh session; the other device is signed out
        assert (await laptop.get("/api/v1/auth/me")).json()["user"]["email"] == email
        assert (await phone.get("/api/v1/auth/me")).json()["user"] is None


async def test_csrf_required_for_writes(client: httpx.AsyncClient, settings: Settings) -> None:
    await signup_voter(client, settings)
    r = await client.post(
        "/api/v1/registrations/abc/commitment", json={"commitment": "1", "enrol_code": "000000"}
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf"
    r = await client.post(
        "/api/v1/registrations/abc/commitment",
        json={"commitment": "1", "enrol_code": "000000"},
        headers={"x-csrf-token": "forged"},
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/v1/registrations/abc/commitment",
        json={"commitment": "1", "enrol_code": "000000"},
        headers=csrf(client),
    )
    assert r.status_code == 404  # passed CSRF, reached the service


async def test_auth_config_lists_domains(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/auth/config")
    assert r.json() == {"allowed_email_domains": ["example.edu.in"]}


async def test_stale_session_cookie_is_cleared(client: httpx.AsyncClient) -> None:
    client.cookies.set("sv_session", "from-a-previous-api-run")
    r = await client.get("/api/v1/auth/me")
    assert r.json() == {"user": None}
    assert 'sv_session=""' in r.headers.get("set-cookie", "") or "Max-Age=0" in r.headers.get(
        "set-cookie", ""
    )


async def test_no_seeded_admin(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/api/v1/auth/login", json={"email": "admin@example.edu.in", "password": "admin123"}
    )
    assert r.status_code in (401, 403)


async def test_delete_account_erases_personal_data(client: httpx.AsyncClient, settings: Settings) -> None:
    email = await signup_voter(client, settings)
    r = await client.post("/api/v1/auth/me/delete", headers=csrf(client))
    assert r.status_code == 200
    assert await User.find_one(User.email == email) is None
