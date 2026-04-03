"""Routes for favorites / approval status."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import favorites as q

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class ToggleBody(BaseModel):
    media_id: int
    user_name: str
    status: str = "favorite"


@router.post("/favorites/toggle")
async def toggle_favorite(body: ToggleBody):
    db = await get_db()
    try:
        row = await q.toggle_favorite(
            db,
            media_id=body.media_id,
            user_name=body.user_name,
            status=body.status,
        )
        return row
    finally:
        await db.close()


@router.get("/favorites/{media_id}")
async def get_favorites(media_id: int):
    db = await get_db()
    try:
        rows = await q.get_favorites(db, media_id)
        return {"favorites": rows}
    finally:
        await db.close()
