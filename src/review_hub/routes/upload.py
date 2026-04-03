"""Routes for file uploads (media + references)."""
from __future__ import annotations

import mimetypes

from fastapi import APIRouter, UploadFile, File
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import media as mq
from src.review_hub.queries import references as rq

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


@router.post("/upload/media")
async def upload_media(file: UploadFile = File(...)):
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.media_dir / file.filename
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
    settings.references_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.references_dir / file.filename
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
