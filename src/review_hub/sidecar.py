"""Write .review.json sidecar next to media files."""
from __future__ import annotations

import json
from pathlib import Path
from src.review_hub.db import get_db
from src.review_hub.queries.favorites import get_favorites
from src.review_hub.queries.comments import list_comments

async def write_sidecar(media_id: int, filepath: str) -> None:
    """Write review data as JSON sidecar."""
    p = Path(filepath)
    if not p.exists():
        return
    sidecar_path = p.with_suffix(p.suffix + ".review.json")
    db = await get_db()
    try:
        favs = await get_favorites(db, media_id)
        comments = await list_comments(db, media_id)
        status = None
        reviewed_by = None
        for f in favs:
            if f["status"] in ("approved", "rejected"):
                status = f["status"]
                reviewed_by = f["user_name"]
                break
        data = {
            "status": status,
            "reviewed_by": reviewed_by,
            "favorite": any(f["status"] == "favorite" for f in favs),
            "comments_count": len(comments),
        }
        sidecar_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    finally:
        await db.close()
