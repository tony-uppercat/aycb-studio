"""Routes for downloading media files (single + batch ZIP)."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import media as q

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class BatchBody(BaseModel):
    media_ids: list[int]


@router.get("/download/{media_id}")
async def download_file(media_id: int):
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

    return FileResponse(
        path=str(path),
        filename=item["filename"],
        media_type=item.get("mime_type", "application/octet-stream"),
    )


@router.post("/download/batch")
async def download_batch(body: BatchBody):
    db = await get_db()
    try:
        items = []
        for mid in body.media_ids:
            item = await q.get_media(db, mid)
            if item and item.get("filepath"):
                items.append(item)
    finally:
        await db.close()

    if not items:
        raise HTTPException(status_code=404, detail="No files found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in items:
            p = Path(item["filepath"])
            if p.is_file():
                zf.write(p, arcname=item["filename"])
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=media_batch.zip"},
        background=lambda: buf.close(),
    )
