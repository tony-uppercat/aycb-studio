"""Routes for asset items (shared/Assets/)."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import assets as q

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
        return {"items": [_enrich(i) for i in items], "total": len(items)}
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
