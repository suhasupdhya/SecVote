"""One email interface, three backends. Console writes to a local mailbox file (dev/test only)."""

from __future__ import annotations

import asyncio
import json
import logging
import smtplib
from collections.abc import Awaitable, Callable
from email.message import EmailMessage
from typing import Protocol

import httpx

from secvote.core.config import Settings
from secvote.core.errors import Unavailable
from secvote.domain.phases import now_utc

log = logging.getLogger(__name__)

SEND_TIMEOUT = 30  # seconds per attempt; Gmail can be slow to accept a message
SEND_ATTEMPTS = 2
RETRY_DELAY = 1.0  # seconds between attempts


def email_failed() -> Unavailable:
    return Unavailable(
        "We couldn't send the email right now. Please try again in a minute.", code="email_failed"
    )


async def _with_retry(what: str, attempt: Callable[[], Awaitable[object]]) -> None:
    """Runs a send once more on failure, then raises a clean 503 instead of a server crash.
    Logs the provider's error (never the credentials) so the operator can see what went wrong."""
    for n in range(1, SEND_ATTEMPTS + 1):
        try:
            await attempt()
            return
        except Exception as exc:
            log.warning(
                "%s email attempt %d/%d failed: %s: %s", what, n, SEND_ATTEMPTS, type(exc).__name__, exc
            )
            if n < SEND_ATTEMPTS:
                await asyncio.sleep(RETRY_DELAY)
    raise email_failed()


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleSender:
    def __init__(self, settings: Settings) -> None:
        self.path = settings.mailbox_file

    async def send(self, to: str, subject: str, body: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({"to": to, "subject": subject, "body": body, "at": now_utc().isoformat()})
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        log.info("email (console) to=%s subject=%s", to, subject)


class SmtpSender:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def _send_sync(self, msg: EmailMessage) -> None:
        password = self.s.smtp_password.get_secret_value()
        if self.s.smtp_port == 465:  # implicit TLS
            with smtplib.SMTP_SSL(self.s.smtp_host, self.s.smtp_port, timeout=SEND_TIMEOUT) as smtp:
                smtp.login(self.s.smtp_user, password)
                smtp.send_message(msg)
            return
        with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=SEND_TIMEOUT) as smtp:  # STARTTLS (587)
            smtp.starttls()
            smtp.login(self.s.smtp_user, password)
            smtp.send_message(msg)

    async def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.s.email_from, to, subject
        msg.set_content(body)
        await _with_retry("SMTP", lambda: asyncio.to_thread(self._send_sync, msg))


class ResendSender:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    async def _send_once(self, to: str, subject: str, body: str) -> None:
        async with httpx.AsyncClient(timeout=SEND_TIMEOUT) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.s.resend_api_key.get_secret_value()}"},
                json={"from": self.s.email_from, "to": [to], "subject": subject, "text": body},
            )
            if r.is_error:  # Resend explains the problem (e.g. unverified domain) in the body
                raise RuntimeError(f"Resend {r.status_code}: {r.text[:300]}")

    async def send(self, to: str, subject: str, body: str) -> None:
        await _with_retry("Resend", lambda: self._send_once(to, subject, body))


def get_email_sender(settings: Settings) -> EmailSender:
    if settings.email_backend == "smtp":
        return SmtpSender(settings)
    if settings.email_backend == "resend":
        return ResendSender(settings)
    if settings.env == "prod":
        raise RuntimeError("console email backend is not allowed in prod")
    return ConsoleSender(settings)
