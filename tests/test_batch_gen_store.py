"""Tests for src/batch_gen/store.py."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.batch_gen.models import BatchJob, BatchRequest, JobState
from src.batch_gen.store import BatchStore


def _make_job(job_id: str = "job-1", node_id: str = "node-A") -> BatchJob:
    now = datetime.now(timezone.utc)
    return BatchJob(
        id=job_id,
        google_job_name=f"batches/{job_id}",
        node_id=node_id,
        model="gemini-3-pro-image",
        submitted_at=now,
        updated_at=now,
        state=JobState.RUNNING,
        requests=[BatchRequest(key="r0", prompt="hello")],
        cost_estimate=0.05,
    )


@pytest.mark.asyncio
async def test_roundtrip_write_then_read(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    await store.upsert(_make_job())
    jobs = await store.list_jobs()
    assert len(jobs) == 1
    assert jobs[0].id == "job-1"


@pytest.mark.asyncio
async def test_list_filter_by_node(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    await store.upsert(_make_job("j1", "nodeA"))
    await store.upsert(_make_job("j2", "nodeB"))
    a = await store.list_jobs(node_id="nodeA")
    assert [j.id for j in a] == ["j1"]


@pytest.mark.asyncio
async def test_upsert_updates_existing(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    job = _make_job()
    await store.upsert(job)
    job.state = JobState.SUCCEEDED
    await store.upsert(job)
    jobs = await store.list_jobs()
    assert len(jobs) == 1
    assert jobs[0].state == JobState.SUCCEEDED


@pytest.mark.asyncio
async def test_corrupt_file_backed_up_and_reset(tmp_path: Path):
    store_path = tmp_path / "batch-jobs.json"
    store_path.write_text("{not valid json", encoding="utf-8")
    store = BatchStore(store_path)
    jobs = await store.list_jobs()
    assert jobs == []
    backups = list(tmp_path.glob("batch-jobs.json.corrupt-*"))
    assert len(backups) == 1


@pytest.mark.asyncio
async def test_atomic_write_no_partial_on_crash(tmp_path: Path):
    """Tmp file is renamed atomically — readers never see partial JSON."""
    store_path = tmp_path / "batch-jobs.json"
    store = BatchStore(store_path)
    await store.upsert(_make_job())
    # Simulate concurrent read while we write again
    job2 = _make_job("job-2", "nodeB")
    async def reader():
        for _ in range(20):
            content = store_path.read_text(encoding="utf-8")
            json.loads(content)  # must always parse
            await asyncio.sleep(0.001)
    async def writer():
        for _ in range(20):
            await store.upsert(job2)
    await asyncio.gather(reader(), writer())


@pytest.mark.asyncio
async def test_concurrent_upserts_serialized(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    jobs = [_make_job(f"j{i}") for i in range(10)]
    await asyncio.gather(*(store.upsert(j) for j in jobs))
    persisted = await store.list_jobs()
    assert sorted(j.id for j in persisted) == sorted(j.id for j in jobs)


@pytest.mark.asyncio
async def test_get_on_empty_store_returns_none(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    assert await store.get("anything") is None


@pytest.mark.asyncio
async def test_get_unknown_id_returns_none(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    await store.upsert(_make_job("j1"))
    assert await store.get("unknown") is None


@pytest.mark.asyncio
async def test_delete_unknown_returns_false(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    await store.upsert(_make_job("j1"))
    assert (await store.delete("unknown")) is False
    # ensure the existing job is untouched
    jobs = await store.list_jobs()
    assert len(jobs) == 1


@pytest.mark.asyncio
async def test_list_jobs_filter_no_match_returns_empty(tmp_path: Path):
    store = BatchStore(tmp_path / "batch-jobs.json")
    await store.upsert(_make_job("j1", node_id="nodeA"))
    jobs = await store.list_jobs(node_id="nodeX")
    assert jobs == []


@pytest.mark.asyncio
async def test_stale_tmp_file_cleaned_up_on_read(tmp_path: Path):
    store_path = tmp_path / "batch-jobs.json"
    tmp_path_file = tmp_path / "batch-jobs.json.tmp"
    # Simulate a crash mid-write: tmp file exists, main file does not
    tmp_path_file.write_text('{"jobs": []}', encoding="utf-8")
    store = BatchStore(store_path)
    jobs = await store.list_jobs()
    assert jobs == []
    assert not tmp_path_file.exists()
