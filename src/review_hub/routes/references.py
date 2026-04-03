"""Routes for reference images."""
from __future__ import annotations

from fastapi import APIRouter
from src.review_hub.db import get_db
from src.review_hub.queries import references as q

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


@router.get("/references")
async def list_references(search: str | None = None, tag: str | None = None):
    db = await get_db()
    try:
        items = await q.list_references(db, search=search, tag=tag)
        return {"items": items}
    finally:
        await db.close()


@router.delete("/references/{ref_id}")
async def delete_reference(ref_id: int):
    db = await get_db()
    try:
        await q.delete_reference(db, ref_id)
        return {"ok": True}
    finally:
        await db.close()
