"""Voter registration: apply with ID proof -> review (1 or 2 approvals) -> commitment -> on-chain roll."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import timedelta
from pathlib import Path
from typing import Any

from beanie import PydanticObjectId
from beanie.operators import In
from pymongo.errors import DuplicateKeyError

from secvote.core import security
from secvote.core.config import Settings
from secvote.core.errors import (
    AppError,
    Conflict,
    Forbidden,
    NotFound,
    RateLimited,
    Unauthorized,
    WrongPhase,
)
from secvote.db.models import (
    Election,
    EligibleVoter,
    Member,
    Registration,
    StoredDocument,
    User,
    VoterProfile,
)
from secvote.domain.enums import ElectionStatus, Phase, RegistrationStatus, Role
from secvote.domain.phases import as_utc, now_utc
from secvote.domain.reapply import MAX_ATTEMPTS, can_reapply
from secvote.services import audit
from secvote.services.auth import require_role
from secvote.services.elections import get, phase_of
from secvote.services.email import get_email_sender

log = logging.getLogger(__name__)

ENROL_CODE_TTL = timedelta(hours=48)
ENROL_CODE_MAX_ATTEMPTS = 5
ENROL_CODE_RESEND_COOLDOWN = timedelta(seconds=60)

SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617
DOCUMENT_RETENTION = timedelta(days=30)

# magic bytes -> (content type, extension). The declared content type is never trusted.
_SIGNATURES: list[tuple[bytes, str, str]] = [
    (b"%PDF-", "application/pdf", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
]


def sniff(data: bytes) -> tuple[str, str]:
    for sig, ctype, ext in _SIGNATURES:
        if data.startswith(sig):
            return ctype, ext
    raise AppError("Upload a PDF, PNG or JPG file", code="bad_file_type")


def parse_commitment(raw: str) -> str:
    try:
        value = int(raw, 0) if raw.startswith("0x") else int(raw)
    except ValueError:
        raise AppError("Commitment must be an integer", code="bad_commitment") from None
    if not 0 < value < SNARK_SCALAR_FIELD:
        raise AppError("Commitment out of range", code="bad_commitment")
    return str(value)


async def apply(
    settings: Settings,
    user: User,
    election_id: str,
    *,
    reg_no: str,
    department: str,
    year: int,
    file_bytes: bytes,
) -> Registration:
    e = await get(election_id)
    if e.status != ElectionStatus.PUBLISHED:
        raise NotFound("Election not found")
    if await phase_of(e) not in (Phase.PENDING, Phase.REGISTRATION):
        raise WrongPhase("Registration is closed")
    if not user.email_verified:
        raise Forbidden("Verify your email first", code="email_not_verified")
    if len(file_bytes) > settings.max_upload_bytes:
        raise AppError("File is larger than 5 MB", code="file_too_large")
    ctype, ext = sniff(file_bytes)
    assert user.id is not None and e.id is not None

    # One registration per voter per election. A rejected one may be re-submitted once (MAX_ATTEMPTS).
    existing = await Registration.find_one(Registration.election_id == e.id, Registration.user_id == user.id)
    if existing is not None and not can_reapply(existing):
        if existing.status == RegistrationStatus.REJECTED:
            raise Conflict(
                "Your application was not approved again, so you can't apply for this election any more. "
                "Contact your election office if you think this is a mistake.",
                code="reapply_limit",
            )
        raise Conflict("You have already applied for this election", code="already_applied")

    reg_no = normalise_reg_no(reg_no)
    department = department.strip()
    # Checked before the number is saved to the voter's profile, so a typo isn't locked in.
    if e.eligible_only and not await _on_list(e, reg_no):
        raise Forbidden(
            "This registration number isn't on the voter list for this election. "
            "Check it carefully, or contact your election office.",
            code="not_on_list",
        )
    profile = await VoterProfile.find_one(VoterProfile.user_id == user.id)
    if profile is None:
        profile = VoterProfile(user_id=user.id, reg_no=reg_no, department=department, year=year)
        try:
            await profile.insert()
        except DuplicateKeyError:
            raise Conflict(
                "This registration number belongs to another account", code="reg_no_taken"
            ) from None
    elif profile.reg_no != reg_no:
        raise Conflict("Registration number does not match your profile", code="reg_no_mismatch")
    elif (profile.department, profile.year) != (department, year):
        # Department and year change over time (and may be what a rejection asked to correct).
        profile.department, profile.year = department, year
        await profile.save()

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    rel = f"{secrets.token_hex(16)}.{ext}"
    (settings.upload_dir / rel).write_bytes(file_bytes)
    doc = StoredDocument(
        owner_id=user.id,
        election_id=e.id,
        path=rel,
        content_type=ctype,
        size=len(file_bytes),
        sha256=hashlib.sha256(file_bytes).hexdigest(),
        delete_after=as_utc(e.vote_end) + DOCUMENT_RETENTION,
    )
    await doc.insert()

    if existing is not None:
        return await _reapply(user, existing, doc, rel, settings, reg_no, profile)

    reg = Registration(
        user_id=user.id,
        election_id=e.id,
        reg_no=reg_no,
        department=profile.department,
        year=profile.year,
        document_id=doc.id,
    )
    try:
        await reg.insert()
    except DuplicateKeyError:
        raise Conflict("You have already applied for this election", code="already_applied") from None
    if await _auto_approve(settings, e, reg):
        fresh = await Registration.get(reg.id)
        assert fresh is not None
        return fresh
    return reg


async def _reapply(
    user: User,
    old: Registration,
    doc: StoredDocument,
    rel: str,
    settings: Settings,
    reg_no: str,
    profile: VoterProfile,
) -> Registration:
    """Re-open a rejected registration for review with fresh details and ID card. Conditional on the
    status and attempt count we read, so two simultaneous re-applications can't both get through."""
    res = await Registration.find_one(
        Registration.id == old.id,
        Registration.status == RegistrationStatus.REJECTED,
        Registration.attempts == old.attempts,
    ).update(
        {
            "$set": {
                "status": RegistrationStatus.PENDING_REVIEW.value,
                "attempts": old.attempts + 1,
                "previous_reject_reason": old.reject_reason,
                "reject_reason": None,
                "rejected_by": None,
                "approvals": [],
                "reg_no": reg_no,
                "department": profile.department,
                "year": profile.year,
                "document_id": doc.id,
                "enrol_code_hash": None,
                "enrol_code_expires": None,
                "enrol_code_sent_at": None,
                "enrol_code_attempts": 0,
                "updated_at": now_utc(),
            }
        }
    )
    if not getattr(res, "modified_count", 0):
        (settings.upload_dir / rel).unlink(missing_ok=True)
        await doc.delete()
        raise Conflict("You have already applied for this election", code="already_applied")
    # The ID card from the rejected attempt is no longer needed: let the retention job delete it now.
    if old.document_id is not None:
        await StoredDocument.find(StoredDocument.id == old.document_id).update(
            {"$set": {"delete_after": now_utc()}}
        )
    await audit.record(
        user.id, "registration.reapply", f"registration:{old.id}", {"attempt": old.attempts + 1}
    )
    fresh = await Registration.get(old.id)
    assert fresh is not None
    return fresh


