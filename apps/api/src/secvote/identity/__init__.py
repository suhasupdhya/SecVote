"""Identity adapters: who is allowed to create an account.

`college_email` limits sign-up to institution email domains. Other providers (e.g. DigiLocker) can be added
behind the same interface. SecVote never stores Aadhaar numbers (see docs/threat-model.md).
"""

from __future__ import annotations

from typing import Protocol

from secvote.core.config import Settings
from secvote.core.errors import Forbidden


class IdentityProvider(Protocol):
    name: str

    def check_signup(self, email: str) -> None:
        """Raise Forbidden if this email may not create an account."""


class CollegeEmailProvider:
    name = "college_email"

    def __init__(self, allowed_domains: list[str]) -> None:
        self.allowed = {d.lower().lstrip("@") for d in allowed_domains}

    def check_signup(self, email: str) -> None:
        domain = email.rsplit("@", 1)[-1].lower()
        if self.allowed and domain not in self.allowed:
            allowed = ", ".join(f"@{d}" for d in sorted(self.allowed))
            raise Forbidden(
                f"Sign-up is limited to institution emails ({allowed})", code="email_domain_not_allowed"
            )


def get_identity_provider(settings: Settings) -> IdentityProvider:
    return CollegeEmailProvider(settings.allowed_email_domains)
