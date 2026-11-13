"""Officials management, audit log view and draft deletion."""

from __future__ import annotations

import httpx

from secvote.core.config import Settings

from .conftest import csrf, election_body, mailbox_code, make_admin, published_election, signup_voter


async def test_grant_and_revoke_roles(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as other:
        await make_admin(admin)
        email = await signup_voter(other, settings)
        found = (await admin.get("/api/v1/admin/users", params={"q": email[:8]})).json()["items"]
        uid = next(u["id"] for u in found if u["email"] == email)

        r = await admin.post(
            f"/api/v1/admin/users/{uid}/roles", json={"role": "officer"}, headers=csrf(admin)
        )
        assert "officer" in r.json()["roles"]
        r = await admin.delete(f"/api/v1/admin/users/{uid}/roles/officer", headers=csrf(admin))
        assert r.status_code == 200 and "officer" not in r.json()["roles"]
        r = await admin.delete(f"/api/v1/admin/users/{uid}/roles/voter", headers=csrf(admin))
        assert r.status_code == 409

        # voters can't manage roles
        assert (await other.get("/api/v1/admin/users")).status_code == 403


async def test_owner_cannot_lock_themselves_out(new_client) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as owner:
        await make_admin(owner, owner=True)
        me = (await owner.get("/api/v1/auth/me")).json()["user"]
        for role in ("owner", "admin"):
            r = await owner.delete(f"/api/v1/admin/users/{me['id']}/roles/{role}", headers=csrf(owner))
            assert r.status_code == 409 and r.json()["error"]["code"] in ("self_lockout", "owner_is_admin")


async def _uid(c: httpx.AsyncClient, email: str) -> str:
    found = (await c.get("/api/v1/admin/users", params={"q": email})).json()["items"]
    return next(u["id"] for u in found if u["email"] == email)


async def test_only_super_admins_create_and_approve_admins(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as owner, new_client() as owner2, new_client() as admin, new_client() as voter:
        await make_admin(owner, owner=True)
        await make_admin(owner2, owner=True)  # a second super admin
        await make_admin(admin)  # an ordinary election admin
        email = await signup_voter(voter, settings)
        uid = await _uid(owner, email)

        # a plain admin can hand out officer roles, but not admin
        r = await admin.post(f"/api/v1/admin/users/{uid}/roles", json={"role": "admin"}, headers=csrf(admin))
        assert r.status_code == 403
        r = await admin.post(
            f"/api/v1/admin/users/{uid}/roles", json={"role": "officer"}, headers=csrf(admin)
        )
        assert r.status_code == 200 and r.json()["pending"] is False and "officer" in r.json()["roles"]

        # the super admin's request waits for a different super admin
        r = await owner.post(f"/api/v1/admin/users/{uid}/roles", json={"role": "admin"}, headers=csrf(owner))
        assert r.status_code == 200 and r.json()["pending"] is True and "admin" not in r.json()["roles"]
        mail = _last_mail(settings, email=None, subject="Approval needed")
        assert mail is not None and "Officials" in mail["body"]
        r = await owner.post(f"/api/v1/admin/users/{uid}/roles", json={"role": "admin"}, headers=csrf(owner))
        assert r.status_code == 409 and r.json()["error"]["code"] == "already_requested"

        items = (await owner.get("/api/v1/admin/role-requests")).json()["items"]
        req = next(i for i in items if i["user"]["id"] == uid)
        assert req["can_approve"] is False  # the requester can't approve their own request
        r = await owner.post(f"/api/v1/admin/role-requests/{req['id']}/approve", headers=csrf(owner))
        assert r.status_code == 403 and r.json()["error"]["code"] == "needs_second_approver"

        # an ordinary admin can never authorise a new administrator
        mine = next(
            i
            for i in (await admin.get("/api/v1/admin/role-requests")).json()["items"]
            if i["id"] == req["id"]
        )
        assert mine["can_approve"] is False
        r = await admin.post(f"/api/v1/admin/role-requests/{req['id']}/approve", headers=csrf(admin))
        assert r.status_code == 403

        theirs = next(
            i
            for i in (await owner2.get("/api/v1/admin/role-requests")).json()["items"]
            if i["id"] == req["id"]
        )
        assert theirs["can_approve"] is True
        r = await owner2.post(f"/api/v1/admin/role-requests/{req['id']}/approve", headers=csrf(owner2))
        assert r.status_code == 200 and "admin" in r.json()["roles"]
        assert _last_mail(settings, email=None, subject="is now Election admin") is not None
        assert not [
            i
            for i in (await owner.get("/api/v1/admin/role-requests")).json()["items"]
            if i["id"] == req["id"]
        ]

        # only super admins remove admins
        r = await admin.delete(f"/api/v1/admin/users/{uid}/roles/admin", headers=csrf(admin))
        assert r.status_code == 403
        r = await owner.delete(f"/api/v1/admin/users/{uid}/roles/admin", headers=csrf(owner))
        assert r.status_code == 200 and "admin" not in r.json()["roles"]


async def test_role_request_can_be_declined(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as owner, new_client() as owner2, new_client() as admin, new_client() as voter:
        await make_admin(owner, owner=True)
        await make_admin(owner2, owner=True)  # so the request has to wait for approval
        await make_admin(admin)  # declining is allowed for any admin: it never grants power
        email = await signup_voter(voter, settings)
        uid = await _uid(owner, email)
        await owner.post(f"/api/v1/admin/users/{uid}/roles", json={"role": "admin"}, headers=csrf(owner))
        req = next(
            i
            for i in (await admin.get("/api/v1/admin/role-requests")).json()["items"]
            if i["user"]["id"] == uid
        )
        r = await admin.delete(f"/api/v1/admin/role-requests/{req['id']}", headers=csrf(admin))
        assert r.status_code == 200
        me = (await voter.get("/api/v1/auth/me")).json()["user"]
        assert "admin" not in me["roles"]


async def test_officials_confirm_sign_in_with_a_code(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    from .conftest import ADMIN_PW

    async with new_client() as setup, new_client() as c:
        email = await make_admin(setup)
        r = await c.post("/api/v1/auth/login", json={"email": email, "password": ADMIN_PW})
        assert r.status_code == 200 and r.json() == {"user": None, "code_required": True, "email": email}
        assert c.cookies.get("sv_session") is None  # the password alone gives no session
        r = await c.post("/api/v1/auth/login/code", json={"email": email, "code": "000000"})
        assert r.status_code in (401, 429)
        r = await c.post("/api/v1/auth/login", json={"email": email, "password": ADMIN_PW})
        code = mailbox_code(email, "sign-in")
        r = await c.post("/api/v1/auth/login/code", json={"email": email, "code": code})
        assert r.status_code == 200 and r.json()["user"]["email"] == email
        # a code without a fresh password step is refused
        async with new_client() as other:
            r = await other.post("/api/v1/auth/login/code", json={"email": email, "code": code})
            assert r.status_code == 401


def _last_mail(settings: Settings, *, email: str | None, subject: str) -> dict[str, str] | None:
    import json

    lines = [json.loads(x) for x in settings.mailbox_file.read_text().splitlines()]
    return next(
        (m for m in reversed(lines) if subject in m["subject"] and (email is None or m["to"] == email)), None
    )


async def test_delete_only_unpublished_drafts(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    draft = (await client.post("/api/v1/admin/elections", json=election_body(), headers=csrf(client))).json()
    r = await client.delete(f"/api/v1/admin/elections/{draft['id']}", headers=csrf(client))
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/admin/elections/{draft['id']}")).status_code == 404

    published = await published_election(client)
    r = await client.delete(f"/api/v1/admin/elections/{published['id']}", headers=csrf(client))
    assert r.status_code == 409


async def test_draft_rules(client: httpx.AsyncClient) -> None:
    from datetime import timedelta

    from secvote.domain.phases import now_utc

    await make_admin(client)
    races = [{"title": "President", "candidates": [{"name": "Asha"}, {"name": "asha "}]}]
    r = await client.post("/api/v1/admin/elections", json=election_body(races=races), headers=csrf(client))
    assert r.status_code == 400 and r.json()["error"]["code"] == "duplicate_candidate"
    races = [
        {"title": "President", "candidates": [{"name": "A"}]},
        {"title": "president", "candidates": [{"name": "B"}]},
    ]
    r = await client.post("/api/v1/admin/elections", json=election_body(races=races), headers=csrf(client))
    assert r.status_code == 400 and r.json()["error"]["code"] == "duplicate_post"

    # a draft whose registration window has passed can't be published, but can be edited and then published
    t = now_utc()
    stale = {
        "reg_start": (t - timedelta(hours=3)).isoformat(),
        "reg_end": (t - timedelta(hours=2)).isoformat(),
        "vote_start": (t - timedelta(hours=1)).isoformat(),
        "vote_end": (t + timedelta(hours=1)).isoformat(),
    }
    draft = (
        await client.post("/api/v1/admin/elections", json=election_body(**stale), headers=csrf(client))
    ).json()
    r = await client.post(f"/api/v1/admin/elections/{draft['id']}/publish", headers=csrf(client))
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_schedule"
    r = await client.put(
        f"/api/v1/admin/elections/{draft['id']}",
        json=election_body(title="Fixed dates"),
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["title"] == "Fixed dates"
    r = await client.post(f"/api/v1/admin/elections/{draft['id']}/publish", headers=csrf(client))
    assert r.status_code == 200, r.text


async def test_audit_log_names_actors(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    await client.post("/api/v1/admin/elections", json=election_body(), headers=csrf(client))
    log = (await client.get("/api/v1/admin/audit")).json()
    assert log["items"] and log["items"][0]["actor"] in ("Admin", "Admin 2", "System")


async def test_last_admin_cannot_delete_account(client: httpx.AsyncClient) -> None:
    from secvote.db.models import User

    await make_admin(client)
    admins = await User.find({"roles": "admin", "deleted_at": None}).count()
    r = await client.post("/api/v1/auth/me/delete", headers=csrf(client))
    assert (r.status_code == 409) == (admins <= 1)
