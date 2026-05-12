"""Routes for comments / annotations."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.review_hub.db import get_db
from src.review_hub.queries import comments as q
from src.review_hub.queries import media as mq

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class CommentBody(BaseModel):
    media_id: int
    author: str
    content: str
    x_position: float | None = None
    y_position: float | None = None
    annotation_type: str = "pin"
    box_width: float | None = None
    box_height: float | None = None
    parent_id: int | None = None


@router.get("/comments/{media_id}")
async def list_comments(media_id: int):
    db = await get_db()
    try:
        rows = await q.list_comments(db, media_id)
        return {"comments": rows}
    finally:
        await db.close()


@router.post("/comments")
async def add_comment(body: CommentBody):
    db = await get_db()
    try:
        item = await mq.get_media(db, body.media_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Media not found")
        new_id = await q.add_comment(
            db,
            media_id=body.media_id,
            author=body.author,
            content=body.content,
            x_position=body.x_position,
            y_position=body.y_position,
            annotation_type=body.annotation_type,
            box_width=body.box_width,
            box_height=body.box_height,
            parent_id=body.parent_id,
        )
    finally:
        await db.close()
    comment_data = {
        "id": new_id,
        "media_id": body.media_id,
        "author": body.author,
        "content": body.content,
        "x_position": body.x_position,
        "y_position": body.y_position,
        "annotation_type": body.annotation_type,
        "parent_id": body.parent_id,
    }
    from src.review_hub.app import sio
    try:
        await sio.emit("comment_new", comment_data, room="review")
    except Exception as e:
        from src.shared import _log
        _log(f"Socket emit comment_new failed: {e}")
    return {"id": new_id}


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: int):
    db = await get_db()
    try:
        await q.delete_comment(db, comment_id)
    finally:
        await db.close()
    from src.review_hub.app import sio
    try:
        await sio.emit("comment_delete", {"id": comment_id}, room="review")
    except Exception as e:
        from src.shared import _log
        _log(f"Socket emit comment_delete failed: {e}")
    return {"ok": True}
