"""Who runs elections: granting and removing official roles.

Rules
- Super admins (role "owner"; one to three per installation) are the only people who can make or remove
  admins and super admins. An ordinary admin can never create another admin.
- A new admin or super admin needs a second super admin: the promotion waits until a different super admin
  approves it. When there is only one super admin, their decision applies directly.
- Admins can grant and remove the other official roles (officer, trustee, observer) directly.
- Every official-role change is audited and emailed to all admins and super admins.
"""

from __future__ import annotations

import logging
from typing import Any

from beanie import PydanticObjectId
from pymongo.errors import DuplicateKeyError

from secvote.core.config import Settings
from secvote.core.errors import Conflict, Forbidden, NotFound
from secvote.db.models import RoleRequest, User
from secvote.domain.enums import Role
from secvote.services import audit
from secvote.services.auth import require_role
from secvote.services.email import get_email_sender

log = logging.getLogger(__name__)

MAX_OWNERS = 3
GUARDED = (Role.ADMIN, Role.OWNER)  # roles only super admins can grant or remove
LABEL = {
    Role.OWNER: "Super admin",
    Role.ADMIN: "Election admin",
    Role.OFFICER: "Election officer",
    Role.TRUSTEE: "Trustee",
    Role.OBSERVER: "Observer",
    Role.VOTER: "Voter",
}


def _active(**extra: Any) -> dict[str, Any]:
    return {"deleted_at": None, **extra}


async def ensure_owner() -> None:
    """Older installations had admins but no super admin: the earliest admin becomes the super admin."""
    if await User.find_one(_active(roles=Role.OWNER.value)):
        return
    first = await User.find(_active(roles=Role.ADMIN.value)).sort("+created_at").first_or_none()
    if first is None:
        return
    first.roles.append(Role.OWNER)
    await first.save()
    await audit.record(None, "role.owner_assigned", f"user:{first.id}", {"reason": "no super admin existed"})


async def _get(user_id: PydanticObjectId) -> User:
    user = await User.get(user_id)
    if user is None or user.deleted_at is not None:
        raise NotFound("User not found")
    return user


async def notify(settings: Settings | None, subject: str, body: str) -> None:
    """Tell every admin and super admin about an official-role change, so misuse is noticed straight away."""
    if settings is None:
        return
    sender = get_email_sender(settings)
    for u in await User.find(_active(roles={"$in": [Role.ADMIN.value, Role.OWNER.value]})).to_list():
        try:
            await sender.send(u.email, f"SecVote: {subject}", body)
        except Exception:  # the change stands; the audit log has it too
            log.exception("could not send role-change alert")


async def _apply(
    settings: Settings | None, actor: User, user: User, role: Role, approved_by: User | None = None
) -> None:
    if role == Role.OWNER and Role.ADMIN not in user.roles:
        user.roles.append(Role.ADMIN)  # a super admin is always an admin too
    if role not in user.roles:
        user.roles.append(role)
    await user.save()
    data: dict[str, Any] = {"role": role.value}
    if approved_by is not None:
        data["approved_by"] = str(approved_by.id)
    await audit.record((approved_by or actor).id, "role.grant", f"user:{user.id}", data)
    who = f"{actor.name} ({actor.email})"
    extra = f", approved by {approved_by.name} ({approved_by.email})" if approved_by else ""
    await notify(
        settings,
        f"{user.name} is now {LABEL[role]}",
        f"{user.name} ({user.email}) was given the {LABEL[role]} role by {who}{extra}.\n\n"
        "If you don't recognise this change, ask a super admin to remove the role in Admin console → Officials.",
    )


async def grant(
    settings: Settings | None, actor: User, user_id: PydanticObjectId, role: Role
) -> dict[str, Any]:
    """Returns {"user": User, "pending": bool}. Admin promotions wait for a second super admin, if there is one."""
    if role == Role.VOTER:
        raise Conflict("Everyone already has the voter role")
    user = await _get(user_id)
    if role not in GUARDED:
        require_role(actor, Role.ADMIN)
        if role not in user.roles:
            await _apply(settings, actor, user, role)
        return {"user": user, "pending": False}

    require_role(actor, Role.OWNER)
    if role == Role.ADMIN and Role.ADMIN in user.roles:
        return {"user": user, "pending": False}
    if role == Role.OWNER:
        if Role.OWNER in user.roles:
            return {"user": user, "pending": False}
        if await User.find(_active(roles=Role.OWNER.value)).count() >= MAX_OWNERS:
            raise Conflict(f"There can be at most {MAX_OWNERS} super admins", code="too_many_owners")
    if user.id == actor.id:
        raise Forbidden("You can't promote yourself")
    # A different super admin must approve, unless the requester is the only super admin.
    others = await User.find(_active(roles=Role.OWNER.value, _id={"$nin": [actor.id, user.id]})).count()
    if others == 0:
        await _apply(settings, actor, user, role)
        return {"user": user, "pending": False}
    assert actor.id is not None and user.id is not None
    try:
        await RoleRequest(user_id=user.id, role=role, requested_by=actor.id).insert()
    except DuplicateKeyError:
        raise Conflict("This promotion is already waiting for approval", code="already_requested") from None
    await audit.record(actor.id, "role.request", f"user:{user.id}", {"role": role.value})
    await notify(
        settings,
        f"Approval needed: {user.name} as {LABEL[role]}",
        f"{actor.name} ({actor.email}) asked to make {user.name} ({user.email}) {LABEL[role]}.\n\n"
        "It takes effect only when another super admin approves it in Admin console → Officials. "
        "If you don't expect this, don't approve it.",
    )
    return {"user": user, "pending": True}


