"""Routes for file uploads (media + references)."""
from __future__ import annotations

import logging
import mimetypes
import re

from fastapi import APIRouter, UploadFile, File, Form
from typing import Optional
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import media as mq
from src.review_hub.queries import references as rq
from src.review_hub.thumbnails import generate_reference_thumbnail, get_image_dimensions
from src.shared import _sanitize_filename

_log = logging.getLogger("aycb.upload")

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


@router.post("/upload/media")
async def upload_media(file: UploadFile = File(...)):
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _sanitize_filename(file.filename)
    dest = settings.media_dir / safe_name
    content = await file.read()
    dest.write_bytes(content)

    mime = file.content_type or mimetypes.guess_type(safe_name)[0]

    db = await get_db()
    try:
        await mq.insert_media(
            db,
            filename=safe_name,
            filepath=str(dest),
            directory=None,
            file_size=len(content),
            mime_type=mime,
        )
    finally:
        await db.close()

    return {"filename": safe_name, "path": str(dest)}


@router.post("/upload/reference")
async def upload_reference(
    file: UploadFile = File(...),
    directory: Optional[str] = Form(None),
):
    # Sanitize directory: allow only alphanumeric, dash, underscore, space
    safe_dir: str | None = None
    if directory:
        safe_dir = re.sub(r"[^\w\s\-]", "", directory).strip() or None

    save_dir = settings.references_dir / safe_dir if safe_dir else settings.references_dir
    save_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _sanitize_filename(file.filename)
    dest = save_dir / safe_name
    content = await file.read()
    dest.write_bytes(content)

    stored_filename = f"{safe_dir}/{safe_name}" if safe_dir else safe_name

    # Capture dimensions and generate thumbnail
    width, height = None, None
    thumbnail_path = None
    try:
        width, height = get_image_dimensions(dest)
    except Exception as exc:
        _log.warning("Failed to read dimensions for %s: %s", dest.name, exc)

    db = await get_db()
    try:
        new_id = await rq.add_reference(
            db,
            filename=stored_filename,
            original_path=str(dest),
            file_size=len(content),
            width=width,
            height=height,
        )
    finally:
        await db.close()

    try:
        thumbnail_path = generate_reference_thumbnail(dest, new_id)
        db2 = await get_db()
        try:
            await db2.execute(
                "UPDATE [references] SET thumbnail_path=? WHERE id=?",
                (thumbnail_path, new_id),
            )
            await db2.commit()
        finally:
            await db2.close()
    except Exception as exc:
        _log.warning("Failed to generate reference thumbnail for %s: %s", dest.name, exc)

    return {"filename": stored_filename, "id": new_id}
