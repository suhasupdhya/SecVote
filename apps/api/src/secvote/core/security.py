"""Password hashing (Argon2id), OTP hashing (HMAC-SHA256 + pepper), opaque tokens."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # argon2id, library defaults (RFC 9106 low-memory profile)

# Verified against a dummy hash when the user does not exist, to equalise timing.
_DUMMY_HASH = _hasher.hash("timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def otp_digest(pepper: str, purpose: str, subject: str, code: str) -> str:
    msg = f"{purpose}|{subject.lower()}|{code}".encode()
    return hmac.new(pepper.encode(), msg, hashlib.sha256).hexdigest()


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_key(secret: str, token: str) -> str:
    """Server-side key for an opaque token (we never store raw session tokens)."""
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def constant_time_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
