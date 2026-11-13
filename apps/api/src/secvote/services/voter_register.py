"""The institution's voter register.

Admins upload the full list of eligible people once (registration number, official email, name,
department, year) and update it each term. Each election then takes its voter list from the register
with one click, optionally limited to some departments and years.
"""

from __future__ import annotations

from typing import Any

from secvote.core.config import Settings
from secvote.core.emails import canonical_email
from secvote.core.errors import AppError
from secvote.db.models import RegisterEntry, User
from secvote.domain.enums import Role
from secvote.domain.phases import now_utc
from secvote.services import audit, registrations
from secvote.services.auth import require_role


def _clean(rows: list[dict[str, Any]]) -> list[RegisterEntry]:
    by_reg: dict[str, RegisterEntry] = {}
    for raw in rows:
        reg = registrations.normalise_reg_no(str(raw.get("reg_no") or ""))
        if not reg:
            continue
        if not registrations._REG_NO.match(reg):
            raise AppError(f"{reg[:40]!r} is not a valid registration number", code="bad_reg_no")
        email = (raw.get("email") or "").strip().lower() or None
        if email and not registrations._EMAIL.match(email):
            raise AppError(f"{email[:60]!r} is not a valid email address", code="bad_email")
        year = raw.get("year")
        if year is not None and not (isinstance(year, int) and 1 <= year <= 10):
            raise AppError(f"{reg}: year must be a number from 1 to 10", code="bad_year")
        if reg in by_reg:
            raise AppError(f"{reg} appears more than once in the register", code="duplicate_reg_no")
        by_reg[reg] = RegisterEntry(
            reg_no=reg,
            email=email,
            name=" ".join(str(raw.get("name") or "").split())[:120] or None,
            department=" ".join(str(raw.get("department") or "").split())[:80],
            year=year,
        )
    seen: dict[str, str] = {}
    for e in by_reg.values():
        if e.email:
            key = canonical_email(e.email)
            if key in seen:
                raise AppError(
                    f"{seen[key]} and {e.reg_no} have the same email ({e.email}). Each person should appear once.",
                    code="duplicate_email",
                )
            seen[key] = e.reg_no
    if len(by_reg) > registrations.MAX_ELIGIBLE:
        raise AppError(
            f"The register can have at most {registrations.MAX_ELIGIBLE:,} people", code="list_too_long"
        )
    return list(by_reg.values())


async def summary(actor: User) -> dict[str, Any]:
    require_role(actor, Role.ADMIN)
    groups: dict[tuple[str, int | None], int] = {}
    with_email = 0
    latest = None
    async for e in RegisterEntry.find_all():
        groups[(e.department, e.year)] = groups.get((e.department, e.year), 0) + 1
        with_email += bool(e.email)
        latest = e.updated_at if latest is None or e.updated_at > latest else latest
    return {
        "count": sum(groups.values()),
        "with_email": with_email,
        "updated_at": latest,
        "groups": [
            {"department": d, "year": y, "count": n}
            for (d, y), n in sorted(groups.items(), key=lambda kv: (kv[0][0].casefold(), kv[0][1] or 0))
        ],
    }


async def replace(actor: User, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Replace the whole register. Elections that already took their list keep it until refreshed."""
    require_role(actor, Role.ADMIN)
    entries = _clean(rows)
    now = now_utc()
    for e in entries:
        e.updated_at = now
    await RegisterEntry.find_all().delete()
    if entries:
        await RegisterEntry.insert_many(entries)
    await audit.record(actor.id, "register.replace", "voter_register", {"count": len(entries)})
    return await summary(actor)


async def apply_to_election(
    settings: Settings,
    actor: User,
    election_id: str,
    departments: list[str] | None,
    years: list[int] | None,
    eligible_only: bool,
) -> dict[str, Any]:
    """Set an election's voter list from the register (everyone, or chosen departments/years)."""
    require_role(actor, Role.ADMIN)
    want_d = {d.strip().casefold() for d in departments} if departments else None
    want_y = set(years) if years else None
    picked = [
        {"reg_no": e.reg_no, "email": e.email, "name": e.name}
        async for e in RegisterEntry.find_all()
        if (want_d is None or e.department.casefold() in want_d) and (want_y is None or e.year in want_y)
    ]
    if not picked:
        raise AppError("Nobody in the voter register matches that choice", code="empty_list")
    out = await registrations.set_eligibility(settings, actor, election_id, picked, eligible_only)
    await audit.record(
        actor.id,
        "election.eligibility_from_register",
        f"election:{election_id}",
        {"count": len(picked), "departments": sorted(departments or []), "years": sorted(years or [])},
    )
    return out
