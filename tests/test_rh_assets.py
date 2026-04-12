"""Integration tests for Review Hub assets + asset-folders routes."""
import asyncio
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    from src.review_hub.db import init_db
    asyncio.run(init_db())
    from src.api import app
    return TestClient(app)


@pytest.fixture
def client_with_assets_dir(tmp_path, monkeypatch):
    """Client with a real assets_dir so folder routes work."""
    import src.review_hub.db as db_mod
    import config.settings as settings_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    assets_dir = tmp_path / "Assets"
    assets_dir.mkdir()
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path, raising=False)
    from src.review_hub.db import init_db
    asyncio.run(init_db())
    from src.api import app
    return TestClient(app), assets_dir


def _insert_asset(client, filename="char.png", directory="Characters") -> int:
    from src.review_hub.db import get_db
    from src.review_hub.queries.assets import insert_asset

    async def go():
        db = await get_db()
        try:
            return await insert_asset(db, filename=filename, directory=directory)
        finally:
            await db.close()

    return asyncio.run(go())


# ── Assets list ──────────────────────────────────────────────────────

def test_list_assets_empty(client):
    resp = client.get("/api/rh/assets")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


def test_list_assets_with_item(client):
    _insert_asset(client)
    resp = client.get("/api/rh/assets")
    assert resp.json()["total"] == 1


def test_list_assets_filter_by_directory(client):
    _insert_asset(client, filename="a.png", directory="Characters")
    _insert_asset(client, filename="b.png", directory="Vehicles")
    resp = client.get("/api/rh/assets", params={"directory": "Characters"})
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["filename"] == "a.png"


def test_get_asset_not_found(client):
    resp = client.get("/api/rh/assets/9999")
    assert resp.status_code == 404


def test_get_asset_found(client):
    aid = _insert_asset(client)
    resp = client.get(f"/api/rh/assets/{aid}")
    assert resp.status_code == 200
    assert resp.json()["filename"] == "char.png"


def test_delete_asset_not_found(client):
    resp = client.delete("/api/rh/assets/9999")
    assert resp.status_code == 404


def test_delete_asset_ok(client):
    aid = _insert_asset(client)
    resp = client.delete(f"/api/rh/assets/{aid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert client.get(f"/api/rh/assets/{aid}").status_code == 404


def test_asset_directories(client):
    _insert_asset(client, directory="Characters")
    _insert_asset(client, directory="Vehicles")
    resp = client.get("/api/rh/assets/directories")
    assert resp.status_code == 200
    dirs = resp.json()["directories"]
    assert "Characters" in dirs
    assert "Vehicles" in dirs


# ── Asset folders ────────────────────────────────────────────────────

def test_list_asset_folders_empty(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    from config import settings as settings_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    assets_dir = tmp_path / "Assets"
    assets_dir.mkdir()
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path, raising=False)
    asyncio.run(__import__("src.review_hub.db", fromlist=["init_db"]).init_db())
    from src.api import app
    client = TestClient(app)
    resp = client.get("/api/rh/asset-folders")
    assert resp.status_code == 200
    assert resp.json()["folders"] == []


def test_create_and_list_asset_folder(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    from config import settings as settings_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    assets_dir = tmp_path / "Assets"
    assets_dir.mkdir()
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path, raising=False)
    asyncio.run(__import__("src.review_hub.db", fromlist=["init_db"]).init_db())
    from src.api import app
    client = TestClient(app)

    resp = client.post("/api/rh/asset-folders", json={"path": "Characters"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get("/api/rh/asset-folders")
    assert "Characters" in resp.json()["folders"]


def test_create_asset_folder_conflict(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    from config import settings as settings_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    assets_dir = tmp_path / "Assets"
    assets_dir.mkdir()
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path, raising=False)
    asyncio.run(__import__("src.review_hub.db", fromlist=["init_db"]).init_db())
    from src.api import app
    client = TestClient(app)

    client.post("/api/rh/asset-folders", json={"path": "Props"})
    resp = client.post("/api/rh/asset-folders", json={"path": "Props"})
    assert resp.status_code == 409


def test_delete_asset_folder_not_found(tmp_path, monkeypatch):
    import src.review_hub.db as db_mod
    from config import settings as settings_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    assets_dir = tmp_path / "Assets"
    assets_dir.mkdir()
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path, raising=False)
    asyncio.run(__import__("src.review_hub.db", fromlist=["init_db"]).init_db())
    from src.api import app
    client = TestClient(app)

    resp = client.delete("/api/rh/asset-folders", params={"path": "NonExistent"})
    assert resp.status_code == 404


def test_sanitize_folder_path(tmp_path, monkeypatch):
    """Path traversal attempt is sanitized."""
    import src.review_hub.db as db_mod
    from config import settings as settings_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    assets_dir = tmp_path / "Assets"
    assets_dir.mkdir()
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path, raising=False)
    asyncio.run(__import__("src.review_hub.db", fromlist=["init_db"]).init_db())
    from src.api import app
    client = TestClient(app)

    # "../evil" should be sanitized to "_evil" or similar, not escape assets_dir
    resp = client.post("/api/rh/asset-folders", json={"path": "../evil"})
    assert resp.status_code in (200, 400)
    if resp.status_code == 200:
        created = assets_dir / resp.json()["path"]
        assert str(created.resolve()).startswith(str(assets_dir.resolve()))
