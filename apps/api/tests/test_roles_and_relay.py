from __future__ import annotations

import httpx
import pytest

from secvote.core.config import Settings
from secvote.services import audit

from .conftest import csrf, election_body, make_admin, published_election, signup_voter

ADMIN_ENDPOINTS = [
    ("GET", "/api/v1/admin/elections"),
    ("POST", "/api/v1/admin/elections"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/publish"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/freeze"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/pause"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/declare"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/end-registration"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/start-voting"),
    ("POST", "/api/v1/admin/elections/000000000000000000000000/end-voting"),
    ("GET", "/api/v1/admin/elections/000000000000000000000000/registrations"),
    ("POST", "/api/v1/admin/registrations/000000000000000000000000/approve"),
    ("GET", "/api/v1/admin/audit"),
]


@pytest.mark.parametrize("method,path", ADMIN_ENDPOINTS)
async def test_anonymous_gets_401(client: httpx.AsyncClient, method: str, path: str) -> None:
    body = election_body() if path.endswith("/elections") and method == "POST" else None
    r = await client.request(method, path, json=body)
    assert r.status_code == 401


@pytest.mark.parametrize("method,path", ADMIN_ENDPOINTS)
async def test_voter_gets_403(new_client, settings: Settings, method: str, path: str) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as voter:
        await signup_voter(voter, settings)
        body = election_body() if path.endswith("/elections") and method == "POST" else None
        r = await voter.request(method, path, json=body, headers=csrf(voter))
        assert r.status_code == 403, r.text


async def test_bad_schedule_rejected(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    body = election_body()
    body["vote_start"], body["reg_end"] = body["reg_end"], body["vote_start"]
    r = await client.post("/api/v1/admin/elections", json=body, headers=csrf(client))
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_schedule"


async def test_published_draft_is_immutable(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    e = await published_election(client)
    r = await client.put(f"/api/v1/admin/elections/{e['id']}", json=election_body(), headers=csrf(client))
    assert r.status_code == 409


async def test_public_listing_hides_drafts(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    r = await client.post(
        "/api/v1/admin/elections", json=election_body(title="Hidden draft"), headers=csrf(client)
    )
    draft_id = r.json()["id"]
    assert (await client.get(f"/api/v1/elections/{draft_id}")).status_code == 404
    listed = (await client.get("/api/v1/elections")).json()["items"]
    assert draft_id not in [x["id"] for x in listed]


async def test_ballot_relay_is_anonymous_and_checks_phase(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    e = await published_election(client)  # registration phase
    proof = {
        "merkleTreeDepth": 1,
        "merkleTreeRoot": "1",
        "nullifier": "2",
        "message": "3",
        "scope": "12345",
        "points": ["0"] * 8,
    }
    anon = httpx.AsyncClient(transport=client._transport, base_url="http://testserver")  # no cookies
    r = await anon.post(
        "/api/v1/ballots", json={"election_id": e["id"], "proof": proof, "ballot": "0x" + "00" * 64}
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_phase"
    assert (await anon.get("/api/v1/ballots/nope")).status_code == 404
    await anon.aclose()


async def test_audit_log_is_hash_chained(client: httpx.AsyncClient) -> None:
    from secvote.db.models import AuditEvent

    await make_admin(client)
    await published_election(client)
    assert await audit.verify_chain()
    ev = await AuditEvent.find_all().sort("-seq").first_or_none()
    assert ev is not None
    ev.data = {"tampered": True}
    await ev.save()
    assert not await audit.verify_chain()
    r = await client.get("/api/v1/admin/audit")
    assert r.json()["chain_valid"] is False
    await ev.delete()  # keep later tests clean


async def test_officer_can_end_registration_early(client: httpx.AsyncClient) -> None:
    from beanie import PydanticObjectId

    from secvote.db.models import ChainTx, Election
    from secvote.domain.enums import TxKind

    await make_admin(client)
    e = await published_election(client)
    # an empty roll can't be frozen: nobody could ever vote
    r = await client.post(f"/api/v1/admin/elections/{e['id']}/start-voting", headers=csrf(client))
    assert r.status_code == 409 and r.json()["error"]["code"] == "empty_roll"
    doc = await Election.get(PydanticObjectId(e["id"]))
    assert doc is not None
    doc.member_count = 1  # one voter on the on-chain roll
    await doc.save()

    r = await client.post(f"/api/v1/admin/elections/{e['id']}/start-voting", headers=csrf(client))
    assert r.status_code == 200, r.text
    tx = await ChainTx.find_one(
        ChainTx.kind == TxKind.START_VOTING, ChainTx.election_id == PydanticObjectId(e["id"])
    )
    assert tx is not None
    # a second click does not queue a duplicate
    await client.post(f"/api/v1/admin/elections/{e['id']}/start-voting", headers=csrf(client))
    n = await ChainTx.find(
        ChainTx.kind == TxKind.START_VOTING, ChainTx.election_id == PydanticObjectId(e["id"])
    ).count()
    assert n == 1


async def test_end_registration_refused_while_roll_is_busy(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    from secvote.db.models import Registration
    from secvote.domain.enums import RegistrationStatus

    async with new_client() as admin:
        await make_admin(admin)
        e = await published_election(admin)
        from beanie import PydanticObjectId

        await Registration(
            user_id=PydanticObjectId(),
            election_id=PydanticObjectId(e["id"]),
            reg_no="BUSY1",
            department="CSE",
            year=1,
            status=RegistrationStatus.COMMITMENT_SUBMITTED,
            commitment="123",
        ).insert()
        r = await admin.post(f"/api/v1/admin/elections/{e['id']}/end-registration", headers=csrf(admin))
        assert r.status_code == 409 and r.json()["error"]["code"] == "roll_busy"
        status = (await admin.get(f"/api/v1/admin/elections/{e['id']}")).json()["roll_status"]
        assert status["joining_roll"] == 1


async def test_end_registration_wrong_phase(client: httpx.AsyncClient) -> None:
    from datetime import timedelta

    from secvote.domain.phases import now_utc

    await make_admin(client)
    t = now_utc()
    e = await published_election(
        client,
        reg_start=(t + timedelta(hours=1)).isoformat(),
        reg_end=(t + timedelta(hours=2)).isoformat(),
    )
    r = await client.post(f"/api/v1/admin/elections/{e['id']}/end-registration", headers=csrf(client))
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_phase"


async def test_end_voting_only_while_voting(client: httpx.AsyncClient) -> None:
    await make_admin(client)
    e = await published_election(client)  # registration phase
    r = await client.post(f"/api/v1/admin/elections/{e['id']}/end-voting", headers=csrf(client))
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_phase"


async def test_results_withheld_until_declared(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        r = (await voter.get(f"/api/v1/elections/{e['id']}/results")).json()
        assert r["published"] is False and r["races"] is None and r["computed_hash"] is None
        preview = (await admin.get(f"/api/v1/admin/elections/{e['id']}/results")).json()
        assert preview["preview"] is True and preview["races"] is not None
        await signup_voter(voter, settings)
        assert (await voter.get(f"/api/v1/admin/elections/{e['id']}/results")).status_code == 403
