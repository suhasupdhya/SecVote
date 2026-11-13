"""ID-card files can live on disk or in MongoDB (SECVOTE_UPLOAD_STORAGE), and are erased on time either way."""

from __future__ import annotations

from datetime import timedelta

import pytest
from beanie import PydanticObjectId

from secvote.core.config import Settings
from secvote.db.models import StoredDocument, StoredFile
from secvote.domain.phases import now_utc
from secvote.services import files
from secvote.workers.scheduler import purge_documents

PDF = b"%PDF-1.4 test id card"


@pytest.mark.parametrize("storage", ["disk", "mongo"])
async def test_save_load_remove(settings: Settings, storage: str) -> None:
    s = settings.model_copy(update={"upload_storage": storage})
    name = f"{storage}-roundtrip.pdf"
    await files.save(s, name, PDF)
    assert await files.load(s, name) == PDF
    assert (settings.upload_dir / name).exists() == (storage == "disk")
    assert (await StoredFile.find_one(StoredFile.name == name) is not None) == (storage == "mongo")
    await files.remove(s, name)
    assert await files.load(s, name) is None


async def test_disk_load_refuses_paths_outside_the_upload_folder(settings: Settings) -> None:
    assert await files.load(settings, "../../etc/passwd") is None


async def test_retention_job_erases_database_stored_files(settings: Settings) -> None:
    # On Render the worker runs apart from the API: with "mongo" it can still delete what the API saved.
    s = settings.model_copy(update={"upload_storage": "mongo"})
    await files.save(s, "expired.pdf", PDF)
    await files.save(s, "kept.pdf", PDF)
    ids = PydanticObjectId(), PydanticObjectId()
    for name, delete_after in (
        ("expired.pdf", now_utc() - timedelta(days=1)),
        ("kept.pdf", now_utc() + timedelta(days=1)),
    ):
        await StoredDocument(
            owner_id=ids[0],
            election_id=ids[1],
            path=name,
            content_type="application/pdf",
            size=len(PDF),
            sha256="x",
            delete_after=delete_after,
        ).insert()

    await purge_documents(s)

    assert await files.load(s, "expired.pdf") is None
    assert await StoredDocument.find_one(StoredDocument.path == "expired.pdf") is None
    assert await files.load(s, "kept.pdf") == PDF
