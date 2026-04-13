"""Routes for asset items (shared/Assets/)."""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import assets as q
from src.review_hub.queries import asset_links as alq

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


def _enrich(item: dict) -> dict:
    """Add asset_url and thumbnail_url from absolute paths."""
    fp = item.get("filepath")
    if fp:
        try:
            rel = Path(fp).relative_to(settings.assets_dir)
            item["asset_url"] = "/assets/" + rel.as_posix()
        except (ValueError, TypeError):
            item["asset_url"] = f"/assets/{item.get('filename', '')}"
    tp = item.get("thumbnail_path")
    if tp:
        item["thumbnail_url"] = "/thumbnails/" + Path(tp).relative_to(settings.thumbnails_dir).as_posix()
    return item


def _linked_to_asset(lnk: dict) -> dict | None:
    """Convert a media_asset_links join row into an asset-like dict."""
    try:
        media_url = None
        fp = lnk.get("filepath")
        if fp:
            try:
                media_url = "/media/" + Path(fp).relative_to(settings.media_dir).as_posix()
            except (ValueError, TypeError):
                media_url = f"/media/{lnk.get('filename', '')}"

        thumbnail_url = None
        tp = lnk.get("thumbnail_path")
        if tp:
            try:
                thumbnail_url = "/thumbnails/" + Path(tp).relative_to(settings.thumbnails_dir).as_posix()
            except (ValueError, TypeError):
                thumbnail_url = f"/thumbnails/{lnk.get('filename', '')}"

        return {
            "is_link": True,
            "link_id": lnk["link_id"],
            "media_id": lnk["media_id"],
            "filename": lnk.get("filename"),
            "mime_type": lnk.get("mime_type"),
            "file_size": lnk.get("file_size"),
            "width": lnk.get("width"),
            "height": lnk.get("height"),
            "directory": lnk.get("directory", ""),
            "created_at": lnk.get("linked_at"),
            "asset_url": media_url,
            "thumbnail_url": thumbnail_url,
        }
    except Exception:
        logger.warning("Failed to convert link to asset: %s", lnk, exc_info=True)
        return None


@router.get("/assets/directories")
async def list_asset_directories():
    db = await get_db()
    try:
        dirs = await q.get_directories(db)
        return {"directories": dirs}
    finally:
        await db.close()


@router.get("/assets")
async def list_assets(directory: str | None = None):
    db = await get_db()
    try:
        items = await q.list_assets(db, directory=directory)
        enriched = [_enrich(i) for i in items]
        # Merge linked media items into the response
        links = await alq.list_links_for_directory(db, directory or "")
        for lnk in links:
            item = _linked_to_asset(lnk)
            if item is not None:
                enriched.append(item)
        return {"items": enriched, "total": len(enriched)}
    finally:
        await db.close()


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: int):
    db = await get_db()
    try:
        item = await q.get_asset(db, asset_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return _enrich(item)
    finally:
        await db.close()


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: int):
    db = await get_db()
    try:
        item = await q.get_asset(db, asset_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        if item.get("filepath"):
            source = Path(item["filepath"])
            if source.is_file():
                source.unlink()
        if item.get("thumbnail_path"):
            thumb = Path(item["thumbnail_path"])
            if thumb.is_file():
                thumb.unlink()
        await q.delete_asset(db, asset_id)
        return {"ok": True}
    finally:
        await db.close()
