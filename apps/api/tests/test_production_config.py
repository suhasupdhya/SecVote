"""A production server refuses to start with settings that are only safe on a laptop."""

from __future__ import annotations

import pytest

from secvote.core.config import Settings, check_production, production_problems


def _prod(**kw: object) -> Settings:
    base: dict[str, object] = {
        "_env_file": None,
        "env": "prod",
        "session_secret": "s" * 48,
        "otp_pepper": "p" * 48,
        "cookie_secure": True,
        "email_backend": "resend",
        "redis_url": "redis://localhost:6379/0",
        "relayer_private_key": "0x" + "1" * 64,
        "web_url": "https://vote.example.edu",
        "cors_origins": ["https://vote.example.edu"],
    }
    base.update(kw)
    return Settings(**base)  # type: ignore[arg-type]


def test_safe_production_settings_pass() -> None:
    assert production_problems(_prod()) == []
    check_production(_prod())


@pytest.mark.parametrize(
    ("override", "fragment"),
    [
        ({"session_secret": "dev-session-secret-change-me"}, "SECVOTE_SESSION_SECRET"),
        ({"otp_pepper": "short"}, "SECVOTE_OTP_PEPPER"),
        ({"cookie_secure": False}, "SECVOTE_COOKIE_SECURE"),
        ({"official_login_code": False}, "SECVOTE_OFFICIAL_LOGIN_CODE"),
        ({"email_backend": "console"}, "SECVOTE_EMAIL_BACKEND"),
        ({"redis_url": ""}, "SECVOTE_REDIS_URL"),
        ({"relayer_private_key": ""}, "SECVOTE_RELAYER_PRIVATE_KEY"),
        ({"web_url": "http://localhost:3000"}, "SECVOTE_WEB_URL"),
    ],
)
def test_unsafe_production_settings_are_refused(override: dict[str, object], fragment: str) -> None:
    with pytest.raises(RuntimeError, match=fragment):
        check_production(_prod(**override))


def test_dev_settings_are_not_checked() -> None:
    assert production_problems(Settings(_env_file=None, env="dev")) == []  # type: ignore[call-arg]


def test_api_docs_hidden_in_production() -> None:
    from secvote.main import create_app

    app = create_app(_prod(chain_required=False))
    assert app.docs_url is None and app.openapi_url is None


def _request(peer: str, headers: dict[str, str]) -> object:
    from starlette.requests import Request

    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (peer, 1234)})


def test_ballot_rate_limit_uses_the_proxy_header_only_when_configured() -> None:
    from secvote.api.v1.ballots import client_address

    # Behind Caddy -> web, every request comes from the web container: without the header all voters share one limit.
    behind_proxy = _prod(client_ip_header="X-SecVote-Client")
    assert client_address(_request("172.18.0.3", {"X-SecVote-Client": "203.0.113.7"}), behind_proxy) == "203.0.113.7"  # type: ignore[arg-type]
    assert client_address(_request("172.18.0.3", {}), behind_proxy) == "172.18.0.3"  # type: ignore[arg-type]
    # Not configured (local development): a client-supplied header is ignored, so it can't dodge the limit.
    assert client_address(_request("10.0.0.5", {"X-SecVote-Client": "1.2.3.4"}), _prod()) == "10.0.0.5"  # type: ignore[arg-type]


def test_committed_deployment_record_is_used_when_the_generated_file_lacks_the_chain(tmp_path: object) -> None:
    import json
    from pathlib import Path

    from secvote.chain import load_deployment

    root = Path(str(tmp_path))
    shared = root / "packages" / "shared"
    shared.mkdir(parents=True)
    (shared / "deployments.json").write_text(json.dumps({"31337": {"electionFactory": "0xlocal"}}))
    committed = root / "packages" / "contracts" / "deployments"
    committed.mkdir(parents=True)
    (committed / "84532.json").write_text(json.dumps({"electionFactory": "0xbase", "chainId": 84532}))

    assert load_deployment(_prod(shared_dir=shared, chain_id=84532))["electionFactory"] == "0xbase"
    assert load_deployment(_prod(shared_dir=shared, chain_id=31337))["electionFactory"] == "0xlocal"
