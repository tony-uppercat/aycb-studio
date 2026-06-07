"""Tests for src/batch_gen/poller.py with mocked provider + real store."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src.batch_gen.models import BatchJob, BatchRequest, BatchResult, JobState
from src.batch_gen.poller import BatchPoller
from src.batch_gen.provider import JobStateInfo
from src.batch_gen.store import BatchStore


def _make_running_job(job_id: str = "j1") -> BatchJob:
    now = datetime.now(timezone.utc)
    return BatchJob(
        id=job_id,
        google_job_name=f"batches/{job_id}",
        node_id="nodeA",
        model="gemini-3-pro-image-preview",
        submitted_at=now,
        updated_at=now,
        state=JobState.RUNNING,
        requests=[BatchRequest(key="r0", prompt="hello")],
    )


@pytest.mark.asyncio
async def test_poll_once_marks_succeeded_and_writes_results(tmp_path: Path):
    store = BatchStore(tmp_path / "store.json")
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    await store.upsert(_make_running_job())

    provider = AsyncMock()
    provider.get_state.return_value = JobStateInfo(
        state=JobState.SUCCEEDED,
        result_file="files/r",
        error=None,
    )
    provider.download_results.return_value = [
        BatchResult(request_key="r0", media_path="Media/x.png", media_id="m1", cost=0.05),
    ]
    poller = BatchPoller(store=store, provider=provider, media_dir=media_dir)
    await poller.poll_once()

    job = await store.get("j1")
    assert job is not None
    assert job.state == JobState.SUCCEEDED
    assert len(job.results) == 1
    assert job.results[0].media_id == "m1"


@pytest.mark.asyncio
async def test_poll_once_records_failed(tmp_path: Path):
    store = BatchStore(tmp_path / "store.json")
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    await store.upsert(_make_running_job())

    provider = AsyncMock()
    provider.get_state.return_value = JobStateInfo(
        state=JobState.FAILED,
        result_file=None,
        error="quota exceeded",
    )
    poller = BatchPoller(store=store, provider=provider, media_dir=media_dir)
    await poller.poll_once()

    job = await store.get("j1")
    assert job.state == JobState.FAILED
    assert job.error == "quota exceeded"
    provider.download_results.assert_not_called()


@pytest.mark.asyncio
async def test_poll_once_records_expired(tmp_path: Path):
    store = BatchStore(tmp_path / "store.json")
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    await store.upsert(_make_running_job())

    provider = AsyncMock()
    provider.get_state.return_value = JobStateInfo(
        state=JobState.EXPIRED, result_file=None, error=None,
    )
    poller = BatchPoller(store=store, provider=provider, media_dir=media_dir)
    await poller.poll_once()
    job = await store.get("j1")
    assert job.state == JobState.EXPIRED


@pytest.mark.asyncio
async def test_poll_once_skips_terminal_jobs(tmp_path: Path):
    store = BatchStore(tmp_path / "store.json")
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    job = _make_running_job()
    job.state = JobState.SUCCEEDED
    await store.upsert(job)

    provider = AsyncMock()
    poller = BatchPoller(store=store, provider=provider, media_dir=media_dir)
    await poller.poll_once()
    provider.get_state.assert_not_called()


@pytest.mark.asyncio
async def test_single_job_exception_does_not_kill_loop(tmp_path: Path):
    store = BatchStore(tmp_path / "store.json")
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    await store.upsert(_make_running_job("j1"))
    await store.upsert(_make_running_job("j2"))

    provider = AsyncMock()
    async def get_state_impl(name: str) -> JobStateInfo:
        if "j1" in name:
            raise RuntimeError("transient")
        return JobStateInfo(state=JobState.SUCCEEDED, result_file="files/r", error=None)
    provider.get_state.side_effect = get_state_impl
    provider.download_results.return_value = []

    poller = BatchPoller(store=store, provider=provider, media_dir=media_dir)
    await poller.poll_once()

    j1 = await store.get("j1")
    j2 = await store.get("j2")
    assert j1.state == JobState.RUNNING  # left alone on transient error
    assert j2.state == JobState.SUCCEEDED


@pytest.mark.asyncio
async def test_start_and_cancel_clean_shutdown(tmp_path: Path):
    store = BatchStore(tmp_path / "store.json")
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    provider = AsyncMock()
    poller = BatchPoller(store=store, provider=provider, media_dir=media_dir, interval_s=0.01)
    poller.start()
    await asyncio.sleep(0.05)
    await poller.stop()
    assert poller.task is None or poller.task.done()
