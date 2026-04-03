"""Query helpers for the comments table."""
from __future__ import annotations

import aiosqlite


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)

def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


async def list_comments(
    db: aiosqlite.Connection, media_id: int
) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM comments WHERE media_id=? ORDER BY created_at",
        (media_id,),
    )
    return _rows_to_list(await cursor.fetchall())


async def add_comment(
    db: aiosqlite.Connection,
    *,
    media_id: int,
    author: str | None = None,
    content: str | None = None,
    x_position: float | None = None,
    y_position: float | None = None,
    annotation_type: str = "pin",
    box_width: float | None = None,
    box_height: float | None = None,
    parent_id: int | None = None,
) -> int:
    cursor = await db.execute(
        """INSERT INTO comments
           (media_id, author, content, x_position, y_position,
            annotation_type, box_width, box_height, parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (media_id, author, content, x_position, y_position,
         annotation_type, box_width, box_height, parent_id),
    )
    await db.commit()
    return cursor.lastrowid


async def delete_comment(db: aiosqlite.Connection, comment_id: int) -> None:
    await db.execute("DELETE FROM comments WHERE id=?", (comment_id,))
    await db.commit()
