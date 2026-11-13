"""Invitation emails: tell everyone on an election's voter list that they can register.

Only people with an official email who haven't applied yet are emailed, and nobody is emailed twice
within INVITE_GAP, so pressing the button again later works as a reminder for the rest.
Sending runs after the response (it can take a while for a large list); progress shows in the counts.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from beanie.operators import In

from secvote.core.config import Settings
from secvote.core.errors import WrongPhase
from secvote.db.models import Election, EligibleVoter, Registration, User
from secvote.domain.enums import ElectionStatus, Phase, Role
from secvote.domain.phases import as_utc, now_utc
from secvote.services import audit
from secvote.services.auth import require_role
from secvote.services.elections import get, phase_of
from secvote.services.email import get_email_sender

log = logging.getLogger(__name__)

INVITE_GAP = timedelta(hours=12)


async def _registered_reg_nos(e: Election) -> set[str]:
    return {r.reg_no for r in await Registration.find(Registration.election_id == e.id).to_list()}


async def status(e: Election) -> dict[str, Any]:
    listed = await EligibleVoter.find(EligibleVoter.election_id == e.id).to_list()
    applied = await _registered_reg_nos(e)
    cutoff = now_utc() - INVITE_GAP
    due = [
        v
        for v in listed
        if v.email and v.reg_no not in applied and (v.invited_at is None or as_utc(v.invited_at) < cutoff)
    ]
    return {
        "invited": sum(1 for v in listed if v.invited_at),
        "applied": sum(1 for v in listed if v.reg_no in applied),
        "not_applied": sum(1 for v in listed if v.reg_no not in applied),
        "can_invite": len(due),
        "can_send": e.status == ElectionStatus.PUBLISHED
        and await phase_of(e) in (Phase.PENDING, Phase.REGISTRATION),
    }


async def prepare(actor: User, election_id: str) -> tuple[Election, list[str]]:
    """Pick who to email now. Returns the election and the registration numbers to invite."""
    require_role(actor, Role.ADMIN)
    e = await get(election_id)
    if e.status != ElectionStatus.PUBLISHED:
        raise WrongPhase("Publish the election first: voters can't see it until then")
    if await phase_of(e) not in (Phase.PENDING, Phase.REGISTRATION):
        raise WrongPhase("Registration has closed, so there is nothing to invite people to")
    applied = await _registered_reg_nos(e)
    cutoff = now_utc() - INVITE_GAP
    due = [
        v.reg_no
        for v in await EligibleVoter.find(EligibleVoter.election_id == e.id).to_list()
        if v.email and v.reg_no not in applied and (v.invited_at is None or as_utc(v.invited_at) < cutoff)
    ]
    await audit.record(actor.id, "election.invite", f"election:{e.id}", {"count": len(due)})
    return e, due


def _body(e: Election, v: EligibleVoter, settings: Settings) -> str:
    base = settings.web_url.rstrip("/")
    register = f"/elections/{e.slug}/register"
    hello = f"Hello {v.name}," if v.name else "Hello,"
    return "\n".join(
        [
            hello,
            "",
            f"{e.org} has listed you as a voter in {e.title}.",
            f"Registration is open until {as_utc(e.reg_end):%d %b %Y, %H:%M} UTC. "
            f"Voting runs from {as_utc(e.vote_start):%d %b %Y, %H:%M} to {as_utc(e.vote_end):%d %b %Y, %H:%M} UTC.",
            "",
            f"1. New to SecVote? Create your account with this email address ({v.email}):",
            f"   {base}/signup?next={register}",
            f"   Already have an account? Sign in: {base}/login?next={register}",
            f"2. Register for the election with your registration number {v.reg_no}.",
            "3. Create your voting identity, then vote when voting opens.",
            "",
            "Use this email address: your registration number only works with it.",
            "Your vote is secret: nobody, including the election office, can see how you voted.",
        ]
    )


async def send(settings: Settings, election_id: str, reg_nos: list[str]) -> int:
    """Send the invitations (run in the background). Marks each person as invited once their email is sent."""
    e = await get(election_id)
    sender = get_email_sender(settings)
    sent = 0
    for v in await EligibleVoter.find(
        EligibleVoter.election_id == e.id, In(EligibleVoter.reg_no, reg_nos)
    ).to_list():
        if not v.email:
            continue
        try:
            await sender.send(v.email, f"You can vote in {e.title}", _body(e, v, settings))
        except Exception:  # keep going; this person stays "not invited" and is picked up next time
            log.exception("could not send an invitation")
            continue
        v.invited_at = now_utc()
        v.invites += 1
        await v.save()
        sent += 1
    return sent
