"""Phase 1 gate: a voter registers and is approved end to end (off-chain)."""

from __future__ import annotations

import httpx
from beanie import PydanticObjectId

from secvote.core.config import Settings
from secvote.db.models import ChainTx, Registration, StoredDocument
from secvote.domain.enums import RegistrationStatus, TxKind
from secvote.domain.phases import as_utc, now_utc

from .conftest import PDF, csrf, enrol_code, make_admin, published_election, signup_voter

COMMITMENT = "19014214495641488759237505126948346942972912379615652741039992445865937985820"


async def _apply(c: httpx.AsyncClient, eid: str, reg_no: str, data: bytes = PDF) -> httpx.Response:
    return await c.post(
        f"/api/v1/elections/{eid}/registrations",
        data={"reg_no": reg_no, "department": "CSE", "year": "3", "consent": "true"},
        files={"id_document": ("id.pdf", data, "application/pdf")},
        headers=csrf(c),
    )


async def test_full_registration_flow(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        eid = e["id"]
        assert e["status"] == "deploying"
        assert await ChainTx.find_one(
            ChainTx.kind == TxKind.CREATE_ELECTION, ChainTx.election_id == PydanticObjectId(e["id"])
        )

        email = await signup_voter(voter, settings)
        r = await _apply(voter, eid, "21CS001")
        assert r.status_code == 201, r.text
        reg_id = r.json()["id"]
        assert r.json()["status"] == "pending_review"

        # commitment cannot be submitted before approval
        r = await voter.post(
            f"/api/v1/registrations/{reg_id}/commitment",
            json={"commitment": COMMITMENT, "enrol_code": "000000"},
            headers=csrf(voter),
        )
        assert r.status_code == 409

        q = (await admin.get(f"/api/v1/admin/elections/{eid}/registrations?status=pending_review")).json()[
            "items"
        ]
        assert [x["id"] for x in q] == [reg_id]
        doc = await admin.get(f"/api/v1/admin/registrations/{reg_id}/document")
        assert doc.status_code == 200 and doc.content.startswith(b"%PDF")

        r = await admin.post(f"/api/v1/admin/registrations/{reg_id}/approve", headers=csrf(admin))
        assert r.status_code == 200 and r.json()["status"] == "approved"

        code = enrol_code(settings, email)  # emailed on approval
        r = await voter.post(
            f"/api/v1/registrations/{reg_id}/commitment",
            json={"commitment": COMMITMENT, "enrol_code": code},
            headers=csrf(voter),
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "commitment_submitted"

        mine = (await voter.get("/api/v1/me/registrations")).json()["items"]
        assert mine[0]["status"] == "commitment_submitted" and mine[0]["election_title"]


async def test_two_person_rule_for_high_stakes(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as a1, new_client() as a2, new_client() as voter:
        await make_admin(a1)
        await make_admin(a2)
        e = await published_election(a1, high_stakes=True)
        await signup_voter(voter, settings)
        reg_id = (await _apply(voter, e["id"], "21CS777")).json()["id"]

        r = await a1.post(f"/api/v1/admin/registrations/{reg_id}/approve", headers=csrf(a1))
        assert r.json()["status"] == "pending_review"
        r = await a1.post(f"/api/v1/admin/registrations/{reg_id}/approve", headers=csrf(a1))
        assert r.status_code == 409 and r.json()["error"]["code"] == "needs_second_approver"
        r = await a2.post(f"/api/v1/admin/registrations/{reg_id}/approve", headers=csrf(a2))
        assert r.json()["status"] == "approved"


async def test_rejected_voter_may_reapply_once(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        await signup_voter(voter, settings)
        r = await _apply(voter, e["id"], "21CS301")
        reg_id = r.json()["id"]
        assert r.json()["attempts"] == 1 and r.json()["can_reapply"] is False

        # can't re-apply while the first application is still pending
        r = await _apply(voter, e["id"], "21CS301")
        assert r.status_code == 409 and r.json()["error"]["code"] == "already_applied"

        r = await admin.post(
            f"/api/v1/admin/registrations/{reg_id}/reject",
            json={"reason": "ID card is blurry"},
            headers=csrf(admin),
        )
        assert r.json()["status"] == "rejected" and r.json()["can_reapply"] is True
        old_doc = (await Registration.get(PydanticObjectId(reg_id))).document_id  # type: ignore[union-attr]

        # second (and last) attempt reuses the same registration and goes back to review
        r = await _apply(voter, e["id"], "21CS301")
        assert r.status_code == 201, r.text
        assert (
            r.json()["id"] == reg_id and r.json()["status"] == "pending_review" and r.json()["attempts"] == 2
        )
        assert r.json()["reject_reason"] is None
        q = (await admin.get(f"/api/v1/admin/elections/{e['id']}/registrations")).json()["items"]
        assert q[0]["attempts"] == 2 and q[0]["previous_reject_reason"] == "ID card is blurry"
        reg = await Registration.get(PydanticObjectId(reg_id))
        assert reg is not None and reg.document_id != old_doc and reg.approvals == []
        old = await StoredDocument.get(old_doc)  # type: ignore[arg-type]
        assert old is not None and old.delete_after is not None and as_utc(old.delete_after) <= now_utc()

        # rejected a second time: final
        r = await admin.post(
            f"/api/v1/admin/registrations/{reg_id}/reject",
            json={"reason": "Not enrolled here"},
            headers=csrf(admin),
        )
        assert r.json()["can_reapply"] is False
        r = await _apply(voter, e["id"], "21CS301")
        assert r.status_code == 409 and r.json()["error"]["code"] == "reapply_limit"
        mine = (await voter.get("/api/v1/me/registrations")).json()["items"]
        assert mine[0]["status"] == "rejected" and mine[0]["can_reapply"] is False


def _last_mail(settings: Settings, email: str) -> dict[str, str]:
    import json

    lines = [json.loads(x) for x in settings.mailbox_file.read_text().splitlines()]
    return next(m for m in reversed(lines) if m["to"] == email)


async def test_rejection_is_emailed(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        email = await signup_voter(voter, settings)
        reg_id = (await _apply(voter, e["id"], "21CS310")).json()["id"]
        await admin.post(
            f"/api/v1/admin/registrations/{reg_id}/reject",
            json={"reason": "Wrong ID card"},
            headers=csrf(admin),
        )
        mail = _last_mail(settings, email)
        assert "not approved" in mail["subject"] and "Reason: Wrong ID card" in mail["body"]
        assert f"/elections/{e['slug']}/register" in mail["body"] and "last attempt" in mail["body"]

        await _apply(voter, e["id"], "21CS310")
        await admin.post(
            f"/api/v1/admin/registrations/{reg_id}/reject",
            json={"reason": "Still wrong"},
            headers=csrf(admin),
        )
        mail = _last_mail(settings, email)
        assert "can't apply again" in mail["body"] and "/register" not in mail["body"]


async def test_eligibility_list(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as early, new_client() as listed, new_client() as other:
        await make_admin(admin)
        e = await published_election(admin)
        eid = e["id"]

        # someone applies before the list exists: they wait for review ...
        await signup_voter(early, settings)
        early_reg = (await _apply(early, eid, "21EE001")).json()
        assert early_reg["status"] == "pending_review"

        # ... and are approved the moment the office uploads a list containing them
        r = await admin.put(
            f"/api/v1/admin/elections/{eid}/eligibility",
            json={"reg_nos": [" 21ee001 ", "21EE002", "21EE002", ""], "eligible_only": False},
            headers=csrf(admin),
        )
        assert r.status_code == 200, r.text
        assert r.json()["count"] == 2 and r.json()["auto_approved"] == 1
        mine = (await early.get("/api/v1/me/registrations")).json()["items"][0]
        assert mine["status"] == "approved" and mine["auto_approved"] is True and mine["enrol_code_sent"]

        # listed applicants are approved on the spot; others still apply and wait for review
        email = await signup_voter(listed, settings)
        r = await _apply(listed, eid, "21ee002")
        assert r.json()["status"] == "approved" and r.json()["auto_approved"] is True
        assert enrol_code(settings, email)
        await signup_voter(other, settings)
        assert (await _apply(other, eid, "21EE999")).json()["status"] == "pending_review"
        q = (await admin.get(f"/api/v1/admin/elections/{eid}/registrations")).json()["items"]
        assert {x["reg_no"]: x["on_list"] for x in q} == {"21EE001": True, "21EE002": True, "21EE999": False}

        # list-only mode turns away numbers that aren't listed, before anything is saved
        r = await admin.put(
            f"/api/v1/admin/elections/{eid}/eligibility",
            json={"reg_nos": ["21EE001", "21EE002", "21EE003"], "eligible_only": True},
            headers=csrf(admin),
        )
        assert r.json()["eligible_only"] is True
        # the setting can be switched without uploading the list again
        r = await admin.put(
            f"/api/v1/admin/elections/{eid}/eligibility", json={"eligible_only": False}, headers=csrf(admin)
        )
        assert r.json()["eligible_only"] is False and r.json()["count"] == 3
        r = await admin.put(
            f"/api/v1/admin/elections/{eid}/eligibility", json={"eligible_only": True}, headers=csrf(admin)
        )
        assert r.json()["eligible_only"] is True
        async with new_client() as late:
            await signup_voter(late, settings)
            r = await _apply(late, eid, "21EE777")
            assert r.status_code == 403 and r.json()["error"]["code"] == "not_on_list"
            assert (await _apply(late, eid, "21EE003")).json()["status"] == "approved"

        # bad input and voter access are refused
        r = await admin.put(
            f"/api/v1/admin/elections/{eid}/eligibility",
            json={"reg_nos": ["<script>"], "eligible_only": False},
            headers=csrf(admin),
        )
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_reg_no"
        r = await admin.put(
            f"/api/v1/admin/elections/{eid}/eligibility",
            json={"reg_nos": [], "eligible_only": True},
            headers=csrf(admin),
        )
        assert r.status_code == 400 and r.json()["error"]["code"] == "empty_list"
        assert (await other.get(f"/api/v1/admin/elections/{eid}/eligibility")).status_code == 403


async def test_high_stakes_list_still_needs_two_officials(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin, high_stakes=True)
        await admin.put(
            f"/api/v1/admin/elections/{e['id']}/eligibility",
            json={"reg_nos": ["21HS001"], "eligible_only": False},
            headers=csrf(admin),
        )
        await signup_voter(voter, settings)
        assert (await _apply(voter, e["id"], "21HS001")).json()["status"] == "pending_review"


async def test_upload_rules(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        await signup_voter(voter, settings)
        r = await _apply(voter, e["id"], "21CS100", data=b"MZ\x90\x00 not a pdf")
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_file_type"
        r = await _apply(voter, e["id"], "21CS100", data=b"%PDF-" + b"0" * (settings.max_upload_bytes + 10))
        assert r.status_code == 400 and r.json()["error"]["code"] == "file_too_large"


async def test_commitment_rules(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin, new_client() as v1, new_client() as v2:
        await make_admin(admin)
        e = await published_election(admin)
        ids, codes = [], []
        for v, reg in ((v1, "21CS201"), (v2, "21CS202")):
            email = await signup_voter(v, settings)
            rid = (await _apply(v, e["id"], reg)).json()["id"]
            await admin.post(f"/api/v1/admin/registrations/{rid}/approve", headers=csrf(admin))
            ids.append(rid)
            codes.append(enrol_code(settings, email))

        bad = await v1.post(
            f"/api/v1/registrations/{ids[0]}/commitment",
            json={"commitment": "0", "enrol_code": codes[0]},
            headers=csrf(v1),
        )
        assert bad.status_code == 400
        too_big = str(2**254)
        bad = await v1.post(
            f"/api/v1/registrations/{ids[0]}/commitment",
            json={"commitment": too_big, "enrol_code": codes[0]},
            headers=csrf(v1),
        )
        assert bad.status_code == 400

        ok = await v1.post(
            f"/api/v1/registrations/{ids[0]}/commitment",
            json={"commitment": COMMITMENT, "enrol_code": codes[0]},
            headers=csrf(v1),
        )
        assert ok.status_code == 200
        dup = await v2.post(
            f"/api/v1/registrations/{ids[1]}/commitment",
            json={"commitment": COMMITMENT, "enrol_code": codes[1]},
            headers=csrf(v2),
        )
        assert dup.status_code == 409

        # another voter cannot touch someone else's registration
        other = await v2.post(
            f"/api/v1/registrations/{ids[0]}/commitment",
            json={"commitment": "5", "enrol_code": codes[1]},
            headers=csrf(v2),
        )
        assert other.status_code == 404


async def test_admin_cannot_approve_self(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    async with new_client() as admin:
        email = await make_admin(admin)
        e = await published_election(admin)
        r = await _apply(admin, e["id"], "ADM001")
        assert r.status_code == 201, (email, r.text)
        r = await admin.post(f"/api/v1/admin/registrations/{r.json()['id']}/approve", headers=csrf(admin))
        assert r.status_code == 403


async def test_registration_has_no_ballot_link() -> None:
    """Privacy rule: no person <-> nullifier/ballot link anywhere in the data model."""
    from secvote.db.models import Ballot

    assert "user_id" not in Ballot.model_fields
    assert not any("nullifier" in f for f in Registration.model_fields)
    assert RegistrationStatus.ENROLLED  # roll membership only


async def test_enrolment_code_rules(new_client, settings: Settings) -> None:  # type: ignore[no-untyped-def]
    from datetime import timedelta

    from secvote.domain.phases import now_utc

    async with new_client() as admin, new_client() as voter:
        await make_admin(admin)
        e = await published_election(admin)
        email = await signup_voter(voter, settings)
        rid = (await _apply(voter, e["id"], "21CS300")).json()["id"]
        r = await admin.post(f"/api/v1/admin/registrations/{rid}/approve", headers=csrf(admin))
        assert r.json()["enrol_code_sent"] is True
        code = enrol_code(settings, email)
        reg = await Registration.get(PydanticObjectId(rid))
        assert reg is not None and reg.enrol_code_hash and code not in reg.enrol_code_hash  # HMAC only

        url = f"/api/v1/registrations/{rid}"
        wrong = "000000" if code != "000000" else "111111"
        ok = await voter.post(f"{url}/enrol-code/verify", json={"code": code}, headers=csrf(voter))
        assert ok.status_code == 200
        r = await voter.post(f"{url}/enrol-code/verify", json={"code": wrong}, headers=csrf(voter))
        assert r.status_code == 401 and "4 attempts left" in r.json()["error"]["message"]

        # the commitment needs the code
        body = {"commitment": "12345", "enrol_code": wrong}
        assert (await voter.post(f"{url}/commitment", json=body, headers=csrf(voter))).status_code == 401
        r = await voter.post(f"{url}/commitment", json={"commitment": "7"}, headers=csrf(voter))
        assert r.status_code == 422

        # resend has a cooldown
        assert (await voter.post(f"{url}/enrol-code/resend", headers=csrf(voter))).status_code == 429

        # five wrong attempts lock the code until a new one is sent
        for _ in range(3):
            await voter.post(f"{url}/enrol-code/verify", json={"code": wrong}, headers=csrf(voter))
        r = await voter.post(f"{url}/enrol-code/verify", json={"code": code}, headers=csrf(voter))
        assert r.status_code == 429

        # after the cooldown a new code is sent; an expired one is refused
        reg = await Registration.get(PydanticObjectId(rid))
        assert reg is not None
        reg.enrol_code_sent_at = now_utc() - timedelta(minutes=5)
        await reg.save()
        assert (await voter.post(f"{url}/enrol-code/resend", headers=csrf(voter))).status_code == 200
        new_code = enrol_code(settings, email)
        reg = await Registration.get(PydanticObjectId(rid))
        assert reg is not None
        reg.enrol_code_expires = now_utc() - timedelta(seconds=1)
        await reg.save()
        r = await voter.post(f"{url}/enrol-code/verify", json={"code": new_code}, headers=csrf(voter))
        assert r.status_code == 401 and r.json()["error"]["code"] == "enrol_code_expired"

        # a fresh code works exactly once
        reg.enrol_code_sent_at = now_utc() - timedelta(minutes=5)
        await reg.save()
        await voter.post(f"{url}/enrol-code/resend", headers=csrf(voter))
        final = enrol_code(settings, email)
        body = {"commitment": "12345", "enrol_code": final}
        assert (await voter.post(f"{url}/commitment", json=body, headers=csrf(voter))).status_code == 200
        body["commitment"] = "67890"
        r = await voter.post(f"{url}/commitment", json=body, headers=csrf(voter))
        assert r.status_code == 401 and r.json()["error"]["code"] == "enrol_code_missing"
