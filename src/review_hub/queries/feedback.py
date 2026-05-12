"""Query helpers for the feedback table."""
from __future__ import annotations

import aiosqlite


from ._helpers import _row_to_dict, _rows_to_list


async def list_feedback(
    db: aiosqlite.Connection, urgent_only: bool = False
) -> list[dict]:
    if urgent_only:
        sql = "SELECT * FROM feedback WHERE urgent=1 ORDER BY created_at DESC"
    else:
        sql = "SELECT * FROM feedback ORDER BY created_at DESC"
    cursor = await db.execute(sql)
    return _rows_to_list(await cursor.fetchall())


async def add_feedback(
    db: aiosqlite.Connection,
    *,
    message: str,
    category: str = "bug",
    author: str | None = None,
    urgent: bool = False,
) -> int:
    cursor = await db.execute(
        """INSERT INTO feedback (message, category, author, urgent)
           VALUES (?, ?, ?, ?)""",
        (message, category, author, int(urgent)),
    )
    await db.commit()
    return cursor.lastrowid


async def resolve_feedback(
    db: aiosqlite.Connection, feedback_id: int
) -> None:
    await db.execute(
        "UPDATE feedback SET resolved=1 WHERE id=?", (feedback_id,)
    )
    await db.commit()
