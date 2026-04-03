"""Review Hub database — aiosqlite connection + schema init."""
from __future__ import annotations

import aiosqlite
from pathlib import Path

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "data" / "review-hub.db"
_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

async def get_db() -> aiosqlite.Connection:
    """Open a connection with WAL mode and foreign keys enabled."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(_DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db

async def init_db() -> None:
    """Create tables if they don't exist."""
    schema = _SCHEMA_PATH.read_text(encoding="utf-8")
    db = await get_db()
    try:
        await db.executescript(schema)
        await db.commit()
    finally:
        await db.close()
