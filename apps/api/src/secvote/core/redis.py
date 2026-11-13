"""Redis for OTPs, sessions and rate limits. Falls back to in-process fakeredis when no URL is set."""

from __future__ import annotations

import logging

from redis.asyncio import Redis

from secvote.core.config import Settings

log = logging.getLogger(__name__)

_client: Redis | None = None


def get_redis(settings: Settings) -> Redis:
    global _client
    if _client is None:
        if settings.redis_url:
            _client = Redis.from_url(settings.redis_url, decode_responses=True)
        else:
            if settings.env == "prod":
                raise RuntimeError("SECVOTE_REDIS_URL is required in prod")
            import fakeredis

            log.warning("SECVOTE_REDIS_URL not set: using in-process fakeredis (single process only)")
            _client = fakeredis.FakeAsyncRedis(decode_responses=True)
    return _client


def reset_redis() -> None:
    global _client
    _client = None
