"""Polling scanner — indexes shared/Media/ and shared/Assets/ every 5 seconds."""
from __future__ import annotations

import asyncio
import json as _json
import mimetypes
import time
from pathlib import Path

from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries.media import insert_media, list_media, delete_media
from src.review_hub.queries.assets import insert_asset, list_assets, delete_asset
from src.review_hub.thumbnails import generate_thumbnail, generate_asset_thumbnail, get_image_dimensions
from src.shared import _log
SCAN_INTERVAL = 5
SETTLE_TIME = 2

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
ALL_EXTS = IMAGE_EXTS | VIDEO_EXTS

_META_KEYS = {"prompt", "model", "model_name", "aspect_ratio", "image_size", "cost_usd", "source", "duration"}

_sio = None

def set_sio(sio):
    global _sio
    _sio = sio


def _read_media_meta(p: Path) -> str | None:
    """Read metadata from PNG tEXt chunks or .meta.json sidecar. Returns JSON string or None."""
    try:
        if p.suffix.lower() in IMAGE_EXTS:
            from PIL import Image as PILImage
            img = PILImage.open(p)
            info = img.info
            img.close()
            if not info or "source" not in info:
                return None
            meta = {k: v for k, v in info.items() if k in _META_KEYS}
            if "cost_usd" in meta:
                try:
                    meta["cost_usd"] = float(meta["cost_usd"])
                except (ValueError, TypeError):
                    pass
            return _json.dumps(meta) if meta else None
        elif p.suffix.lower() in VIDEO_EXTS:
            sidecar = p.with_suffix(".meta.json")
            if sidecar.exists():
                return sidecar.read_text(encoding="utf-8")
    except Exception as e:
        _log(f"Scanner: metadata read failed for {p.name}: {e}")
    return None

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
            meta_json = _read_media_meta(p)
            media_id = await insert_media(
                db,
                filename=p.name,
                filepath=filepath,
                directory=p.parent.relative_to(settings.media_dir).as_posix() if p.is_relative_to(settings.media_dir) else str(p.parent),
                file_size=p.stat().st_size,
                mime_type=mime,
                width=w,
                height=h,
                metadata=meta_json,
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

async def scan_assets_once() -> int:
    """Scan shared/Assets/, index new files, remove deleted. Returns change count."""
    if not settings.assets_dir.exists():
        return 0
    now = time.time()
    db = await get_db()
    changes = 0
    try:
        existing = await list_assets(db)
        known = {row["filepath"] for row in existing}

        on_disk = set()
        for f in settings.assets_dir.rglob("*"):
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
                    _log(f"Scanner: asset dimensions failed for {p.name}: {e}")
            _rel = p.parent.relative_to(settings.assets_dir).as_posix() if p.is_relative_to(settings.assets_dir) else str(p.parent)
            asset_id = await insert_asset(
                db,
                filename=p.name,
                filepath=filepath,
                directory=_rel if _rel != "." else None,
                file_size=p.stat().st_size,
                mime_type=mime,
                width=w,
                height=h,
            )
            if p.suffix.lower() in IMAGE_EXTS and asset_id:
                try:
                    thumb = generate_asset_thumbnail(p, asset_id)
                    await db.execute("UPDATE assets SET thumbnail_path=? WHERE id=?", (thumb, asset_id))
                except Exception as e:
                    _log(f"Scanner: asset thumbnail failed for {p.name}: {e}")
            changes += 1

        for filepath in known - on_disk:
            row = next((r for r in existing if r["filepath"] == filepath), None)
            if row:
                await delete_asset(db, row["id"])
                changes += 1

        if changes:
            await db.commit()
    finally:
        await db.close()
    return changes


async def backfill_metadata() -> int:
    """One-shot: populate metadata for existing media rows that have NULL metadata."""
    db = await get_db()
    count = 0
    try:
        cursor = await db.execute("SELECT id, filepath FROM media WHERE metadata IS NULL")
        rows = await cursor.fetchall()
        for row in rows:
            p = Path(row["filepath"])
            if not p.exists():
                continue
            meta_json = _read_media_meta(p)
            if meta_json:
                await db.execute("UPDATE media SET metadata=? WHERE id=?", (meta_json, row["id"]))
                count += 1
        if count:
            await db.commit()
            _log(f"Scanner: backfilled metadata for {count} media rows")
    except Exception as e:
        _log(f"Scanner: backfill error: {e}")
    finally:
        await db.close()
    return count


async def run_scanner():
    """Background loop."""
    await backfill_metadata()
    while True:
        try:
            changes = await scan_once()
            if changes and _sio:
                await _sio.emit("media_update", {"changes": changes}, room="review")
        except Exception as e:
            _log(f"Scanner: error in scan loop: {e}")
        try:
            asset_changes = await scan_assets_once()
            if asset_changes and _sio:
                await _sio.emit("assets_update", {"changes": asset_changes}, room="review")
        except Exception as e:
            _log(f"Scanner: error in assets scan loop: {e}")
        await asyncio.sleep(SCAN_INTERVAL)