async def requests(actor: User) -> list[dict[str, Any]]:
    require_role(actor, Role.ADMIN)
    items = await RoleRequest.find_all().sort("+created_at").to_list()
    ids = list({i.user_id for i in items} | {i.requested_by for i in items})
    people = {u.id: u for u in await User.find({"_id": {"$in": ids}}).to_list()}
    out = []
    for r in items:
        u, by = people.get(r.user_id), people.get(r.requested_by)
        out.append(
            {
                "id": str(r.id),
                "role": r.role,
                "user": {"id": str(r.user_id), "name": u.name if u else "?", "email": u.email if u else "?"},
                "requested_by": {"id": str(r.requested_by), "name": by.name if by else "?"},
                "created_at": r.created_at,
                "can_approve": Role.OWNER in actor.roles and actor.id not in (r.requested_by, r.user_id),
            }
        )
    return out


async def _request(request_id: str) -> RoleRequest:
    if not PydanticObjectId.is_valid(request_id):
        raise NotFound("Request not found")
    r = await RoleRequest.get(PydanticObjectId(request_id))
    if r is None:
        raise NotFound("Request not found")
    return r


async def approve(settings: Settings | None, actor: User, request_id: str) -> User:
    """Only a super admin can authorise a new administrator, and not the one who asked for it."""
    require_role(actor, Role.OWNER)
    r = await _request(request_id)
    if actor.id in (r.requested_by, r.user_id):
        raise Forbidden("A different super admin must approve this", code="needs_second_approver")
    if r.role == Role.OWNER and await User.find(_active(roles=Role.OWNER.value)).count() >= MAX_OWNERS:
        raise Conflict(f"There can be at most {MAX_OWNERS} super admins", code="too_many_owners")
    requester = await User.get(r.requested_by)
    if requester is None or requester.deleted_at is not None or Role.OWNER not in requester.roles:
        await r.delete()
        raise Conflict("The super admin who asked for this no longer is one, so the request was dropped")
    user = await _get(r.user_id)
    await r.delete()
    await _apply(settings, requester, user, r.role, approved_by=actor)
    return user


async def cancel(settings: Settings | None, actor: User, request_id: str) -> None:
    """Any admin can turn a request down (including the requester withdrawing it)."""
    require_role(actor, Role.ADMIN)
    r = await _request(request_id)
    await r.delete()
    await audit.record(actor.id, "role.request_cancel", f"user:{r.user_id}", {"role": r.role.value})
    user = await User.get(r.user_id)
    await notify(
        settings,
        f"Promotion declined: {user.name if user else 'a user'} as {LABEL[r.role]}",
        f"{actor.name} ({actor.email}) declined or withdrew the request to make "
        f"{user.name if user else 'this user'} {LABEL[r.role]}.",
    )


async def revoke(settings: Settings | None, actor: User, user_id: PydanticObjectId, role: Role) -> User:
    if role == Role.VOTER:
        raise Conflict("Everyone keeps the voter role")
    user = await _get(user_id)
    if role in GUARDED:
        require_role(actor, Role.OWNER)
        if user.id == actor.id:
            raise Conflict(f"You cannot remove your own {LABEL[role].lower()} role", code="self_lockout")
        if role == Role.ADMIN and Role.OWNER in user.roles:
            raise Conflict("Remove the super admin role first", code="owner_is_admin")
        if role == Role.ADMIN and await User.find(_active(roles=Role.ADMIN.value)).count() <= 1:
            raise Conflict("At least one admin must remain", code="last_admin")
        if role == Role.OWNER and await User.find(_active(roles=Role.OWNER.value)).count() <= 1:
            raise Conflict("At least one super admin must remain", code="last_owner")
    else:
        require_role(actor, Role.ADMIN)
    if role in user.roles:
        user.roles.remove(role)
        await user.save()
        await audit.record(actor.id, "role.revoke", f"user:{user.id}", {"role": role.value})
        await notify(
            settings,
            f"{user.name} is no longer {LABEL[role]}",
            f"{actor.name} ({actor.email}) removed the {LABEL[role]} role from {user.name} ({user.email}).",
        )
    return user
