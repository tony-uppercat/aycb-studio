"""Tests for media_asset_links table and queries."""
from __future__ import annotations
import pytest
import pytest_asyncio
import aiosqlite
from pathlib import Path

from src.review_hub.queries import asset_links as alq

SCHEMA = Path(__file__).resolve().parent.parent / "src" / "review_hub" / "schema.sql"

@pytest_asyncio.fixture
async def db(tmp_path):
    db_path = tmp_path / "test.db"
    conn = await aiosqlite.connect(str(db_path))
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys=ON")
    schema = SCHEMA.read_text(encoding="utf-8")
    await conn.executescript(schema)
    await conn.commit()
    await conn.execute("INSERT INTO media (id, filename) VALUES (1, 'test.png')")
    await conn.commit()
    yield conn
    await conn.close()


# ── Schema tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_media_asset_links_table_exists(db):
    cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='media_asset_links'")
    assert await cursor.fetchone() is not None

@pytest.mark.asyncio
async def test_insert_link(db):
    await db.execute("INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'characters/heroes')")
    await db.commit()
    cursor = await db.execute("SELECT * FROM media_asset_links WHERE media_id=1")
    row = await cursor.fetchone()
    assert row is not None
    assert row["directory"] == "characters/heroes"

@pytest.mark.asyncio
async def test_unique_constraint(db):
    await db.execute("INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'heroes')")
    await db.commit()
    with pytest.raises(aiosqlite.IntegrityError):
        await db.execute("INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'heroes')")

@pytest.mark.asyncio
async def test_cascade_delete(db):
    await db.execute("INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'heroes')")
    await db.commit()
    await db.execute("DELETE FROM media WHERE id=1")
    await db.commit()
    cursor = await db.execute("SELECT * FROM media_asset_links")
    assert len(await cursor.fetchall()) == 0


# ── Query helper tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_link(db):
    link = await alq.create_link(db, media_id=1, directory="chars")
    assert link["media_id"] == 1
    assert link["directory"] == "chars"
    assert link["id"] is not None

@pytest.mark.asyncio
async def test_create_link_duplicate_returns_existing(db):
    link1 = await alq.create_link(db, media_id=1, directory="chars")
    link2 = await alq.create_link(db, media_id=1, directory="chars")
    assert link1["id"] == link2["id"]

@pytest.mark.asyncio
async def test_delete_link(db):
    link = await alq.create_link(db, media_id=1, directory="chars")
    assert await alq.delete_link(db, link["id"]) is True
    cursor = await db.execute("SELECT * FROM media_asset_links WHERE id=?", (link["id"],))
    assert await cursor.fetchone() is None

@pytest.mark.asyncio
async def test_delete_nonexistent_link(db):
    assert await alq.delete_link(db, 9999) is False

@pytest.mark.asyncio
async def test_list_links_for_directory(db):
    await alq.create_link(db, media_id=1, directory="chars")
    links = await alq.list_links_for_directory(db, "chars")
    assert len(links) == 1
    assert links[0]["media_id"] == 1
    assert links[0]["filename"] == "test.png"

@pytest.mark.asyncio
async def test_list_links_empty_directory(db):
    assert await alq.list_links_for_directory(db, "empty") == []
