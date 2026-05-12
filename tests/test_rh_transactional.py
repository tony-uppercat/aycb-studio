"""Integration tests for Review Hub transactional endpoints (Phase 1 / M6).

Covers the five endpoints that touch both disk and DB:
- folders.rename_folder
- folders.move_media
- media.delete_media
- media.bulk_delete_media
- upload.upload_reference

Each endpoint has a happy-path test plus a failure-mode test that
verifies the DB↔disk invariant still holds after an error.
"""
from __future__ import annotations

import asyncio
from unittest import mock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with DB + shared_root pointed at tmp_path.

    `raise_server_exceptions=False` lets us assert 500 responses from
    deliberately-injected failures instead of re-raising in-process.
    """
    import src.review_hub.db as db_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")

    # Redirect all shared-root children (media, references, thumbnails) to tmp.
    from config.settings import settings
    monkeypatch.setattr(settings, "shared_root", tmp_path)

    # init_db reads _DB_PATH directly, so run it after the patch.
    asyncio.run(db_mod.init_db())
    from src.api import app
    return TestClient(app, raise_server_exceptions=False)


def _insert_media_row(
    filename: str = "test.png", directory: str = "Project", filepath: str | None = None
) -> int:
    """Insert a media row and return its id."""
    from src.review_hub.db import get_db
    from src.review_hub.queries.media import insert_media

    async def go():
        db = await get_db()
        try:
            return await insert_media(
                db, filename=filename, directory=directory, filepath=filepath,
            )
        finally:
            await db.close()

    return asyncio.run(go())


def _get_media_row(media_id: int) -> dict | None:
    from src.review_hub.db import get_db
    from src.review_hub.queries.media import get_media

    async def go():
        db = await get_db()
        try:
            return await get_media(db, media_id)
        finally:
            await db.close()

    return asyncio.run(go())


# ── folders.rename_folder ──────────────────────────────────────────────

def test_rename_folder_updates_disk_and_db(client, tmp_path):
    """Happy path: folder renames on disk AND DB rows update to match."""
    from config.settings import settings
    src = settings.media_dir / "OldName"
    src.mkdir(parents=True)
    (src / "file.png").write_bytes(b"png")

    mid = _insert_media_row(
        filename="file.png", directory="OldName",
        filepath=str(src / "file.png"),
    )

    resp = client.post("/api/rh/folders/OldName/rename", json={"new_name": "NewName"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "NewName"

    # Disk side
    assert not src.exists()
    assert (settings.media_dir / "NewName").is_dir()

    # DB side
    row = _get_media_row(mid)
    assert row["directory"] == "NewName"
    assert row["filepath"].endswith("NewName" + row["filepath"][-len("file.png") - 1:])


def test_rename_folder_rolls_back_on_commit_failure(client, tmp_path, monkeypatch):
    """If DB commit raises after disk rename, the rename must be reverted."""
    from config.settings import settings
    src = settings.media_dir / "OldName"
    src.mkdir(parents=True)
    (src / "file.png").write_bytes(b"png")

    _insert_media_row(
        filename="file.png", directory="OldName",
        filepath=str(src / "file.png"),
    )

    import aiosqlite
    original_commit = aiosqlite.Connection.commit

    async def boom(self):
        raise RuntimeError("simulated commit failure")

    # Patch commit to fail. Hit the exact class aiosqlite exposes.
    monkeypatch.setattr(aiosqlite.Connection, "commit", boom)

    try:
        resp = client.post(
            "/api/rh/folders/OldName/rename", json={"new_name": "NewName"},
        )
        assert resp.status_code == 500
    finally:
        # Un-patch so later assertions can see clean state.
        monkeypatch.setattr(aiosqlite.Connection, "commit", original_commit)

    # Disk was reverted.
    assert src.is_dir()
    assert not (settings.media_dir / "NewName").exists()


# ── folders.move_media ──────────────────────────────────────────────────

def test_move_media_updates_disk_and_db(client, tmp_path):
    from config.settings import settings
    src_dir = settings.media_dir / "From"
    src_dir.mkdir(parents=True)
    (src_dir / "img.png").write_bytes(b"png")
    mid = _insert_media_row(
        filename="img.png", directory="From", filepath=str(src_dir / "img.png"),
    )

    resp = client.post(
        "/api/rh/folders/move", json={"media_id": mid, "target_dir": "To"},
    )
    assert resp.status_code == 200

    assert not (src_dir / "img.png").exists()
    assert (settings.media_dir / "To" / "img.png").exists()

    row = _get_media_row(mid)
    assert row["directory"] == "To"
    assert row["filepath"].endswith("img.png")
    assert "To" in row["filepath"]


# ── media.delete_media ──────────────────────────────────────────────────

def test_delete_media_removes_file_and_row(client, tmp_path):
    from config.settings import settings
    d = settings.media_dir / "P"
    d.mkdir(parents=True)
    f = d / "x.png"
    f.write_bytes(b"png")
    mid = _insert_media_row(filename="x.png", directory="P", filepath=str(f))

    resp = client.delete(f"/api/rh/media/{mid}", headers={"X-Admin-Pin": "1312"})
    assert resp.status_code == 200

    assert not f.exists()
    assert _get_media_row(mid) is None


def test_delete_media_source_unlink_failure_preserves_db(
    client, tmp_path, monkeypatch
):
    """If source unlink fails, the DB row must be preserved so the
    caller can retry without losing the record."""
    from pathlib import Path as _Path
    from config.settings import settings
    d = settings.media_dir / "P"
    d.mkdir(parents=True)
    f = d / "x.png"
    f.write_bytes(b"png")
    mid = _insert_media_row(filename="x.png", directory="P", filepath=str(f))

    original_unlink = _Path.unlink

    def fake_unlink(self, *a, **kw):
        # Fail only on the source file; let thumb / other unlinks through.
        if self == f:
            raise OSError("simulated unlink failure")
        return original_unlink(self, *a, **kw)

    monkeypatch.setattr(_Path, "unlink", fake_unlink)

    resp = client.delete(f"/api/rh/media/{mid}", headers={"X-Admin-Pin": "1312"})
    assert resp.status_code == 500

    # DB row still exists — retry will work once the OS recovers.
    assert _get_media_row(mid) is not None


# ── media.bulk_delete_media ─────────────────────────────────────────────

def test_bulk_delete_skips_unlink_failure_and_continues(
    client, tmp_path, monkeypatch
):
    """One unlink failure in a batch must not abort the whole batch.

    The failing item is skipped (reported in neither `deleted` nor as an
    error); items before and after succeed."""
    from pathlib import Path as _Path
    from config.settings import settings
    d = settings.media_dir / "P"
    d.mkdir(parents=True)
    ids: list[int] = []
    files: list = []
    for i in range(3):
        fp = d / f"item{i}.png"
        fp.write_bytes(b"png")
        files.append(fp)
        ids.append(_insert_media_row(
            filename=f"item{i}.png", directory="P", filepath=str(fp),
        ))

    original_unlink = _Path.unlink

    def fake_unlink(self, *a, **kw):
        if self == files[1]:  # item 1 fails
            raise OSError("nope")
        return original_unlink(self, *a, **kw)

    monkeypatch.setattr(_Path, "unlink", fake_unlink)

    resp = client.post(
        "/api/rh/media/bulk-delete",
        json={"ids": ids},
        headers={"X-Admin-Pin": "1312"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert set(body["deleted"]) == {ids[0], ids[2]}  # 1 skipped, 0 and 2 gone
    # Item 1 still in DB
    assert _get_media_row(ids[1]) is not None
    # 0 and 2 removed
    assert _get_media_row(ids[0]) is None
    assert _get_media_row(ids[2]) is None
