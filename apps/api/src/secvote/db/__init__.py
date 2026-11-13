from __future__ import annotations

from beanie import init_beanie
from pymongo import AsyncMongoClient

from secvote.core.config import Settings
from secvote.db.models import ALL_MODELS

_client: AsyncMongoClient | None = None  # type: ignore[type-arg]


async def init_db(settings: Settings) -> AsyncMongoClient:  # type: ignore[type-arg]
    global _client
    _client = AsyncMongoClient(settings.mongodb_uri, tz_aware=True)
    await init_beanie(database=_client[settings.mongodb_db], document_models=ALL_MODELS)
    return _client


async def close_db() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
