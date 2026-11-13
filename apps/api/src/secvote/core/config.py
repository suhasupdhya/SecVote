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

    ballot_rate_limit_per_minute: int = 30

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    web_url: str = "http://localhost:3000"  # links in emails point here


@lru_cache
def get_settings() -> Settings:
    return Settings()
