"""Polling scanner — indexes shared/Media/ every 5 seconds."""
from __future__ import annotations

import asyncio
import mimetypes
import time
from pathlib import Path

from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries.media import insert_media, list_media, delete_media
from src.review_hub.thumbnails import generate_thumbnail, get_image_dimensions
from src.shared import _log
SCAN_INTERVAL = 5
SETTLE_TIME = 2

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
ALL_EXTS = IMAGE_EXTS | VIDEO_EXTS

_sio = None

def set_sio(sio):
    global _sio
    _sio = sio

async def scan_once() -> int:
    """Scan directory, index new files, remove deleted. Returns change count."""
    if not settings.media_dir.exists():
        return 0
    now = time.time()
    db = await get_db()
    changes = 0
    try:
        existing = await list_media(db)
        known = {row["filepath"] for row in existing}

        on_disk = set()
        for f in settings.media_dir.rglob("*"):
            if f.suffix.lower() not in ALL_EXTS:
                continue
            if now - f.stat().st_mtime < SETTLE_TIME:
                continue
            on_disk.add(str(f))

        for filepath in on_disk - known:
            p = Path(filepath)
            mime = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
            w, h = (0, 0)
            if p.suffix.lower() in IMAGE_EXTS:
                try:
                    w, h = get_image_dimensions(p)
                except Exception as e:
                    _log(f"Scanner: dimensions failed for {p.name}: {e}")
            media_id = await insert_media(
                db,
                filename=p.name,
                filepath=filepath,
                directory=str(p.parent.relative_to(settings.media_dir)) if p.is_relative_to(settings.media_dir) else str(p.parent),
                file_size=p.stat().st_size,
                mime_type=mime,
                width=w,
                height=h,
            )
            if p.suffix.lower() in IMAGE_EXTS and media_id:
                try:
                    thumb = generate_thumbnail(p, media_id)
                    await db.execute("UPDATE media SET thumbnail_path=? WHERE id=?", (thumb, media_id))
                except Exception as e:
                    _log(f"Scanner: thumbnail failed for {p.name}: {e}")
            changes += 1

        for filepath in known - on_disk:
            row = next((r for r in existing if r["filepath"] == filepath), None)
            if row:
                await delete_media(db, row["id"])
                changes += 1

        if changes:
            await db.commit()
    finally:
        await db.close()
    return changes

async def run_scanner():
    """Background loop."""
    while True:
        try:
            changes = await scan_once()
            if changes and _sio:
                await _sio.emit("media_update", {"changes": changes}, room="review")
        except Exception as e:
            _log(f"Scanner: error in scan loop: {e}")
        await asyncio.sleep(SCAN_INTERVAL)
