"""Bridge router — assets exchange between AYCB and Review Hub."""
from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from config.settings import settings
from src.shared import _log

router = APIRouter(prefix="/api/bridge", tags=["bridge"])


def _query_assets_sync(directory: str | None) -> list[dict]:
    db_path = settings.db_path
    if not db_path.exists():
        return []
    thumb_dir = settings.thumbnails_dir
    assets_dir = settings.assets_dir
    uri = db_path.as_uri() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        con.row_factory = sqlite3.Row
        if directory is not None:
            rows = con.execute(
                "SELECT * FROM assets WHERE directory=? ORDER BY filename ASC",
                (directory,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM assets ORDER BY directory ASC, filename ASC"
            ).fetchall()
        con.close()
        result = []
        for row in rows:
            item = dict(row)
            fp = item.get("filepath")
            if fp:
                try:
                    rel = Path(fp).relative_to(assets_dir)
                    item["asset_url"] = "/assets/" + rel.as_posix()
                except (ValueError, TypeError):
                    item["asset_url"] = f"/assets/{item.get('filename', '')}"
            tp = item.get("thumbnail_path")
            if tp:
                try:
                    rel_thumb = Path(tp).relative_to(thumb_dir)
                    item["thumbnail_url"] = "/thumbnails/" + rel_thumb.as_posix()
                except (ValueError, TypeError):
                    item["thumbnail_url"] = None
            else:
                item["thumbnail_url"] = None
            result.append(item)
        return result
    except Exception as e:
        _log(f"bridge_assets: DB query error: {e}")
        return []


def _fetch_asset_row_sync(asset_id: int) -> dict | None:
    db_path = settings.db_path
    if not db_path.exists():
        return None
    uri = db_path.as_uri() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT filepath, mime_type, thumbnail_path FROM assets WHERE id=?",
            (asset_id,),
        ).fetchone()
        con.close()
        return dict(row) if row else None
    except Exception as e:
        _log(f"bridge_assets: asset row lookup error: {e}")
        return None


@router.get("/assets")
async def list_bridge_assets(directory: str | None = None):
    """List all assets from the DB with enriched static URLs."""
    return await asyncio.to_thread(_query_assets_sync, directory)


@router.get("/assets/{asset_id}/image")
async def serve_asset_image(asset_id: int):
    """Serve an asset file by DB id."""
    row = await asyncio.to_thread(_fetch_asset_row_sync, asset_id)
    if not row or not row.get("filepath"):
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = Path(row["filepath"])
    base = settings.assets_dir.resolve()
    if not str(abs_path.resolve()).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(str(abs_path), media_type=row.get("mime_type") or "application/octet-stream")


@router.get("/assets/{asset_id}/thumbnail")
async def serve_asset_thumbnail(asset_id: int):
    """Serve the thumbnail for an asset."""
    row = await asyncio.to_thread(_fetch_asset_row_sync, asset_id)
    if not row or not row.get("thumbnail_path"):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    thumb_path = Path(row["thumbnail_path"])
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file not found on disk")
    return FileResponse(str(thumb_path), media_type="image/jpeg")
