"""Tests for review_hub query modules."""
import asyncio
import pytest
from pathlib import Path


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    return tmp_path / "test.db"


def _run(coro):
    return asyncio.run(coro)


# ── 1. media insert + list ──────────────────────────────────────────
def test_insert_and_list_media(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, list_media

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            mid = await insert_media(db, filename="hero.png", directory="shots")
            assert isinstance(mid, int)
            rows = await list_media(db)
            assert len(rows) == 1
            assert rows[0]["filename"] == "hero.png"
            assert rows[0]["directory"] == "shots"
        finally:
            await db.close()

    _run(go())


# ── 2. comments on media ────────────────────────────────────────────
def test_add_and_list_comments(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media
    from src.review_hub.queries.comments import add_comment, list_comments

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            mid = await insert_media(db, filename="bg.jpg")
            cid = await add_comment(
                db, media_id=mid, author="alice", content="looks great"
            )
            assert isinstance(cid, int)
            comments = await list_comments(db, mid)
            assert len(comments) == 1
            assert comments[0]["author"] == "alice"
            assert comments[0]["content"] == "looks great"
        finally:
            await db.close()

    _run(go())


# ── 3. cascade delete: media -> comments ─────────────────────────────
def test_delete_media_cascades_comments(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, delete_media
    from src.review_hub.queries.comments import add_comment, list_comments

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            mid = await insert_media(db, filename="temp.png")
            await add_comment(db, media_id=mid, author="bob", content="delete me")
            # Verify comment exists
            assert len(await list_comments(db, mid)) == 1
            # Delete media
            await delete_media(db, mid)
            # Comment should be gone
            assert len(await list_comments(db, mid)) == 0
        finally:
            await db.close()

    _run(go())


# ── 4. toggle favorite + get ────────────────────────────────────────
def test_toggle_and_get_favorites(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media
    from src.review_hub.queries.favorites import toggle_favorite, get_favorites

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            mid = await insert_media(db, filename="fav.png")
            row = await toggle_favorite(db, media_id=mid, user_name="carol")
            assert row is not None
            assert row["status"] == "favorite"
            favs = await get_favorites(db, mid)
            assert len(favs) == 1
            assert favs[0]["user_name"] == "carol"
        finally:
            await db.close()

    _run(go())


# ── 5. references (bracket syntax) ──────────────────────────────────
def test_insert_and_list_references(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.references import add_reference, list_references

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            rid = await add_reference(
                db, filename="ref_board.png", tags="concept,mood"
            )
            assert isinstance(rid, int)
            refs = await list_references(db)
            assert len(refs) == 1
            assert refs[0]["filename"] == "ref_board.png"
            # search by tag
            refs_tag = await list_references(db, tag="concept")
            assert len(refs_tag) == 1
            # search with no match
            refs_none = await list_references(db, tag="zzz_no_match")
            assert len(refs_none) == 0
        finally:
            await db.close()

    _run(go())


# ── 6. feedback ──────────────────────────────────────────────────────
def test_add_and_list_feedback(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.feedback import add_feedback, list_feedback

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            fid = await add_feedback(
                db, message="button broken", category="bug", urgent=True
            )
            assert isinstance(fid, int)
            all_fb = await list_feedback(db)
            assert len(all_fb) == 1
            assert all_fb[0]["message"] == "button broken"
            urgent = await list_feedback(db, urgent_only=True)
            assert len(urgent) == 1
        finally:
            await db.close()

    _run(go())


# ── 7. sessions ──────────────────────────────────────────────────────
def test_sessions_lifecycle(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.sessions import (
        add_session, end_session, get_active_sessions
    )

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            sid = await add_session(db, "dave", "chrome", "sock-123")
            assert isinstance(sid, int)
            active = await get_active_sessions(db)
            assert len(active) == 1
            assert active[0]["socket_id"] == "sock-123"
            # end session
            await end_session(db, "sock-123")
            active2 = await get_active_sessions(db)
            assert len(active2) == 0
        finally:
            await db.close()

    _run(go())
