"""Routes for user feedback (bugs, suggestions)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import feedback as q

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class FeedbackBody(BaseModel):
    message: str
    category: str = "bug"
    author: str | None = None
    urgent: bool = False


@router.get("/feedback")
async def list_feedback(urgent_only: bool = False):
    db = await get_db()
    try:
        items = await q.list_feedback(db, urgent_only=urgent_only)
        return {"items": items, "total": len(items)}
    finally:
        await db.close()


@router.post("/feedback")
async def add_feedback(body: FeedbackBody):
    db = await get_db()
    try:
        fid = await q.add_feedback(
            db,
            message=body.message,
            category=body.category,
            author=body.author,
            urgent=body.urgent,
        )
        return {"id": fid}
    finally:
        await db.close()
        from src.review_hub.app import sio
        await sio.emit("feedback_new", {"id": fid, "category": body.category, "urgent": body.urgent}, room="review")


@router.post("/feedback/{feedback_id}/resolve")
async def resolve_feedback(feedback_id: int):
    db = await get_db()
    try:
        await q.resolve_feedback(db, feedback_id)
        return {"ok": True}
    finally:
        await db.close()
