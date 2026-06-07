"""Background poller that advances running batch jobs to terminal states."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from src.batch_gen.models import JobState
from src.batch_gen.provider import GeminiBatchProvider
from src.batch_gen.store import BatchStore
from src.shared import _log


class BatchPoller:
    def __init__(
        self,
        *,
        store: BatchStore,
        provider: GeminiBatchProvider,
        media_dir: Path,
        interval_s: float = 10.0,
    ):
        self._store = store
        self._provider = provider
        self._media_dir = media_dir
        self._interval = interval_s
        self.task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if self.task and not self.task.done():
            return
        self._stop.clear()
        self.task = asyncio.create_task(self._loop(), name="batch_gen_poller")
        _log("batch_gen: poller started")

    async def stop(self) -> None:
        self._stop.set()
        if self.task:
            try:
                await asyncio.wait_for(self.task, timeout=5.0)
            except asyncio.TimeoutError:
                self.task.cancel()
            self.task = None
        _log("batch_gen: poller stopped")

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self.poll_once()
            except Exception as exc:
                _log(f"batch_gen: poller iteration crashed: {exc}")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                continue

    async def poll_once(self) -> None:
        jobs = await self._store.list_jobs()
        running = [j for j in jobs if j.state == JobState.RUNNING]
        for job in running:
            try:
                info = await self._provider.get_state(job.google_job_name)
            except Exception as exc:
                _log(f"batch_gen: get_state failed for {job.id}: {exc}")
                continue  # leave RUNNING, try next tick

            if info.state == JobState.RUNNING:
                continue

            job.updated_at = datetime.now(timezone.utc)
            job.state = info.state
            if info.error:
                job.error = info.error

            if info.state == JobState.SUCCEEDED and info.result_file:
                try:
                    prompts = {r.key: r.prompt for r in job.requests}
                    results = await self._provider.download_results(
                        result_file=info.result_file,
                        model=job.model,
                        media_dir=self._media_dir,
                        prompts=prompts,
                    )
                    job.results = results
                except Exception as exc:
                    _log(f"batch_gen: download_results failed for {job.id}: {exc}")
                    job.state = JobState.FAILED
                    job.error = f"download_results: {exc}"

            await self._store.upsert(job)
            _log(f"batch_gen: job {job.id} -> {job.state.value}")
