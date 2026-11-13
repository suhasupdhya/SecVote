"""Email identity: different spellings that reach the same inbox count as the same person."""

from __future__ import annotations

# Providers that ignore dots in the local part (Gmail; googlemail.com is the same service).
_DOTLESS = {"gmail.com": "gmail.com", "googlemail.com": "gmail.com"}


def canonical_email(email: str) -> str:
    """The inbox an address really delivers to, for duplicate checks (not for sending).

    - case is ignored
    - "+tag" sub-addresses go to the same inbox (Gmail, Google Workspace, Outlook, most providers)
    - Gmail ignores dots: a.b.c@gmail.com == abc@gmail.com
    """
    email = email.strip().lower()
    if "@" not in email:
        return email
    local, domain = email.rsplit("@", 1)
    local = local.split("+", 1)[0]
    if domain in _DOTLESS:
        domain = _DOTLESS[domain]
        local = local.replace(".", "")
    return f"{local}@{domain}"


def same_inbox(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and canonical_email(a or "") == canonical_email(b or "")
