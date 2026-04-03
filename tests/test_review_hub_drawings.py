"""Tests for drawings query module — save, upsert, get."""
from tests.conftest import _run


def test_save_and_get_drawing(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media
    from src.review_hub.queries.drawings import save_drawing, get_drawing

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            mid = await insert_media(db, filename="draw_test.png")
            did = await save_drawing(
                db, media_id=mid, author="alice",
                strokes_json='[{"x":0,"y":0}]', thumbnail_data="base64data"
            )
            assert isinstance(did, int)

            drawing = await get_drawing(db, mid)
            assert drawing is not None
            assert drawing["author"] == "alice"
            assert drawing["strokes_json"] == '[{"x":0,"y":0}]'
        finally:
            await db.close()

    _run(go())


def test_save_drawing_upserts(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media
    from src.review_hub.queries.drawings import save_drawing, get_drawing

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            mid = await insert_media(db, filename="upsert_test.png")
            id1 = await save_drawing(
                db, media_id=mid, author="bob",
                strokes_json="v1", thumbnail_data=None
            )
            id2 = await save_drawing(
                db, media_id=mid, author="bob",
                strokes_json="v2", thumbnail_data=None
            )
            # Same author + media = update, not insert
            assert id1 == id2

            drawing = await get_drawing(db, mid)
            assert drawing["strokes_json"] == "v2"
        finally:
            await db.close()

    _run(go())


def test_get_drawing_nonexistent(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.drawings import get_drawing

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            assert await get_drawing(db, 9999) is None
        finally:
            await db.close()

    _run(go())