# ---------------------------------------------------------------- eligibility list (pre-approved voters)
MAX_ELIGIBLE = 100_000
_REG_NO = re.compile(r"^[A-Z0-9][A-Z0-9 ./_-]{0,39}$")


def normalise_reg_no(raw: str) -> str:
    return " ".join(raw.split()).upper()


async def _on_list(e: Election, reg_no: str) -> bool:
    return (
        await EligibleVoter.find_one(EligibleVoter.election_id == e.id, EligibleVoter.reg_no == reg_no)
        is not None
    )


async def _auto_approve(settings: Settings, e: Election, reg: Registration) -> bool:
    """Approve an applicant whose registration number the office pre-approved. Not for two-person
    (high-stakes) elections, re-applications after a rejection, or admins (who can't approve themselves)."""
    if e.high_stakes or reg.status != RegistrationStatus.PENDING_REVIEW or reg.attempts > 1:
        return False
    user = await User.get(reg.user_id)
    if user is None or Role.ADMIN in user.roles or not await _on_list(e, reg.reg_no):
        return False
    res = await Registration.find_one(
        Registration.id == reg.id, Registration.status == RegistrationStatus.PENDING_REVIEW
    ).update(
        {
            "$set": {
                "status": RegistrationStatus.APPROVED.value,
                "auto_approved": True,
                "updated_at": now_utc(),
            }
        }
    )
    if not getattr(res, "modified_count", 0):
        return False
    await audit.record(None, "registration.auto_approve", f"registration:{reg.id}")
    fresh = await Registration.get(reg.id)
    if fresh is not None:
        await issue_enrol_code(settings, fresh)
    return True


