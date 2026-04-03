"""Query helpers for the favorites table."""
from __future__ import annotations

import aiosqlite


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)

def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


async def toggle_favorite(
    db: aiosqlite.Connection,
    *,
    media_id: int,
    user_name: str,
    status: str = "favorite",
) -> dict:
    await db.execute(
        """INSERT OR REPLACE INTO favorites (media_id, user_name, status)
           VALUES (?, ?, ?)""",
        (media_id, user_name, status),
    )
    await db.commit()
    cursor = await db.execute(
        "SELECT * FROM favorites WHERE media_id=? AND user_name=?",
        (media_id, user_name),
    )
    return _row_to_dict(await cursor.fetchone())


async def get_favorites(
    db: aiosqlite.Connection, media_id: int
) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM favorites WHERE media_id=?", (media_id,)
    )
    return _rows_to_list(await cursor.fetchall())


