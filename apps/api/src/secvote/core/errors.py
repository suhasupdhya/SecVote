"""Domain errors. Services raise these; the API layer maps them to HTTP responses."""

from __future__ import annotations


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class WrongPhase(AppError):
    status_code = 409
    code = "wrong_phase"


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"


class Unavailable(AppError):
    status_code = 503
    code = "unavailable"