async def eligibility(actor: User, election_id: str) -> dict[str, Any]:
    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    editable = e.status != ElectionStatus.PUBLISHED or await phase_of(e) in (
        Phase.PENDING,
        Phase.REGISTRATION,
    )
    return {
        "count": await EligibleVoter.find(EligibleVoter.election_id == e.id).count(),
        "eligible_only": e.eligible_only,
        "editable": editable,
        "auto_approve": not e.high_stakes,
    }


async def set_eligibility(
    settings: Settings, actor: User, election_id: str, reg_nos: list[str] | None, eligible_only: bool
) -> dict[str, Any]:
    """Replace the election's list of pre-approved registration numbers (or, with reg_nos=None, only
    change whether the list is required). Pending applicants on the new list are approved straight away."""
    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    if e.status == ElectionStatus.PUBLISHED and await phase_of(e) not in (Phase.PENDING, Phase.REGISTRATION):
        raise WrongPhase("Registration has closed, so the voter list can no longer change")
    assert e.id is not None
    if reg_nos is None:  # keep the list, change the setting only
        if eligible_only and not await EligibleVoter.find(EligibleVoter.election_id == e.id).count():
            raise AppError(
                "Add registration numbers before limiting applications to the list", code="empty_list"
            )
        e.eligible_only = eligible_only
        await e.save()
        await audit.record(
            actor.id, "election.eligibility", f"election:{e.id}", {"eligible_only": eligible_only}
        )
        return {**await eligibility(actor, election_id), "auto_approved": 0}
    clean = sorted({normalise_reg_no(r) for r in reg_nos if r.strip()})
    bad = [r for r in clean if not _REG_NO.match(r)]
    if bad:
        raise AppError(
            f"{len(bad)} entr{'y is' if len(bad) == 1 else 'ies are'} not a valid registration number, "
            f"e.g. {bad[0][:40]!r}",
            code="bad_reg_no",
        )
    if len(clean) > MAX_ELIGIBLE:
        raise AppError(
            f"The list can have at most {MAX_ELIGIBLE:,} registration numbers", code="list_too_long"
        )
    if eligible_only and not clean:
        raise AppError("Add registration numbers before limiting applications to the list", code="empty_list")
    await EligibleVoter.find(EligibleVoter.election_id == e.id).delete()
    if clean:
        await EligibleVoter.insert_many([EligibleVoter(election_id=e.id, reg_no=r) for r in clean])
    e.eligible_only = eligible_only
    await e.save()
    await audit.record(
        actor.id,
        "election.eligibility",
        f"election:{e.id}",
        {"count": len(clean), "eligible_only": eligible_only},
    )
    approved = 0
    if clean and e.status == ElectionStatus.PUBLISHED:
        pending = await Registration.find(
            Registration.election_id == e.id,
            Registration.status == RegistrationStatus.PENDING_REVIEW,
            In(Registration.reg_no, clean),
        ).to_list()
        for reg in pending:
            approved += await _auto_approve(settings, e, reg)
    return {**await eligibility(actor, election_id), "auto_approved": approved}


