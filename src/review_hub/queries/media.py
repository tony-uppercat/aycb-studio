"""Query helpers for the media table."""
from __future__ import annotations

import aiosqlite

# ── helpers ──────────────────────────────────────────────────────────
def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)

def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


# ── queries ──────────────────────────────────────────────────────────
_ALLOWED_SORT = {"created_at", "updated_at", "filename", "file_size"}
_ALLOWED_ORDER = {"ASC", "DESC"}


async def list_media(
    db: aiosqlite.Connection,
    directory: str | None = None,
    sort: str = "created_at",
    order: str = "DESC",
) -> list[dict]:
    sort = sort if sort in _ALLOWED_SORT else "created_at"
    order = order.upper() if order.upper() in _ALLOWED_ORDER else "DESC"

    if directory is not None:
        sql = f"SELECT * FROM media WHERE directory=? ORDER BY {sort} {order}"
        cursor = await db.execute(sql, (directory,))
    else:
        sql = f"SELECT * FROM media ORDER BY {sort} {order}"
        cursor = await db.execute(sql)
    return _rows_to_list(await cursor.fetchall())


async def get_media(db: aiosqlite.Connection, media_id: int) -> dict | None:
    cursor = await db.execute("SELECT * FROM media WHERE id=?", (media_id,))
    return _row_to_dict(await cursor.fetchone())


async def insert_media(
    db: aiosqlite.Connection,
    *,
    filename: str,
    filepath: str | None = None,
    directory: str | None = None,
    file_size: int | None = None,
    mime_type: str | None = None,
    width: int | None = None,
    height: int | None = None,
    thumbnail_path: str | None = None,
    metadata: str | None = None,
) -> int:
    cursor = await db.execute(
        """INSERT INTO media
           (filename, filepath, directory, file_size, mime_type,
            width, height, thumbnail_path, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (filename, filepath, directory, file_size, mime_type,
         width, height, thumbnail_path, metadata),
    )
    await db.commit()
    return cursor.lastrowid


async def delete_media(db: aiosqlite.Connection, media_id: int) -> None:
    await db.execute("DELETE FROM media WHERE id=?", (media_id,))
    await db.commit()


async def get_directories(db: aiosqlite.Connection) -> list[str]:
    cursor = await db.execute(
        "SELECT DISTINCT directory FROM media"
        " WHERE directory IS NOT NULL AND directory != '.'"
        " ORDER BY directory"
    )
    rows = await cursor.fetchall()
    return [r[0] for r in rows]


async def get_stats(db: aiosqlite.Connection) -> dict:
    cursor = await db.execute("SELECT COUNT(*), SUM(file_size) FROM media")
    row = await cursor.fetchone()
    return {"count": row[0], "total_size": row[1]}
