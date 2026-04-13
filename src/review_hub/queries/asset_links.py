"""Query helpers for the media_asset_links table."""
from __future__ import annotations

import logging

import aiosqlite

logger = logging.getLogger(__name__)


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)


def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


async def create_link(
    db: aiosqlite.Connection,
    *,
    media_id: int,
    directory: str,
) -> dict:
    """Create a link or return existing if duplicate."""
    try:
        await db.execute(
            "INSERT INTO media_asset_links (media_id, directory) VALUES (?, ?)",
            (media_id, directory),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        logger.debug("Duplicate link media_id=%d directory=%s — returning existing", media_id, directory)
    cursor = await db.execute(
        "SELECT * FROM media_asset_links WHERE media_id=? AND directory=?",
        (media_id, directory),
    )
    return _row_to_dict(await cursor.fetchone())


async def delete_link(db: aiosqlite.Connection, link_id: int) -> bool:
    """Delete a link by id. Returns True if deleted."""
    cursor = await db.execute(
        "DELETE FROM media_asset_links WHERE id=?", (link_id,)
    )
    await db.commit()
    return cursor.rowcount > 0


async def list_links_for_directory(
    db: aiosqlite.Connection, directory: str
) -> list[dict]:
    """List all links in a directory, joined with media fields."""
    cursor = await db.execute(
        """SELECT l.id AS link_id, l.media_id, l.directory, l.created_at AS linked_at,
                  m.filename, m.filepath, m.thumbnail_path, m.mime_type,
                  m.file_size, m.width, m.height
           FROM media_asset_links l
           JOIN media m ON m.id = l.media_id
           WHERE l.directory = ?
           ORDER BY l.created_at DESC""",
        (directory,),
    )
    return _rows_to_list(await cursor.fetchall())