async def mine(user: User) -> list[Registration]:
    return await Registration.find(Registration.user_id == user.id).sort("-created_at").to_list()


async def _get(reg_id: str) -> Registration:
    if not PydanticObjectId.is_valid(reg_id):
        raise NotFound("Registration not found")
    reg = await Registration.get(PydanticObjectId(reg_id))
    if reg is None:
        raise NotFound("Registration not found")
    return reg


async def review_queue(
    actor: User, election_id: str, status: RegistrationStatus | None
) -> list[dict[str, Any]]:
    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    q = Registration.find(Registration.election_id == e.id)
    if status:
        q = q.find(Registration.status == status)
    regs = await q.sort("+created_at").to_list()
    users = {u.id: u for u in await User.find(In(User.id, [r.user_id for r in regs])).to_list()}
    listed = {
        v.reg_no
        for v in await EligibleVoter.find(
            EligibleVoter.election_id == e.id, In(EligibleVoter.reg_no, [r.reg_no for r in regs])
        ).to_list()
    }
    needed = 2 if e.high_stakes else 1
    out = []
    for r in regs:
        u = users.get(r.user_id)
        out.append(
            {
                "id": str(r.id),
                "status": r.status,
                "name": u.name if u else "?",
                "email": u.email if u else "?",
                "reg_no": r.reg_no,
                "department": r.department,
                "year": r.year,
                "approvals": len(r.approvals),
                "approvals_needed": needed,
                "approved_by_me": actor.id in r.approvals,
                "attempts": r.attempts,
                "max_attempts": MAX_ATTEMPTS,
                "on_list": r.reg_no in listed,
                "auto_approved": r.auto_approved,
                "previous_reject_reason": r.previous_reject_reason,
                "reject_reason": r.reject_reason,
                "has_document": r.document_id is not None,
                "created_at": r.created_at,
            }
        )
    return out


async def document_for_review(settings: Settings, actor: User, reg_id: str) -> tuple[Path, str]:
    require_role(actor, Role.ADMIN)
    reg = await _get(reg_id)
    doc = await StoredDocument.get(reg.document_id) if reg.document_id else None
    if doc is None:
        raise NotFound("No document")
    path = (settings.upload_dir / doc.path).resolve()
    if settings.upload_dir.resolve() not in path.parents or not path.exists():
        raise NotFound("No document")
    await audit.record(actor.id, "registration.view_document", f"registration:{reg.id}")
    return path, doc.content_type


# ---------------------------------------------------------------- enrolment code
def _enrol_digest(settings: Settings, reg: Registration, code: str) -> str:
    return security.otp_digest(settings.otp_pepper.get_secret_value(), "enrol", str(reg.id), code)


async def issue_enrol_code(settings: Settings, reg: Registration) -> None:
    """Email a one-time 6-digit code to the voter's registered address. It proves the person creating the
    voting identity controls that mailbox. It is NOT the voting key: that is created only in the browser."""
    user = await User.get(reg.user_id)
    e = await Election.get(reg.election_id)
    if user is None or e is None:
        return
    code = security.new_otp()
    expires = min(now_utc() + ENROL_CODE_TTL, as_utc(e.reg_end))
    reg.enrol_code_hash = _enrol_digest(settings, reg, code)
    reg.enrol_code_expires = expires
    reg.enrol_code_sent_at = now_utc()
    reg.enrol_code_attempts = 0
    await reg.save()
    body = (
        f"You're approved to vote in {e.title}.\n\n"
        f"Your enrolment code is {code}\n\n"
        "Enter it on the registration page together with your passphrase to create your voting identity. "
        f"It expires {expires:%d %b %Y, %H:%M} UTC.\n\n"
        "Never share this code. SecVote will never ask for your passphrase."
    )
    try:
        await get_email_sender(settings).send(user.email, f"Your SecVote enrolment code for {e.title}", body)
    except Exception:  # approval stands; the voter can request a new code
        log.exception("could not send enrolment code email")


