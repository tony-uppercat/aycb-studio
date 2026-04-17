"""Bridge router — assets exchange between AYCB and Review Hub."""
from __future__ import annotations

import asyncio
import base64
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from config.settings import settings
from src.review_hub.db import _DB_PATH
from src.shared import _log, _sanitize_filename

router = APIRouter(prefix="/api/bridge", tags=["bridge"])


def _query_assets_sync(directory: str | None) -> list[dict]:
    db_path = _DB_PATH
    if not db_path.exists():
        return []
    thumb_dir = settings.thumbnails_dir
    assets_dir = settings.assets_dir
    media_dir = settings.media_dir
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

        # Merge linked media items from media_asset_links
        if directory is not None:
            link_rows = con.execute(
                """SELECT l.id AS link_id, l.media_id, l.directory,
                          m.filename, m.filepath, m.thumbnail_path, m.mime_type,
                          m.file_size, m.width, m.height
                   FROM media_asset_links l
                   JOIN media m ON m.id = l.media_id
                   WHERE l.directory = ?
                   ORDER BY l.created_at DESC""",
                (directory,),
            ).fetchall()
        else:
            link_rows = con.execute(
                """SELECT l.id AS link_id, l.media_id, l.directory,
                          m.filename, m.filepath, m.thumbnail_path, m.mime_type,
                          m.file_size, m.width, m.height
                   FROM media_asset_links l
                   JOIN media m ON m.id = l.media_id
                   ORDER BY l.created_at DESC""",
            ).fetchall()
        for lr in link_rows:
            lnk = dict(lr)
            media_url = None
            fp = lnk.get("filepath")
            if fp:
                try:
                    media_url = "/media/" + Path(fp).relative_to(media_dir).as_posix()
                except (ValueError, TypeError):
                    media_url = f"/media/{lnk.get('filename', '')}"
            thumb_url = None
            tp = lnk.get("thumbnail_path")
            if tp:
                try:
                    thumb_url = "/thumbnails/" + Path(tp).relative_to(thumb_dir).as_posix()
                except (ValueError, TypeError):
                    pass
            result.append({
                "id": lnk["link_id"],
                "filename": lnk["filename"],
                "directory": lnk["directory"],
                "file_size": lnk.get("file_size"),
                "mime_type": lnk.get("mime_type"),
                "width": lnk.get("width"),
                "height": lnk.get("height"),
                "asset_url": media_url,
                "thumbnail_url": thumb_url,
                "is_link": True,
                "media_id": lnk["media_id"],
                "link_id": lnk["link_id"],
            })

        con.close()
        return result
    except Exception as e:
        _log(f"bridge_assets: DB query error: {e}")
        return []


def _fetch_asset_row_sync(asset_id: int) -> dict | None:
    db_path = _DB_PATH
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


@router.post("/assets")
async def save_bridge_asset(
    image_file: UploadFile = File(None),
    image_b64: str = Form(None),
    directory: str = Form(""),
    filename: str = Form(""),
):
    """Save an image from the canvas into shared/Assets/."""
    try:
        if image_file and image_file.size:
            img_bytes = await image_file.read()
        elif image_b64:
            b64_data = image_b64.split(",", 1)[-1] if "," in image_b64 else image_b64
            img_bytes = base64.b64decode(b64_data)
        else:
            return {"status": "error", "detail": "No image provided"}

        # Resolve target directory
        folder = _sanitize_filename(directory.strip())[:80] if directory.strip() else ""
        target_dir = settings.assets_dir / folder if folder else settings.assets_dir
        target_dir.mkdir(parents=True, exist_ok=True)

        # Determine filename
        if filename.strip():
            safe_name = _sanitize_filename(filename.strip())[:120]
            if not safe_name.lower().endswith('.png'):
                safe_name += '.png'
        else:
            safe_name = f"asset_{int(time.time() * 1000)}.png"
        img_path = target_dir / safe_name

        # Avoid overwrite
        if img_path.exists():
            stem = img_path.stem
            ext = img_path.suffix
            img_path = target_dir / f"{stem}_{int(time.time() * 1000)}{ext}"

        img_path.write_bytes(img_bytes)
        _log(f"Asset saved: {img_path.name} -> {folder or 'root'}")
        return {"status": "ok", "path": str(img_path.name), "directory": folder or None}
    except Exception as e:
        _log(f"bridge_assets save error: {e}")
        return {"status": "error", "detail": str(e)}


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
