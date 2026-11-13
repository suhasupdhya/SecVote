"""Re-application rule: a rejected voter may apply once more per election. A second rejection is final."""

from __future__ import annotations

from typing import TYPE_CHECKING

from secvote.domain.enums import RegistrationStatus

if TYPE_CHECKING:
    from secvote.db.models import Registration

MAX_ATTEMPTS = 2  # the first application plus one re-application


def can_reapply(reg: Registration) -> bool:
    return reg.status == RegistrationStatus.REJECTED and reg.attempts < MAX_ATTEMPTS
