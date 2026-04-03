"""Tests for stale session cleanup."""
from tests.conftest import _run


def test_clear_stale_sessions(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.sessions import (
        add_session, get_active_sessions, clear_stale_sessions,
    )

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await add_session(db, "alice", "ipad", "sock-1")
            await add_session(db, "bob", "chrome", "sock-2")
            await add_session(db, "carol", "firefox", "sock-3")
            active = await get_active_sessions(db)
            assert len(active) == 3

            cleared = await clear_stale_sessions(db)
            assert cleared == 3

            active2 = await get_active_sessions(db)
            assert len(active2) == 0
        finally:
            await db.close()

    _run(go())


def test_clear_stale_sessions_ignores_ended(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.sessions import (
        add_session, end_session, get_active_sessions, clear_stale_sessions,
    )

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await add_session(db, "alice", "ipad", "sock-1")
            await add_session(db, "bob", "chrome", "sock-2")
            await end_session(db, "sock-1")

            cleared = await clear_stale_sessions(db)
            assert cleared == 1  # only sock-2 was still active

            active = await get_active_sessions(db)
            assert len(active) == 0
        finally:
            await db.close()

    _run(go())
