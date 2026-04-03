"""Routes for drawings / annotations overlay."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import drawings as q

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
        return drawing
    finally:
        await db.close()


@router.post("/drawings")
async def save_drawing(body: DrawingBody):
    db = await get_db()
    try:
        new_id = await q.save_drawing(
            db,
            media_id=body.media_id,
            author=body.author,
            strokes_json=body.strokes_json,
            thumbnail_data=body.thumbnail_data,
        )
        return {"id": new_id}
    finally:
        await db.close()
