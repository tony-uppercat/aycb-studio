"""Tests for prompt library CRUD endpoints."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    prompts_dir = tmp_path / "prompts"
    prompts_dir.mkdir()
    import src.routers.prompt as mod
    monkeypatch.setattr(mod, "_PROMPTS_DIR", prompts_dir)
    monkeypatch.setattr(mod, "_LIBRARY_FILE", prompts_dir / "library.json")
    monkeypatch.setattr(mod, "_PROMPT_FILE", prompts_dir / "analyze.txt")
    monkeypatch.setattr(mod, "_PROMPT_HISTORY_FILE", prompts_dir / "history.json")
    from src.api import app
    return TestClient(app)


def test_list_empty(client):
    r = client.get("/api/prompt/library")
    assert r.status_code == 200
    assert r.json()["prompts"] == []


def test_create_and_list(client):
    r = client.post("/api/prompt/library", json={
        "name": "Hero prompt",
        "text": "A brave hero...",
        "tags": ["character", "Fantasy"],
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Hero prompt"
    assert data["tags"] == ["character", "fantasy"]  # lowercased
    assert "id" in data

    r2 = client.get("/api/prompt/library")
    assert len(r2.json()["prompts"]) == 1


def test_update(client):
    r = client.post("/api/prompt/library", json={
        "name": "Old name", "text": "old text", "tags": [],
    })
    eid = r.json()["id"]
    r2 = client.put(f"/api/prompt/library/{eid}", json={"name": "New name"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "New name"
    assert r2.json()["text"] == "old text"  # unchanged


def test_update_not_found(client):
    r = client.put("/api/prompt/library/fake-id", json={"name": "x"})
    assert r.status_code == 404


def test_delete(client):
    r = client.post("/api/prompt/library", json={
        "name": "To delete", "text": "bye", "tags": [],
    })
    eid = r.json()["id"]
    r2 = client.delete(f"/api/prompt/library/{eid}")
    assert r2.status_code == 200
    r3 = client.get("/api/prompt/library")
    assert len(r3.json()["prompts"]) == 0


def test_delete_not_found(client):
    r = client.delete("/api/prompt/library/fake-id")
    assert r.status_code == 404


def test_corrupt_library_backup(client, tmp_path):
    lib_file = tmp_path / "prompts" / "library.json"
    lib_file.write_text("NOT JSON", encoding="utf-8")
    r = client.get("/api/prompt/library")
    assert r.status_code == 200
    assert r.json()["prompts"] == []
    assert (tmp_path / "prompts" / "library.json.corrupt").exists()
