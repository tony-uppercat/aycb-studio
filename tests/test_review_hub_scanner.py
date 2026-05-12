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


def test_fingerprint_cache_reuses_walk(scan_env, monkeypatch):
    """When the tree fingerprint is unchanged between scans, the full
    rglob walk is skipped and the prior on-disk set is reused."""
    from src.review_hub import scanner
    from src.review_hub.db import init_db
    import time

    media_dir, _ = scan_env
    asyncio.run(init_db())

    img = Image.new("RGB", (50, 50), "blue")
    img.save(media_dir / "stable.png")
    time.sleep(2.1)

    # First scan: walks the tree and caches.
    asyncio.run(scanner.scan_once())

    # Monkeypatch the walk to detect whether it runs on the second scan.
    call_count = {"n": 0}
    original_walk = scanner._walk_media_tree

    def counting_walk(*a, **kw):
        call_count["n"] += 1
        return original_walk(*a, **kw)

    monkeypatch.setattr(scanner, "_walk_media_tree", counting_walk)

    # Second scan: nothing changed on disk, fingerprint should match.
    asyncio.run(scanner.scan_once())
    assert call_count["n"] == 0, "cache hit should skip full walk"


def test_fingerprint_invalidates_when_file_added(scan_env, monkeypatch):
    """Adding a file bumps its parent dir's mtime → fingerprint changes
    → scanner re-walks, finds the new file."""
    from src.review_hub import scanner
    from src.review_hub.db import init_db
    import time

    media_dir, _ = scan_env
    asyncio.run(init_db())

    Image.new("RGB", (50, 50), "blue").save(media_dir / "a.png")
    time.sleep(2.1)
    asyncio.run(scanner.scan_once())

    # Add a new file — mtime on media_dir changes.
    time.sleep(0.1)
    Image.new("RGB", (50, 50), "green").save(media_dir / "b.png")
    time.sleep(2.1)

    changes = asyncio.run(scanner.scan_once())
    assert changes >= 1, "scanner must detect the new file after fingerprint change"
