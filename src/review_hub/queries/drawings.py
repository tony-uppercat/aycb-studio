"""Query helpers for the drawings table."""
from __future__ import annotations

import aiosqlite


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)


async def get_drawing(
    db: aiosqlite.Connection, media_id: int
) -> dict | None:
    cursor = await db.execute(
        "SELECT * FROM drawings WHERE media_id=? ORDER BY updated_at DESC LIMIT 1",
        (media_id,),
    )
    return _row_to_dict(await cursor.fetchone())


async def save_drawing(
    db: aiosqlite.Connection,
    *,
    media_id: int,
    author: str | None = None,
    strokes_json: str | None = None,
    thumbnail_data: str | None = None,
) -> int:
    # Check for an existing drawing by this author on this media
    cursor = await db.execute(
        "SELECT id FROM drawings WHERE media_id=? AND author IS ?",
        (media_id, author),
    )
    existing = await cursor.fetchone()

    if existing:
        await db.execute(
            """UPDATE drawings
               SET strokes_json=?, thumbnail_data=?, updated_at=datetime('now')
               WHERE id=?""",
            (strokes_json, thumbnail_data, existing[0]),
        )
        await db.commit()
        return existing[0]

    cursor = await db.execute(
        """INSERT INTO drawings (media_id, author, strokes_json, thumbnail_data)
           VALUES (?, ?, ?, ?)""",
        (media_id, author, strokes_json, thumbnail_data),
    )
    await db.commit()
    return cursor.lastrowid
