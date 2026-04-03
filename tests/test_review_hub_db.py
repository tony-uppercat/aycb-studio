import asyncio
import pytest

def test_init_db_creates_tables(tmp_db):
    from src.review_hub.db import init_db, get_db
    asyncio.run(init_db())
    assert tmp_db.exists()

    async def check():
        db = await get_db()
        cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in await cursor.fetchall()}
        await db.close()
        return tables

    tables = asyncio.run(check())
    assert "media" in tables
    assert "comments" in tables
    assert "favorites" in tables
    assert "drawings" in tables
    assert "references" in tables
    assert "feedback" in tables
    assert "sessions" in tables

def test_foreign_keys_cascade(tmp_db):
    from src.review_hub.db import init_db, get_db
    asyncio.run(init_db())

    async def check_cascade():
        db = await get_db()
        # Insert media
        await db.execute("INSERT INTO media (filename) VALUES ('test.png')")
        cursor = await db.execute("SELECT last_insert_rowid()")
        media_id = (await cursor.fetchone())[0]
        # Insert comment
        await db.execute("INSERT INTO comments (media_id, content) VALUES (?, 'hello')", (media_id,))
        await db.commit()
        # Verify comment exists
        cursor = await db.execute("SELECT COUNT(*) FROM comments WHERE media_id=?", (media_id,))
        assert (await cursor.fetchone())[0] == 1
        # Delete media — should cascade
        await db.execute("DELETE FROM media WHERE id=?", (media_id,))
        await db.commit()
        cursor = await db.execute("SELECT COUNT(*) FROM comments WHERE media_id=?", (media_id,))
        assert (await cursor.fetchone())[0] == 0
        await db.close()

    asyncio.run(check_cascade())
