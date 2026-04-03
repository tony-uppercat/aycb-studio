"""Routes for media items."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import media as q

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class BulkDeleteBody(BaseModel):
    ids: list[int]


def _enrich(item: dict) -> dict:
    """Add media_url and thumbnail_url from absolute paths."""
    fp = item.get("filepath")
    if fp:
        try:
            rel = Path(fp).relative_to(settings.media_dir)
            item["media_url"] = "/media/" + rel.as_posix()
        except (ValueError, TypeError):
            item["media_url"] = f"/media/{item.get('filename', '')}"
    tp = item.get("thumbnail_path")
    if tp:
        item["thumbnail_url"] = "/thumbnails/" + Path(tp).name
    return item


# ── fixed-path routes FIRST ──────────────────────────────────────────

@router.get("/media/directories")
async def list_directories():
    db = await get_db()
    try:
        dirs = await q.get_directories(db)
        return {"directories": dirs}
    finally:
        await db.close()


@router.get("/media/stats")
async def media_stats():
    db = await get_db()
    try:
        stats = await q.get_stats(db)
        return stats
    finally:
        await db.close()


# ── stream route (fixed sub-path, must come before /{media_id}) ──────

@router.get("/media/{media_id}/stream")
async def stream_media(media_id: int):
    """Stream a media file directly (e.g. video playback)."""
    db = await get_db()
    try:
        item = await q.get_media(db, media_id)
    finally:
        await db.close()

    if item is None:
        raise HTTPException(status_code=404, detail="Media not found")

    path = Path(item["filepath"]) if item.get("filepath") else None
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")

    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(
        path=str(path),
        media_type=mime or "application/octet-stream",
        headers={"Accept-Ranges": "bytes"},
    )


# ── parameterised routes ─────────────────────────────────────────────

@router.get("/media")
async def list_media(
    directory: str | None = None,
    sort: str = "created_at",
    order: str = "DESC",
):
    db = await get_db()
    try:
        items = await q.list_media(db, directory=directory, sort=sort, order=order)
        return {"items": [_enrich(i) for i in items], "total": len(items)}
    finally:
        await db.close()


@router.get("/media/{media_id}")
async def get_media(media_id: int):
    db = await get_db()
    try:
        item = await q.get_media(db, media_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Media not found")
        return _enrich(item)
    finally:
        await db.close()


@router.delete("/media/{media_id}")
async def delete_media(media_id: int):
    db = await get_db()
    try:
        item = await q.get_media(db, media_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Media not found")

        # Remove thumbnail file if it exists
        if item.get("thumbnail_path"):
            thumb = Path(item["thumbnail_path"])
            if thumb.is_file():
                thumb.unlink()

        await q.delete_media(db, media_id)
        return {"ok": True}
    finally:
        await db.close()


@router.post("/media/bulk-delete")
async def bulk_delete_media(
    body: BulkDeleteBody,
    x_username: str | None = Header(default=None),
):
    """Delete multiple media items. Requires X-Username: admin header."""
    if x_username != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    db = await get_db()
    deleted: list[int] = []
    try:
        for mid in body.ids:
            item = await q.get_media(db, mid)
            if item is None:
                continue
            if item.get("thumbnail_path"):
                thumb = Path(item["thumbnail_path"])
                if thumb.is_file():
                    thumb.unlink()
            await q.delete_media(db, mid)
            deleted.append(mid)
        return {"ok": True, "deleted": deleted}
    finally:
        await db.close()
