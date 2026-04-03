"""Tests for media query module — sort, order, directories, stats."""
from tests.conftest import _run


def test_list_media_with_directory_filter(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, list_media

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await insert_media(db, filename="a.png", directory="ProjectA")
            await insert_media(db, filename="b.png", directory="ProjectA")
            await insert_media(db, filename="c.png", directory="ProjectB")

            all_items = await list_media(db)
            assert len(all_items) == 3

            project_a = await list_media(db, directory="ProjectA")
            assert len(project_a) == 2

            project_b = await list_media(db, directory="ProjectB")
            assert len(project_b) == 1
        finally:
            await db.close()

    _run(go())


def test_list_media_sort_order(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, list_media

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await insert_media(db, filename="zebra.png")
            await insert_media(db, filename="alpha.png")

            asc = await list_media(db, sort="filename", order="ASC")
            assert asc[0]["filename"] == "alpha.png"
            assert asc[1]["filename"] == "zebra.png"

            desc = await list_media(db, sort="filename", order="DESC")
            assert desc[0]["filename"] == "zebra.png"
        finally:
            await db.close()

    _run(go())


def test_list_media_rejects_bad_sort(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, list_media

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await insert_media(db, filename="safe.png")
            # SQL injection attempt in sort param — should fallback to created_at
            items = await list_media(db, sort="id; DROP TABLE media;--", order="ASC")
            assert len(items) == 1
        finally:
            await db.close()

    _run(go())


def test_get_directories_filters_null_and_dot(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, get_directories

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await insert_media(db, filename="root.png", directory=None)
            await insert_media(db, filename="dot.png", directory=".")
            await insert_media(db, filename="real.png", directory="ProjectA")
            await insert_media(db, filename="sub.png", directory="ProjectA/batch1")

            dirs = await get_directories(db)
            assert "." not in dirs
            assert None not in dirs
            assert "ProjectA" in dirs
            assert "ProjectA/batch1" in dirs
        finally:
            await db.close()

    _run(go())


def test_get_stats(tmp_db):
    from src.review_hub.db import init_db, get_db
    from src.review_hub.queries.media import insert_media, get_stats

    _run(init_db())

    async def go():
        db = await get_db()
        try:
            await insert_media(db, filename="a.png", file_size=1000)
            await insert_media(db, filename="b.png", file_size=2000)

            stats = await get_stats(db)
            assert stats["count"] == 2
            assert stats["total_size"] == 3000
        finally:
            await db.close()

    _run(go())
