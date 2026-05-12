"""Bridge router — assets exchange between AYCB and Review Hub."""
from __future__ import annotations

import asyncio
import base64
import time
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from config.settings import settings
from src.review_hub.queries import bridge_ro
from src.shared import _log, _sanitize_filename

router = APIRouter(prefix="/api/bridge", tags=["bridge"])


def _query_assets_sync(directory: str | None) -> list[dict]:
    """Thin router-side alias — schema knowledge lives in bridge_ro."""
    return bridge_ro.list_assets_enriched(
        directory,
        assets_dir=settings.assets_dir,
        media_dir=settings.media_dir,
        thumbnails_dir=settings.thumbnails_dir,
    )


def _fetch_asset_row_sync(asset_id: int) -> dict | None:
    return bridge_ro.get_asset_row(asset_id)


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
