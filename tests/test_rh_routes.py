"""Integration tests for Review Hub HTTP routes (/api/rh/*)."""
import asyncio
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with DB pointed at tmp_path."""
    import src.review_hub.db as db_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    # Init DB before creating client (lifespan does this in prod)
    from src.review_hub.db import init_db
    asyncio.run(init_db())
    from src.api import app
    return TestClient(app)


def _insert_media(client) -> int:
    """Helper: insert a media row via DB and return its id."""
    from src.review_hub.db import get_db
    from src.review_hub.queries.media import insert_media

    async def go():
        db = await get_db()
        try:
            return await insert_media(db, filename="test.png", directory="TestDir")
        finally:
            await db.close()

    return asyncio.run(go())


# ── Media routes ────────────────────────────────────────────────────

def test_list_media_empty(client):
    resp = client.get("/api/rh/media")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


def test_list_media_with_items(client):
    _insert_media(client)
    resp = client.get("/api/rh/media")
    assert resp.json()["total"] == 1


def test_get_media_not_found(client):
    resp = client.get("/api/rh/media/9999")
    assert resp.status_code == 404


def test_get_media_found(client):
    mid = _insert_media(client)
    resp = client.get(f"/api/rh/media/{mid}")
    assert resp.status_code == 200
    assert resp.json()["filename"] == "test.png"


def test_media_stats(client):
    _insert_media(client)
    resp = client.get("/api/rh/media/stats")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_media_directories(client):
    _insert_media(client)
    resp = client.get("/api/rh/media/directories")
    assert resp.status_code == 200
    assert "TestDir" in resp.json()["directories"]


# ── Delete routes (admin pin) ──────────────────────────────────────

def test_delete_media_no_pin(client):
    mid = _insert_media(client)
    resp = client.delete(f"/api/rh/media/{mid}")
    assert resp.status_code == 403


def test_delete_media_wrong_pin(client):
    mid = _insert_media(client)
    resp = client.delete(f"/api/rh/media/{mid}", headers={"X-Admin-Pin": "0000"})
    assert resp.status_code == 403


def test_delete_media_correct_pin(client):
    mid = _insert_media(client)
    resp = client.delete(f"/api/rh/media/{mid}", headers={"X-Admin-Pin": "1312"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    # Verify it's gone
    resp2 = client.get(f"/api/rh/media/{mid}")
    assert resp2.status_code == 404


def test_delete_media_not_found(client):
    resp = client.delete("/api/rh/media/9999", headers={"X-Admin-Pin": "1312"})
    assert resp.status_code == 404


def test_bulk_delete(client):
    m1 = _insert_media(client)
    m2 = _insert_media(client)
    resp = client.post("/api/rh/media/bulk-delete",
        json={"ids": [m1, m2]},
        headers={"X-Admin-Pin": "1312"})
    assert resp.status_code == 200
    assert len(resp.json()["deleted"]) == 2


def test_bulk_delete_no_pin(client):
    resp = client.post("/api/rh/media/bulk-delete",
        json={"ids": [1]})
    assert resp.status_code == 403


# ── Favorites routes ───────────────────────────────────────────────

def test_toggle_favorite(client):
    mid = _insert_media(client)
    resp = client.post("/api/rh/favorites/toggle", json={
        "media_id": mid, "user_name": "alice", "status": "favorite",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "favorite"


def test_toggle_favorite_nonexistent_media(client):
    resp = client.post("/api/rh/favorites/toggle", json={
        "media_id": 9999, "user_name": "alice", "status": "favorite",
    })
    assert resp.status_code == 404


def test_get_favorites(client):
    mid = _insert_media(client)
    client.post("/api/rh/favorites/toggle", json={
        "media_id": mid, "user_name": "bob", "status": "approved",
    })
    resp = client.get(f"/api/rh/favorites/{mid}")
    assert resp.status_code == 200
    assert len(resp.json()["favorites"]) == 1


# ── Comments routes ────────────────────────────────────────────────

def test_add_comment(client):
    mid = _insert_media(client)
    resp = client.post("/api/rh/comments", json={
        "media_id": mid, "author": "alice", "content": "Looks great!",
    })
    assert resp.status_code == 200
    assert "id" in resp.json()


def test_add_comment_nonexistent_media(client):
    resp = client.post("/api/rh/comments", json={
        "media_id": 9999, "author": "alice", "content": "Ghost",
    })
    assert resp.status_code == 404


def test_list_comments(client):
    mid = _insert_media(client)
    client.post("/api/rh/comments", json={
        "media_id": mid, "author": "alice", "content": "Nice",
    })
    resp = client.get(f"/api/rh/comments/{mid}")
    assert resp.status_code == 200
    assert len(resp.json()["comments"]) == 1


def test_delete_comment(client):
    mid = _insert_media(client)
    cid = client.post("/api/rh/comments", json={
        "media_id": mid, "author": "alice", "content": "Delete me",
    }).json()["id"]
    resp = client.delete(f"/api/rh/comments/{cid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── Drawings routes ────────────────────────────────────────────────

def test_get_drawing_empty(client):
    mid = _insert_media(client)
    resp = client.get(f"/api/rh/drawings/{mid}")
    assert resp.status_code == 200
    assert resp.json() == {"drawing": None}


def test_save_drawing(client):
    mid = _insert_media(client)
    resp = client.post("/api/rh/drawings", json={
        "media_id": mid, "author": "alice", "strokes_json": '[{"x":0}]',
    })
    assert resp.status_code == 200
    assert "id" in resp.json()


def test_save_drawing_nonexistent_media(client):
    resp = client.post("/api/rh/drawings", json={
        "media_id": 9999, "author": "alice", "strokes_json": '[]',
    })
    assert resp.status_code == 404


def test_save_drawing_upserts(client):
    mid = _insert_media(client)
    r1 = client.post("/api/rh/drawings", json={
        "media_id": mid, "author": "alice", "strokes_json": "v1",
    })
    r2 = client.post("/api/rh/drawings", json={
        "media_id": mid, "author": "alice", "strokes_json": "v2",
    })
    assert r1.json()["id"] == r2.json()["id"]  # upsert, not duplicate
