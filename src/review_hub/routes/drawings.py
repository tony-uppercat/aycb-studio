"""Routes for drawings / annotations overlay."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import drawings as q
from src.review_hub.queries import media as mq

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class DrawingBody(BaseModel):
    media_id: int
    author: str
    strokes_json: str
    thumbnail_data: str | None = None


@router.get("/drawings/{media_id}")
async def get_drawing(media_id: int):
    db = await get_db()
    try:
        drawing = await q.get_drawing(db, media_id)
        return {"drawing": drawing}
    finally:
        await db.close()


@router.post("/drawings")
async def save_drawing(body: DrawingBody):
    db = await get_db()
    try:
        item = await mq.get_media(db, body.media_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Media not found")
        new_id = await q.save_drawing(
            db,
            media_id=body.media_id,
            author=body.author,
            strokes_json=body.strokes_json,
            thumbnail_data=body.thumbnail_data,
        )
    finally:
        await db.close()
    from src.review_hub.app import sio
    try:
        await sio.emit("drawing_save", {"media_id": body.media_id, "author": body.author}, room="review")
    except Exception as e:
        from src.shared import _log
        _log(f"Socket emit drawing_save failed: {e}")
    return {"id": new_id}
