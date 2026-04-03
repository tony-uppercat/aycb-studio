"""Routes for folder management in shared/Media/."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import media as q

router = APIRouter(prefix="/api/rh", tags=["review-hub"])

MEDIA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "shared" / "Media"


class MoveBody(BaseModel):
    media_id: int
    target_dir: str


@router.get("/folders")
async def list_folders():
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    folders = sorted(
        d.name for d in MEDIA_DIR.iterdir() if d.is_dir()
    )
    return {"folders": folders}


@router.post("/folders/move")
async def move_media(body: MoveBody):
    db = await get_db()
    try:
        item = await q.get_media(db, body.media_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Media not found")

        src = Path(item["filepath"]) if item.get("filepath") else None
        if src is None or not src.is_file():
            raise HTTPException(status_code=404, detail="Source file not found on disk")

        dest_dir = MEDIA_DIR / body.target_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / item["filename"]

        shutil.move(str(src), str(dest))

        # Update DB record
        await db.execute(
            "UPDATE media SET filepath=?, directory=?, updated_at=datetime('now') WHERE id=?",
            (str(dest), body.target_dir, body.media_id),
        )
        await db.commit()

        return {"ok": True, "new_path": str(dest)}
    finally:
        await db.close()
