"""Routes for file uploads (media + references)."""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import re
from pathlib import Path
from typing import IO, Optional

from fastapi import APIRouter, UploadFile, File, Form
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import media as mq
from src.review_hub.queries import references as rq
from src.review_hub.thumbnails import generate_reference_thumbnail, get_image_dimensions
from src.shared import _sanitize_filename

_log = logging.getLogger("aycb.upload")

router = APIRouter(prefix="/api/rh", tags=["review-hub"])

_CHUNK_SIZE = 1_048_576  # 1 MB — RAM ceiling per upload regardless of body size


def _stream_to_disk(source: IO[bytes], dest: Path) -> int:
    """Copy ``source`` to ``dest`` in 1 MB chunks. Returns bytes written.

    Replaces the prior ``await file.read()`` + ``dest.write_bytes()``
    pattern which allocated the full upload in RAM (up to 500 MB per
    the app-wide limit). Runs in a thread via ``asyncio.to_thread``
    so the event loop is never blocked.
    """
    total = 0
    with open(dest, "wb") as fh:
        while chunk := source.read(_CHUNK_SIZE):
            fh.write(chunk)
            total += len(chunk)
    return total


async def _save_upload(file: UploadFile, dest: Path) -> int:
    """Rewind and stream the UploadFile body to disk."""
    await file.seek(0)
    return await asyncio.to_thread(_stream_to_disk, file.file, dest)


@router.post("/upload/media")
async def upload_media(file: UploadFile = File(...)):
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _sanitize_filename(file.filename)
    dest = settings.media_dir / safe_name
    total = await _save_upload(file, dest)

    mime = file.content_type or mimetypes.guess_type(safe_name)[0]

    db = await get_db()
    try:
        await mq.insert_media(
            db,
            filename=safe_name,
            filepath=str(dest),
            directory=None,
            file_size=total,
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
    total = await _save_upload(file, dest)

    stored_filename = f"{safe_dir}/{safe_name}" if safe_dir else safe_name

    # Capture dimensions and generate thumbnail
    width, height = None, None
    thumbnail_path = None
    try:
        width, height = get_image_dimensions(dest)
    except Exception as exc:
        _log.warning("Failed to read dimensions for %s: %s", dest.name, exc)

    # Single DB connection for both the INSERT and the thumbnail UPDATE —
    # previously these ran on two separate connections, so a crash between
    # them could leave the reference row in the DB with no thumbnail
    # pointer and no record of the intended thumbnail path.
    db = await get_db()
    try:
        new_id = await rq.add_reference(
            db,
            filename=stored_filename,
            original_path=str(dest),
            file_size=total,
            width=width,
            height=height,
        )
        try:
            thumbnail_path = generate_reference_thumbnail(dest, new_id)
            await db.execute(
                "UPDATE [references] SET thumbnail_path=? WHERE id=?",
                (thumbnail_path, new_id),
            )
        except Exception as exc:
            _log.warning("Failed to generate reference thumbnail for %s: %s", dest.name, exc)
        await db.commit()
    finally:
        await db.close()

    return {"filename": stored_filename, "id": new_id}
