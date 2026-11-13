"""Lost passphrase: a voter's identity can be replaced on the roll, only with an official's approval,
and only while registration is open."""

from __future__ import annotations

import httpx
from beanie import PydanticObjectId

from secvote.core.config import Settings
from secvote.db.models import ChainTx, Election, Member, Registration
from secvote.domain.enums import RegistrationStatus, TxKind

from .conftest import PDF, csrf, enrol_code, make_admin, published_election, signup_voter

OLD = "19014214495641488759237505126948346942972912379615652741039992445865937985820"
NEW = "123456789012345678901234567890"


async def _enrolled(
    admin: httpx.AsyncClient, voter: httpx.AsyncClient, settings: Settings, reg_no: str
) -> tuple[dict, str, str]:  # type: ignore[type-arg]
    """A published election and a voter whose identity is on the (simulated) on-chain roll."""
    e = await published_election(admin)
    email = await signup_voter(voter, settings)
    r = await voter.post(
        f"/api/v1/elections/{e['id']}/registrations",
        data={"reg_no": reg_no, "department": "CSE", "year": "2", "consent": "true"},
        files={"id_document": ("id.pdf", PDF, "application/pdf")},
        headers=csrf(voter),
    )
    reg_id = r.json()["id"]
    await admin.post(f"/api/v1/admin/registrations/{reg_id}/approve", headers=csrf(admin))
    await voter.post(
        f"/api/v1/registrations/{reg_id}/commitment",
        json={"commitment": OLD, "enrol_code": enrol_code(settings, email)},
        headers=csrf(voter),
    )
    # what the indexer does once addMembers is mined
    reg = await Registration.get(PydanticObjectId(reg_id))
    assert reg is not None
    reg.status, reg.member_index = RegistrationStatus.ENROLLED, 0
    await reg.save()
    await Member(election_id=reg.election_id, index=0, commitment=OLD).insert()
    return e, reg_id, email


async def test_reset_needs_approval_then_replaces_in_place(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e, reg_id, email = await _enrolled(admin, voter, settings, "25RS001")

        # nothing can be replaced without an approved reset
        r = await voter.post(
            f"/api/v1/registrations/{reg_id}/replace",
            json={"commitment": NEW, "enrol_code": "000000", "siblings": []},
            headers=csrf(voter),
        )
        assert r.status_code == 409

        r = await voter.post(f"/api/v1/registrations/{reg_id}/reset", headers=csrf(voter))
        assert r.status_code == 200 and r.json()["reset_status"] == "requested"
        r = await voter.post(f"/api/v1/registrations/{reg_id}/reset", headers=csrf(voter))
        assert r.status_code == 409 and r.json()["error"]["code"] == "reset_pending"

        items = (await admin.get(f"/api/v1/admin/elections/{e['id']}/resets")).json()["items"]
        assert [i["id"] for i in items] == [reg_id] and items[0]["on_roll"] is True
        assert (await voter.get(f"/api/v1/admin/elections/{e['id']}/resets")).status_code == 403

        r = await admin.post(f"/api/v1/admin/registrations/{reg_id}/reset/approve", headers=csrf(admin))
        assert r.status_code == 200 and r.json()["reset_status"] == "approved"
        code = enrol_code(settings, email)  # a fresh code is emailed for the new identity

        r = await voter.post(
            f"/api/v1/registrations/{reg_id}/replace",
            json={"commitment": NEW, "enrol_code": code, "siblings": []},
            headers=csrf(voter),
        )
        assert r.status_code == 200, r.text
        assert r.json()["replacing"] is True
        tx = await ChainTx.find_one(ChainTx.kind == TxKind.REPLACE_MEMBER, ChainTx.payload["new"] == NEW)
        assert tx is not None and tx.payload["old"] == OLD and tx.payload["siblings"] == []
        # while it's on its way, a second attempt is refused
        r = await voter.post(
            f"/api/v1/registrations/{reg_id}/replace",
            json={"commitment": NEW, "enrol_code": code, "siblings": []},
            headers=csrf(voter),
        )
        assert r.status_code == 409


async def test_reset_decline_and_rules(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e, reg_id, _email = await _enrolled(admin, voter, settings, "25RS002")
        await voter.post(f"/api/v1/registrations/{reg_id}/reset", headers=csrf(voter))
        r = await admin.post(f"/api/v1/admin/registrations/{reg_id}/reset/decline", headers=csrf(admin))
        assert r.status_code == 200 and r.json()["reset_status"] is None
        lines = settings.mailbox_file.read_text()
        assert "was not approved" in lines

        # once the roll is frozen, no reset is possible
        doc = await Election.get(PydanticObjectId(e["id"]))
        assert doc is not None
        doc.frozen = True
        await doc.save()
        r = await voter.post(f"/api/v1/registrations/{reg_id}/reset", headers=csrf(voter))
        assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_phase"


async def test_reset_before_on_roll_restarts_identity_step(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        email = await signup_voter(voter, settings)
        r = await voter.post(
            f"/api/v1/elections/{e['id']}/registrations",
            data={"reg_no": "25RS003", "department": "CSE", "year": "2", "consent": "true"},
            files={"id_document": ("id.pdf", PDF, "application/pdf")},
            headers=csrf(voter),
        )
        reg_id = r.json()["id"]
        await admin.post(f"/api/v1/admin/registrations/{reg_id}/approve", headers=csrf(admin))
        await voter.post(
            f"/api/v1/registrations/{reg_id}/commitment",
            json={"commitment": OLD[:-1] + "1", "enrol_code": enrol_code(settings, email)},
            headers=csrf(voter),
        )
        await voter.post(f"/api/v1/registrations/{reg_id}/reset", headers=csrf(voter))
        r = await admin.post(f"/api/v1/admin/registrations/{reg_id}/reset/approve", headers=csrf(admin))
        # not on chain yet: simply back to "create your identity"
        assert (
            r.json()["status"] == "approved"
            and r.json()["commitment"] is None
            and r.json()["reset_status"] is None
        )
