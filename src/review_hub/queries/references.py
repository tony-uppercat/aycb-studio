"""Query helpers for the [references] table.

NOTE: 'references' is a SQLite reserved word — always use [references] in SQL.
"""
from __future__ import annotations

import aiosqlite


from ._helpers import _row_to_dict, _rows_to_list


async def list_references(
    db: aiosqlite.Connection,
    search: str | None = None,
    tag: str | None = None,
) -> list[dict]:
    clauses: list[str] = []
    params: list[str] = []

    if search is not None:
        clauses.append("filename LIKE ?")
        params.append(f"%{search}%")
    if tag is not None:
        clauses.append("tags LIKE ?")
        params.append(f"%{tag}%")

    where = ""
    if clauses:
        where = "WHERE " + " AND ".join(clauses)

    cursor = await db.execute(
        f"SELECT * FROM [references] {where} ORDER BY created_at DESC",
        params,
    )
    return _rows_to_list(await cursor.fetchall())


async def add_reference(
    db: aiosqlite.Connection,
    *,
    filename: str,
    original_path: str | None = None,
    processed_path: str | None = None,
    thumbnail_path: str | None = None,
    uploaded_by: str | None = None,
    tags: str | None = None,
    notes: str | None = None,
    file_size: int | None = None,
    width: int | None = None,
    height: int | None = None,
) -> int:
    cursor = await db.execute(
        """INSERT INTO [references]
           (filename, original_path, processed_path, thumbnail_path,
            uploaded_by, tags, notes, file_size, width, height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (filename, original_path, processed_path, thumbnail_path,
         uploaded_by, tags, notes, file_size, width, height),
    )
    await db.commit()
    return cursor.lastrowid


async def delete_reference(
    db: aiosqlite.Connection, ref_id: int
) -> None:
    await db.execute("DELETE FROM [references] WHERE id=?", (ref_id,))
    await db.commit()
