import asyncio
import pytest
from pathlib import Path
from PIL import Image


@pytest.fixture
def scan_env(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    import src.review_hub.thumbnails as thumb_mod
    from config.settings import settings

    db_path = tmp_path / "test.db"
    media_dir = tmp_path / "Media"
    thumb_dir = tmp_path / "thumbs"
    media_dir.mkdir()

    monkeypatch.setattr(db_mod, "_DB_PATH", db_path)
    monkeypatch.setattr(settings, "shared_root", media_dir.parent)
    monkeypatch.setattr(thumb_mod, "THUMB_DIR", thumb_dir)

    return media_dir, thumb_dir


def test_scan_finds_new_image(scan_env):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.scanner import scan_once

    media_dir, thumb_dir = scan_env
    asyncio.run(init_db())

    # Create test image
    img = Image.new("RGB", (100, 100), "red")
    img.save(media_dir / "test.png")

    # Wait for settle time
    import time
    time.sleep(2.1)

    changes = asyncio.run(scan_once())
    assert changes == 1

    async def check():
        db = await get_db()
        cursor = await db.execute("SELECT * FROM media")
        rows = await cursor.fetchall()
        await db.close()
        return rows

    rows = asyncio.run(check())
    assert len(rows) == 1
    assert rows[0]["filename"] == "test.png"
    assert (thumb_dir / f"{rows[0]['id']}.jpg").exists()
