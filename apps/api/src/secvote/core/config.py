"""Settings, loaded from env (prefix SECVOTE_) or apps/api/.env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[3]  # apps/api
REPO_ROOT = API_ROOT.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SECVOTE_", env_file=API_ROOT / ".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    reload: bool = False  # dev: auto-restart API on code changes

    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_db: str = "secvote"
    redis_url: str = ""  # empty -> in-process fakeredis (dev/test only)

    session_secret: SecretStr = SecretStr("dev-session-secret-change-me")
    otp_pepper: SecretStr = SecretStr("dev-otp-pepper-change-me")
    cookie_secure: bool = False
    session_ttl_seconds: int = 60 * 60 * 8
    admin_session_ttl_seconds: int = 60 * 60
    allowed_email_domains: list[str] = Field(default_factory=lambda: ["example.edu.in"])

    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 30
    # Super admins, admins and officers confirm every sign-in with an emailed code. Turn off only for local testing.
    official_login_code: bool = True

    email_backend: Literal["console", "smtp", "resend"] = "console"
    email_from: str = "SecVote <no-reply@example.edu.in>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    resend_api_key: SecretStr = SecretStr("")

    upload_dir: Path = API_ROOT / "var" / "uploads"
    mailbox_file: Path = API_ROOT / "var" / "mailbox.jsonl"  # console email backend (dev only)
    max_upload_bytes: int = 5 * 1024 * 1024

    chain_required: bool = True
    rpc_url: str = "http://127.0.0.1:8545"
    chain_id: int = 31337
    relayer_private_key: SecretStr = SecretStr("")
    confirmations: int = 1
    shared_dir: Path = REPO_ROOT / "packages" / "shared"
    member_batch_size: int = 50
    worker_poll_seconds: float = 1.0
    # /readyz reports "low" below this many wei on the relayer (it pays every ballot's fee). 0 = don't check.
    relayer_min_balance_wei: int = 0

    ballot_rate_limit_per_minute: int = 30
    # Behind a reverse proxy every request arrives from the proxy, so per-network limits need the visitor's address.
    # Set to a header the trusted proxy OVERWRITES on every request (deploy/Caddyfile sets X-SecVote-Client).
    # Empty = use the connecting address (local development). Never point it at a header clients can set.
    client_ip_header: str = ""

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    web_url: str = "http://localhost:3000"  # links in emails point here


@lru_cache
def get_settings() -> Settings:
    return Settings()


def production_problems(s: Settings) -> list[str]:
    """Settings that are fine on a laptop but unsafe on a public server. Empty outside prod."""
    if s.env != "prod":
        return []
    problems = []
    for name in ("session_secret", "otp_pepper"):
        value = getattr(s, name).get_secret_value()
        if "change-me" in value or len(value) < 32:
            problems.append(
                f"SECVOTE_{name.upper()} must be a long random value (32+ characters), not the default"
            )
    if not s.cookie_secure:
        problems.append("SECVOTE_COOKIE_SECURE must be true (the site must be served over HTTPS)")
    if not s.official_login_code:
        problems.append("SECVOTE_OFFICIAL_LOGIN_CODE must be true: officials confirm every sign-in by email")
    if s.email_backend == "console":
        problems.append("SECVOTE_EMAIL_BACKEND must be smtp or resend")
    if not s.redis_url:
        problems.append("SECVOTE_REDIS_URL is required")
    if s.chain_required and not s.relayer_private_key.get_secret_value():
        problems.append("SECVOTE_RELAYER_PRIVATE_KEY is required")
    if s.web_url.startswith("http://"):
        problems.append("SECVOTE_WEB_URL must be the public https:// address of the site")
    if any(o.startswith("http://") for o in s.cors_origins):
        problems.append("SECVOTE_CORS_ORIGINS must only list https:// origins")
    return problems


def check_production(s: Settings) -> None:
    """Refuse to start a production server with unsafe settings."""
    problems = production_problems(s)
    if problems:
        raise RuntimeError("Unsafe production settings:\n  - " + "\n  - ".join(problems))
