from fastapi.testclient import TestClient

from src.api import app
from src.plugins import skill_list


def test_get_skills_returns_list(monkeypatch):
    monkeypatch.setattr(
        skill_list, "_collect",
        lambda: [{"name": "caveman", "description": "Talk short.", "source": "caveman"}],
    )
    client = TestClient(app)
    r = client.get("/api/llm/skills")
    assert r.status_code == 200
    body = r.json()
    assert body["skills"][0]["name"] == "caveman"


def test_get_skills_error_is_surfaced(monkeypatch):
    def boom():
        raise RuntimeError("scan failed")
    monkeypatch.setattr(skill_list, "_collect", boom)
    client = TestClient(app)
    r = client.get("/api/llm/skills")
    assert r.status_code == 500
