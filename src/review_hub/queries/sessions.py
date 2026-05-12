"""Query helpers for the sessions table."""
from __future__ import annotations

import aiosqlite


from ._helpers import _row_to_dict, _rows_to_list


async def add_session(
    db: aiosqlite.Connection,
    user_name: str,
    device: str,
    socket_id: str,
) -> int:
    cursor = await db.execute(
        """INSERT INTO sessions (user_name, device, socket_id)
           VALUES (?, ?, ?)""",
        (user_name, device, socket_id),
    )
    await db.commit()
    return cursor.lastrowid


async def end_session(
    db: aiosqlite.Connection, socket_id: str
) -> None:
    await db.execute(
        """UPDATE sessions
           SET disconnected_at = datetime('now')
           WHERE socket_id=? AND disconnected_at IS NULL""",
        (socket_id,),
    )
    await db.commit()


async def clear_stale_sessions(db: aiosqlite.Connection) -> int:
    """Mark all active sessions as disconnected (call on server startup)."""
    cursor = await db.execute(
        """UPDATE sessions SET disconnected_at = datetime('now')
           WHERE disconnected_at IS NULL"""
    )
    await db.commit()
    return cursor.rowcount


async def get_active_sessions(
    db: aiosqlite.Connection,
) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM sessions WHERE disconnected_at IS NULL"
    )
    return _rows_to_list(await cursor.fetchall())
