"""Tests for system router — health, logs."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from src.api import app
    return TestClient(app)


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "local_ip" in data


def test_get_logs(client):
    resp = client.get("/api/logs")
    assert resp.status_code == 200
    data = resp.json()
    assert "logs" in data
    assert isinstance(data["logs"], list)


def test_clear_logs(client):
    resp = client.delete("/api/logs")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    # verify cleared
    resp2 = client.get("/api/logs")
    assert len(resp2.json()["logs"]) == 0
