"""Officials management, audit log view and draft deletion."""

from __future__ import annotations

import httpx

from secvote.core.config import Settings

from .conftest import csrf, election_body, make_admin, published_election, signup_voter


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


async def test_admin_cannot_lock_themselves_out(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    me = (await client.get("/api/v1/auth/me")).json()["user"]
    r = await client.delete(f"/api/v1/admin/users/{me['id']}/roles/admin", headers=csrf(client))
    assert r.status_code == 409 and r.json()["error"]["code"] in ("self_lockout", "last_admin")


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
