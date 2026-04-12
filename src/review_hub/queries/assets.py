"""Query helpers for the assets table."""
from __future__ import annotations

import aiosqlite


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)

def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


_ALLOWED_SORT = {"created_at", "updated_at", "filename", "file_size"}
_ALLOWED_ORDER = {"ASC", "DESC"}


async def list_assets(
    db: aiosqlite.Connection,
    directory: str | None = None,
    sort: str = "filename",
    order: str = "ASC",
) -> list[dict]:
    sort = sort if sort in _ALLOWED_SORT else "filename"
    order = order.upper() if order.upper() in _ALLOWED_ORDER else "ASC"
    if directory is not None:
        sql = f"SELECT * FROM assets WHERE directory=? ORDER BY {sort} {order}"
        cursor = await db.execute(sql, (directory,))
    else:
        sql = f"SELECT * FROM assets ORDER BY {sort} {order}"
        cursor = await db.execute(sql)
    return _rows_to_list(await cursor.fetchall())


async def get_asset(db: aiosqlite.Connection, asset_id: int) -> dict | None:
    cursor = await db.execute("SELECT * FROM assets WHERE id=?", (asset_id,))
    return _row_to_dict(await cursor.fetchone())


async def insert_asset(
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
) -> int:
    cursor = await db.execute(
        """INSERT INTO assets
           (filename, filepath, directory, file_size, mime_type, width, height, thumbnail_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (filename, filepath, directory, file_size, mime_type, width, height, thumbnail_path),
    )
    await db.commit()
    return cursor.lastrowid


async def delete_asset(db: aiosqlite.Connection, asset_id: int) -> None:
    await db.execute("DELETE FROM assets WHERE id=?", (asset_id,))
    await db.commit()


async def get_directories(db: aiosqlite.Connection) -> list[str]:
    cursor = await db.execute(
        "SELECT DISTINCT directory FROM assets"
        " WHERE directory IS NOT NULL"
        " ORDER BY directory"
    )
    rows = await cursor.fetchall()
    return [r[0] for r in rows]