async def check_enrol_code(settings: Settings, reg: Registration, code: str, *, consume: bool) -> None:
    if not reg.enrol_code_hash or not reg.enrol_code_expires:
        raise Unauthorized("Request an enrolment code first", code="enrol_code_missing")
    if as_utc(reg.enrol_code_expires) <= now_utc():
        raise Unauthorized("Your enrolment code has expired. Send a new one.", code="enrol_code_expired")
    if reg.enrol_code_attempts >= ENROL_CODE_MAX_ATTEMPTS:
        raise RateLimited("Too many wrong codes. Send a new one.")
    if not security.constant_time_eq(reg.enrol_code_hash, _enrol_digest(settings, reg, code.strip())):
        reg.enrol_code_attempts += 1
        await reg.save()
        left = ENROL_CODE_MAX_ATTEMPTS - reg.enrol_code_attempts
        plural = "s" if left != 1 else ""
        raise Unauthorized(f"That code is not correct. {left} attempt{plural} left.", code="enrol_code_wrong")
    if consume:
        reg.enrol_code_hash = None
        reg.enrol_code_expires = None
        reg.enrol_code_attempts = 0


async def _own_enrolling(user: User, reg_id: str) -> Registration:
    reg = await _get(reg_id)
    if reg.user_id != user.id:
        raise NotFound("Registration not found")
    if reg.status not in (RegistrationStatus.APPROVED, RegistrationStatus.COMMITMENT_SUBMITTED):
        raise Conflict(f"Registration is {reg.status}")
    if reg.added_tx_id is not None:
        raise Conflict("Your commitment is already being added to the roll", code="commitment_locked")
    return reg


async def resend_enrol_code(settings: Settings, user: User, reg_id: str) -> Registration:
    reg = await _own_enrolling(user, reg_id)
    if reg.enrol_code_sent_at and now_utc() - as_utc(reg.enrol_code_sent_at) < ENROL_CODE_RESEND_COOLDOWN:
        raise RateLimited("Please wait a minute before requesting another code")
    await issue_enrol_code(settings, reg)
    return reg


async def verify_enrol_code(settings: Settings, user: User, reg_id: str, code: str) -> None:
    """Checks the code without using it up, so the browser can confirm it before creating the identity."""
    reg = await _own_enrolling(user, reg_id)
    await check_enrol_code(settings, reg, code, consume=False)


async def approve(actor: User, reg_id: str, settings: Settings | None = None) -> Registration:
    require_role(actor, Role.ADMIN)
    reg = await _get(reg_id)
    e = await Election.get(reg.election_id)
    assert e is not None and actor.id is not None
    if reg.user_id == actor.id:
        raise Forbidden("You cannot approve your own registration")
    if reg.status != RegistrationStatus.PENDING_REVIEW:
        raise Conflict(f"Registration is {reg.status}")
    if await phase_of(e) not in (Phase.PENDING, Phase.REGISTRATION):
        raise WrongPhase("Registration is closed")
    if actor.id in reg.approvals:
        raise Conflict(
            "You already approved this; a second official must approve", code="needs_second_approver"
        )
    reg.approvals.append(actor.id)
    needed = 2 if e.high_stakes else 1
    if len(reg.approvals) >= needed:
        reg.status = RegistrationStatus.APPROVED
    reg.updated_at = now_utc()
    await reg.save()
    await audit.record(
        actor.id, "registration.approve", f"registration:{reg.id}", {"approvals": len(reg.approvals)}
    )
    if reg.status == RegistrationStatus.APPROVED and settings is not None:
        await issue_enrol_code(settings, reg)
    return reg


