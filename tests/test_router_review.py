"""Tests for review router — CRUD on review checklist items."""
import json
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import src.routers.review as review_mod
    monkeypatch.setattr(review_mod, "REVIEW_FILE", tmp_path / "review.json")
    from src.api import app
    return TestClient(app)


def test_list_items_empty(client):
    resp = client.get("/api/review/items")
    assert resp.status_code == 200
    assert resp.json() == {"items": []}


def test_add_single_item(client):
    resp = client.post("/api/review/items", json={
        "text": "Check button alignment",
        "category": "frontend",
        "priority": "P1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["count"] == 1

    items = client.get("/api/review/items").json()["items"]
    assert len(items) == 1
    assert items[0]["text"] == "Check button alignment"
    assert items[0]["status"] == "pending"
    assert items[0]["id"].startswith("rv_")


def test_add_batch_items(client):
    resp = client.post("/api/review/items", json=[
        {"text": "Item A"},
        {"text": "Item B"},
        {"text": "Item C"},
    ])
    assert resp.json()["count"] == 3
    items = client.get("/api/review/items").json()["items"]
    assert len(items) == 3
    ids = [i["id"] for i in items]
    assert len(set(ids)) == 3  # all unique


def test_update_item(client):
    client.post("/api/review/items", json={"text": "Fix bug"})
    items = client.get("/api/review/items").json()["items"]
    item_id = items[0]["id"]

    resp = client.patch(f"/api/review/items/{item_id}", json={
        "status": "pass",
        "note": "Verified OK",
    })
    assert resp.json()["status"] == "ok"

    updated = client.get("/api/review/items").json()["items"][0]
    assert updated["status"] == "pass"
    assert updated["note"] == "Verified OK"


def test_update_nonexistent(client):
    resp = client.patch("/api/review/items/fake_id", json={"status": "pass"})
    assert resp.json()["status"] == "not_found"


def test_delete_item(client):
    client.post("/api/review/items", json={"text": "Temp item"})
    items = client.get("/api/review/items").json()["items"]
    item_id = items[0]["id"]

    resp = client.delete(f"/api/review/items/{item_id}")
    assert resp.json()["status"] == "ok"
    assert resp.json()["remaining"] == 0


def test_delete_nonexistent(client):
    resp = client.delete("/api/review/items/fake_id")
    assert resp.json()["status"] == "not_found"


def test_clear_passed(client):
    client.post("/api/review/items", json=[
        {"text": "A"},
        {"text": "B"},
    ])
    items = client.get("/api/review/items").json()["items"]
    # Mark first as pass
    client.patch(f"/api/review/items/{items[0]['id']}", json={"status": "pass"})

    resp = client.post("/api/review/clear")
    data = resp.json()
    assert data["cleared"] == 1
    assert data["remaining"] == 1


def test_carry_over(client):
    client.post("/api/review/items", json=[
        {"text": "Pending"},
        {"text": "Failed"},
    ])
    items = client.get("/api/review/items").json()["items"]
    client.patch(f"/api/review/items/{items[1]['id']}", json={"status": "fail"})

    resp = client.post("/api/review/carry-over")
    data = resp.json()
    assert data["carried"] == 2  # both pending + fail carry over
