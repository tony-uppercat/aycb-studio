"""Tests for canvas backup endpoint."""
import json
import pytest
from fastapi.testclient import TestClient
from pathlib import Path


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with shared_root pointing at tmp_path."""
    import config.settings as settings_mod
    monkeypatch.setattr(settings_mod.settings, "shared_root", tmp_path)
    from src.api import app
    return TestClient(app)


def _backup_payload(project_id: str = "proj-test-123") -> dict:
    return {
        "project_id": project_id,
        "nodes": [{"id": "node-1", "type": "textInput", "data": {"text": "hello"}}],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }


def test_backup_creates_file(client, tmp_path):
    resp = client.post("/api/canvas/backup", json=_backup_payload())
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["file"].startswith("canvas_")
    assert data["file"].endswith(".json")

    backup_dir = tmp_path / "data" / "canvas_backups" / "proj-test-123"
    files = list(backup_dir.glob("canvas_*.json"))
    assert len(files) == 1

    saved = json.loads(files[0].read_text(encoding="utf-8"))
    assert saved["project_id"] == "proj-test-123"
    assert saved["canvas"]["nodes"][0]["id"] == "node-1"
    assert saved["canvas"]["viewport"] == {"x": 0, "y": 0, "zoom": 1}


def test_backup_without_viewport(client, tmp_path):
    payload = _backup_payload()
    payload["viewport"] = None
    resp = client.post("/api/canvas/backup", json=payload)
    assert resp.status_code == 200

    backup_dir = tmp_path / "data" / "canvas_backups" / "proj-test-123"
    saved = json.loads(list(backup_dir.glob("canvas_*.json"))[0].read_text())
    assert saved["canvas"]["viewport"] is None


def test_backup_rotation_keeps_last_20(client, tmp_path, monkeypatch):
    import src.plugins.canvas_backup as backup_mod
    monkeypatch.setattr(backup_mod, "MAX_BACKUPS_PER_PROJECT", 3)

    for _ in range(5):
        resp = client.post("/api/canvas/backup", json=_backup_payload())
        assert resp.status_code == 200

    backup_dir = tmp_path / "data" / "canvas_backups" / "proj-test-123"
    files = list(backup_dir.glob("canvas_*.json"))
    assert len(files) <= 3


def test_backup_missing_project_id_rejected(client):
    payload = {"nodes": [], "edges": []}
    resp = client.post("/api/canvas/backup", json=payload)
    assert resp.status_code == 422


def test_backup_multiple_projects_isolated(client, tmp_path):
    client.post("/api/canvas/backup", json=_backup_payload("proj-a"))
    client.post("/api/canvas/backup", json=_backup_payload("proj-b"))

    dir_a = tmp_path / "data" / "canvas_backups" / "proj-a"
    dir_b = tmp_path / "data" / "canvas_backups" / "proj-b"
    assert len(list(dir_a.glob("canvas_*.json"))) == 1
    assert len(list(dir_b.glob("canvas_*.json"))) == 1