async def _email_rejection(settings: Settings, reg: Registration) -> None:
    """Tell the voter straight away, with the reason and whether they can apply once more."""
    user = await User.get(reg.user_id)
    e = await Election.get(reg.election_id)
    if user is None or e is None or user.deleted_at is not None:
        return
    lines = [
        f"Your application to vote in {e.title} was not approved.",
        "",
        f"Reason: {reg.reject_reason}",
        "",
    ]
    if can_reapply(reg) and await phase_of(e) in (Phase.PENDING, Phase.REGISTRATION):
        lines += [
            f"You can correct this and apply once more before {as_utc(e.reg_end):%d %b %Y, %H:%M} UTC:",
            f"{settings.web_url.rstrip('/')}/elections/{e.slug}/register",
            "",
            "This is your last attempt: if it is not approved either, you won't be able to vote in this election.",
        ]
    else:
        lines += [
            "You can't apply again for this election, so you won't be able to vote in it.",
            "Contact your election office if you think this is a mistake.",
        ]
    try:
        await get_email_sender(settings).send(
            user.email, f"Your application for {e.title} was not approved", "\n".join(lines)
        )
    except Exception:  # the rejection stands; the voter also sees it on their dashboard
        log.exception("could not send rejection email")


async def reject(actor: User, reg_id: str, reason: str, settings: Settings | None = None) -> Registration:
    require_role(actor, Role.ADMIN)
    reg = await _get(reg_id)
    if reg.status not in (RegistrationStatus.PENDING_REVIEW, RegistrationStatus.APPROVED):
        raise Conflict(f"Registration is {reg.status}")
    reg.status = RegistrationStatus.REJECTED
    reg.rejected_by = actor.id
    reg.reject_reason = reason[:500]
    reg.enrol_code_hash = None  # an approval being withdrawn must not leave a usable enrolment code
    reg.enrol_code_expires = None
    reg.updated_at = now_utc()
    await reg.save()
    await audit.record(
        actor.id,
        "registration.reject",
        f"registration:{reg.id}",
        {"attempt": reg.attempts, "final": reg.attempts >= MAX_ATTEMPTS},
    )
    if settings is not None:
        await _email_rejection(settings, reg)
    return reg


async def submit_commitment(
    settings: Settings, user: User, reg_id: str, commitment: str, enrol_code: str
) -> Registration:
    """Accepts only the PUBLIC identity commitment, plus the emailed enrolment code.
    No endpoint ever accepts the identity secret."""
    reg = await _own_enrolling(user, reg_id)
    e = await Election.get(reg.election_id)
    assert e is not None
    if e.frozen or await phase_of(e) not in (Phase.PENDING, Phase.REGISTRATION):
        raise WrongPhase("Registration is closed; the roll cannot change")
    value = parse_commitment(commitment)
    await check_enrol_code(settings, reg, enrol_code, consume=True)
    reg.commitment = value
    reg.status = RegistrationStatus.COMMITMENT_SUBMITTED
    reg.updated_at = now_utc()
    try:
        await reg.save()
    except DuplicateKeyError:
        raise Conflict("This commitment is already registered", code="commitment_taken") from None
    return reg


async def roll_check(e: Election, commitment: str) -> dict[str, Any]:
    c = parse_commitment(commitment)
    m = await Member.find_one(Member.election_id == e.id, Member.commitment == c)
    return {
        "in_roll": m is not None,
        "index": m.index if m else None,
        "frozen": e.frozen,
        "member_count": e.member_count,
    }


async def members(e: Election) -> list[str]:
    """The on-chain roll in tree order (from MembersAdded events). Public by design."""
    return [m.commitment for m in await Member.find(Member.election_id == e.id).sort("+index").to_list()]
