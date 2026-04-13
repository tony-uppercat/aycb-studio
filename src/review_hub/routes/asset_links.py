"""Routes for media-to-asset linking."""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from src.review_hub.db import get_db
from src.review_hub.queries import asset_links as q
from src.review_hub.queries import media as mq

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class LinkBody(BaseModel):
    media_id: int
    directory: str = ""


@router.post("/assets/link")
async def create_asset_link(body: LinkBody):
    db = await get_db()
    try:
        media = await mq.get_media(db, body.media_id)
        if media is None:
            raise HTTPException(status_code=404, detail="Media not found")
        link = await q.create_link(
            db, media_id=body.media_id, directory=body.directory
        )
        return {"status": "ok", "id": link["id"], "link": link}
    finally:
        await db.close()


@router.delete("/assets/link/{link_id}")
async def delete_asset_link(link_id: int):
    db = await get_db()
    try:
        deleted = await q.delete_link(db, link_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Link not found")
        return {"status": "ok"}
    finally:
        await db.close()
