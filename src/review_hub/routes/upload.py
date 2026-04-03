"""Routes for file uploads (media + references)."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, UploadFile, File
from src.review_hub.db import get_db
from src.review_hub.queries import media as mq
from src.review_hub.queries import references as rq

router = APIRouter(prefix="/api/rh", tags=["review-hub"])

_SHARED = Path(__file__).resolve().parent.parent.parent.parent / "shared"
MEDIA_DIR = _SHARED / "Media"
REF_DIR = _SHARED / "References"


@router.post("/upload/media")
async def upload_media(file: UploadFile = File(...)):
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    dest = MEDIA_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)

    mime = file.content_type or mimetypes.guess_type(file.filename)[0]

    db = await get_db()
    try:
        await mq.insert_media(
            db,
            filename=file.filename,
            filepath=str(dest),
            directory=None,
            file_size=len(content),
            mime_type=mime,
        )
    finally:
        await db.close()

    return {"filename": file.filename, "path": str(dest)}


@router.post("/upload/reference")
async def upload_reference(file: UploadFile = File(...)):
    REF_DIR.mkdir(parents=True, exist_ok=True)
    dest = REF_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)

    db = await get_db()
    try:
        new_id = await rq.add_reference(
            db,
            filename=file.filename,
            original_path=str(dest),
            file_size=len(content),
        )
    finally:
        await db.close()

    return {"filename": file.filename, "id": new_id}
