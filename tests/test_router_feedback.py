"""Tests for feedback router — feedback CRUD + console notify."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Must monkeypatch in both src.shared AND src.routers.feedback
    # because the router imports the constants at module level
    import src.shared as shared_mod
    import src.routers.feedback as fb_mod
    urgent = tmp_path / "urgent.json"
    all_fb = tmp_path / "all.json"
    monkeypatch.setattr(shared_mod, "FEEDBACK_FILE", urgent)
    monkeypatch.setattr(shared_mod, "FEEDBACK_ALL_FILE", all_fb)
    monkeypatch.setattr(fb_mod, "FEEDBACK_FILE", urgent)
    monkeypatch.setattr(fb_mod, "FEEDBACK_ALL_FILE", all_fb)
    from src.api import app
    return TestClient(app)


def test_add_feedback(client):
    resp = client.post("/api/feedback", json={
        "id": "fb_1",
        "text": "Button misaligned",
        "category": "ui",
        "timestamp": "2026-04-03T12:00:00Z",
    })
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_add_urgent_feedback(client):
    resp = client.post("/api/feedback/urgent", json={
        "id": "fb_2",
        "text": "Server crash on upload",
        "category": "bug",
        "timestamp": "2026-04-03T12:00:00Z",
    })
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_get_urgent_empty(client):
    resp = client.get("/api/feedback/urgent")
    assert resp.status_code == 200
    assert resp.json() == {"entries": []}


def test_get_urgent_after_add(client):
    client.post("/api/feedback/urgent", json={
        "id": "fb_3",
        "text": "Critical bug",
        "category": "bug",
        "timestamp": "2026-04-03T12:00:00Z",
    })
    resp = client.get("/api/feedback/urgent")
    entries = resp.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["text"] == "Critical bug"


def test_resolve_urgent(client):
    client.post("/api/feedback/urgent", json={
        "id": "fb_4",
        "text": "Resolve me",
        "category": "bug",
        "timestamp": "2026-04-03T12:00:00Z",
    })
    resp = client.delete("/api/feedback/urgent/fb_4")
    assert resp.json()["status"] == "ok"
    assert resp.json()["remaining"] == 0


def test_resolve_nonexistent(client):
    resp = client.delete("/api/feedback/urgent/fake_id")
    assert resp.json()["status"] == "not_found"


def test_console_notify(client):
    resp = client.post("/api/console/notify", data={
        "text": "Generation complete",
        "type": "success",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
