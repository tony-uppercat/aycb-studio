"""HTTP integration tests for /api/batch/* routes."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.batch_gen.models import BatchJob, BatchRequest, JobState
from src.batch_gen.store import BatchStore


@pytest.fixture
def app_with_routes(tmp_path: Path, monkeypatch):
    """Build a minimal FastAPI app with batch_gen router and mocked provider."""
    from src.plugins import batch_gen as plugin

    test_store = BatchStore(tmp_path / "batch-jobs.json")
    monkeypatch.setattr(plugin, "_store", test_store)
    mock_provider = AsyncMock()
    mock_provider.submit.return_value = "batches/fake-name"
    mock_provider.cancel.return_value = None
    monkeypatch.setattr(plugin, "_get_provider", lambda: mock_provider)

    app = FastAPI()
    app.include_router(plugin.router)
    return app, test_store, mock_provider


def test_submit_creates_job_and_persists(app_with_routes):
    app, store, provider = app_with_routes
    client = TestClient(app)
    payload = {
        "node_id": "node-A",
        "model": "gemini-3-pro-image-preview",
        "requests": [{
            "key": "r0",
            "prompt": "a cat",
            "refs_b64": [],
            "refs_mime": [],
            "aspect_ratio": "16:9",
            "resolution": "2K",
        }],
    }
    resp = client.post("/api/batch/submit", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"] == "running"
    assert body["count"] == 1
    assert body["cost_estimate"] > 0
    provider.submit.assert_awaited_once()


def test_submit_returns_422_on_provider_failure(app_with_routes):
    """Memo feedback_502_masks_errors — upstream failures must surface as 422."""
    app, _, provider = app_with_routes
    provider.submit.side_effect = RuntimeError("google quota")
    client = TestClient(app)
    resp = client.post("/api/batch/submit", json={
        "node_id": "node-A",
        "model": "gemini-3-pro-image-preview",
        "requests": [{"key": "r0", "prompt": "x"}],
    })
    assert resp.status_code == 422
    assert "google quota" in resp.json()["detail"]


def test_list_jobs_returns_persisted(app_with_routes):
    app, store, _ = app_with_routes
    job = BatchJob(
        id="j1", google_job_name="batches/j1", node_id="nodeA",
        model="gemini-3-pro-image-preview",
        submitted_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        state=JobState.RUNNING,
        requests=[BatchRequest(key="r0", prompt="x")],
    )
    asyncio.run(store.upsert(job))
    client = TestClient(app)
    resp = client.get("/api/batch/jobs")
    assert resp.status_code == 200
    assert len(resp.json()["jobs"]) == 1


def test_list_jobs_filter_by_node(app_with_routes):
    app, store, _ = app_with_routes
    for jid, nid in [("a", "n1"), ("b", "n2")]:
        asyncio.run(store.upsert(BatchJob(
            id=jid, google_job_name=f"batches/{jid}", node_id=nid,
            model="gemini-3-pro-image-preview",
            submitted_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            state=JobState.RUNNING,
            requests=[BatchRequest(key="r0", prompt="x")],
        )))
    client = TestClient(app)
    resp = client.get("/api/batch/jobs?node_id=n1")
    body = resp.json()
    assert len(body["jobs"]) == 1
    assert body["jobs"][0]["id"] == "a"


def test_cancel_calls_provider_and_updates_state(app_with_routes):
    app, store, provider = app_with_routes
    asyncio.run(store.upsert(BatchJob(
        id="j1", google_job_name="batches/j1", node_id="nodeA",
        model="gemini-3-pro-image-preview",
        submitted_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        state=JobState.RUNNING,
        requests=[BatchRequest(key="r0", prompt="x")],
    )))
    client = TestClient(app)
    resp = client.delete("/api/batch/jobs/j1")
    assert resp.status_code == 200
    assert resp.json()["state"] == "cancelled"
    provider.cancel.assert_awaited_once_with("batches/j1")
    job = asyncio.run(store.get("j1"))
    assert job.state == JobState.CANCELLED


def test_cancel_unknown_returns_404(app_with_routes):
    app, _, _ = app_with_routes
    client = TestClient(app)
    resp = client.delete("/api/batch/jobs/does-not-exist")
    assert resp.status_code == 404


def test_cancel_terminal_state_short_circuits(app_with_routes):
    """If job already terminal, return its actual state without calling provider."""
    app, store, provider = app_with_routes
    asyncio.run(store.upsert(BatchJob(
        id="j1", google_job_name="batches/j1", node_id="nodeA",
        model="gemini-3-pro-image-preview",
        submitted_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        state=JobState.SUCCEEDED,
        requests=[BatchRequest(key="r0", prompt="x")],
    )))
    client = TestClient(app)
    resp = client.delete("/api/batch/jobs/j1")
    assert resp.status_code == 200
    assert resp.json()["state"] == "succeeded"
    provider.cancel.assert_not_called()
