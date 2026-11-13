"""Where uploaded ID-card files are kept (SECVOTE_UPLOAD_STORAGE).

- "disk" (default): files under settings.upload_dir. Right for one server or Docker Compose with a volume.
- "mongo": file bytes in the database. For hosts whose disk is temporary or not shared between the API and the
  worker (e.g. Render): the API saves the file, and the worker's retention job can still delete it.
Files are at most settings.max_upload_bytes (5 MB), well under MongoDB's 16 MB document limit.
"""

from __future__ import annotations

from secvote.core.config import Settings
from secvote.db.models import StoredFile


async def save(settings: Settings, name: str, data: bytes) -> None:
    if settings.upload_storage == "mongo":
        await StoredFile(name=name, data=data).insert()
        return
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    (settings.upload_dir / name).write_bytes(data)


async def load(settings: Settings, name: str) -> bytes | None:
    if settings.upload_storage == "mongo":
        stored = await StoredFile.find_one(StoredFile.name == name)
        return stored.data if stored else None
    path = (settings.upload_dir / name).resolve()
    if settings.upload_dir.resolve() not in path.parents or not path.exists():
        return None
    return path.read_bytes()


async def remove(settings: Settings, name: str) -> None:
    """Deletes from both places, so files saved before a storage switch are still erased on time."""
    (settings.upload_dir / name).unlink(missing_ok=True)
    await StoredFile.find(StoredFile.name == name).delete()
