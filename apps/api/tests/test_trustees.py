"""Trustee + key ceremony rules (off-chain parts)."""

from __future__ import annotations

import httpx

from secvote.core.config import Settings

from .conftest import csrf, election_body, make_admin, signup_voter
from .sealed_helpers import keypair, seal_share, split


async def _sealed_draft(admin: httpx.AsyncClient) -> str:
    body = election_body(mode="sealed")
    body["races"][1]["method"] = "irv"
    r = await admin.post("/api/v1/admin/elections", json=body, headers=csrf(admin))
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def test_irv_requires_sealed(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    body = election_body()
    body["races"][0]["method"] = "irv"
    r = await client.post("/api/v1/admin/elections", json=body, headers=csrf(client))
    assert r.status_code == 400 and r.json()["error"]["code"] == "irv_needs_sealed"


async def test_ceremony_flow_and_rules(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as t1, new_client() as t2, new_client() as t3:
        await make_admin(admin)
        eid = await _sealed_draft(admin)

        # sealed elections can't be published before the ceremony
        r = await admin.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(admin))
        assert r.status_code == 400 and r.json()["error"]["code"] == "no_ceremony"

        clients, keys = [t1, t2, t3], []
        for c in clients:
            email = await signup_voter(c, settings)
            r = await admin.post(
                f"/api/v1/admin/elections/{eid}/trustees", json={"email": email}, headers=csrf(admin)
            )
            assert r.status_code == 201, r.text
        r = await admin.post(
            f"/api/v1/admin/elections/{eid}/trustees",
            json={"email": "nobody@example.edu.in"},
            headers=csrf(admin),
        )
        assert r.status_code == 404

        # ceremony refused until every trustee has registered a key
        sk_e, pk_e = keypair()
        trustees = (await admin.get(f"/api/v1/admin/elections/{eid}")).json()["trustees"]
        assert len(trustees) == 3 and not any(t["key_registered"] for t in trustees)
        fake = {
            "public_key": pk_e,
            "shares": [{"trustee_id": t["id"], "encrypted_share": "0xab"} for t in trustees],
        }
        r = await admin.post(f"/api/v1/admin/elections/{eid}/ceremony", json=fake, headers=csrf(admin))
        assert r.status_code == 409

        for c in clients:
            (await c.get("/api/v1/auth/me"))  # refresh session roles
            sk, pk = keypair()
            keys.append(sk)
            r = await c.post(f"/api/v1/trustee/elections/{eid}/key", json={"public_key": pk}, headers=csrf(c))
            assert r.status_code == 200, r.text
        r = await t1.post(
            f"/api/v1/trustee/elections/{eid}/key", json={"public_key": "0x04abc"}, headers=csrf(t1)
        )
        assert r.status_code == 400  # must be a compressed key

        trustees = (await admin.get(f"/api/v1/admin/elections/{eid}")).json()["trustees"]
        shares = split(sk_e)
        payload = {
            "public_key": pk_e,
            "shares": [
                {
                    "trustee_id": t["id"],
                    "encrypted_share": seal_share(t["public_key"], *shares[t["slot"] - 1]),
                }
                for t in trustees
            ],
        }
        r = await admin.post(f"/api/v1/admin/elections/{eid}/ceremony", json=payload, headers=csrf(admin))
        assert r.status_code == 200, r.text
        assert r.json()["public_key"] == pk_e

        # each trustee sees only their own encrypted share; nobody can release before close
        mine = (await t1.get(f"/api/v1/trustee/elections/{eid}/share")).json()
        assert (
            mine["slot"] == 1
            and mine["encrypted_share"].startswith("0x")
            and mine["election_public_key"] == pk_e
        )
        r = await t1.post(
            f"/api/v1/trustee/elections/{eid}/share", json={"x": 1, "y": shares[0][1]}, headers=csrf(t1)
        )
        assert r.status_code == 409
        listed = (await t2.get("/api/v1/trustee/elections")).json()["items"]
        assert listed[0]["ceremony_done"] and listed[0]["share_issued"]

        # a non-trustee can't read shares; re-registering a key invalidates the ceremony
        async with new_client() as outsider:
            await signup_voter(outsider, settings)
            assert (await outsider.get(f"/api/v1/trustee/elections/{eid}/share")).status_code == 403
        await t3.post(
            f"/api/v1/trustee/elections/{eid}/key", json={"public_key": keypair()[1]}, headers=csrf(t3)
        )
        e = (await admin.get(f"/api/v1/admin/elections/{eid}")).json()
        assert e["chain"]["public_key"] is None and not any(t["share_issued"] for t in e["trustees"])
