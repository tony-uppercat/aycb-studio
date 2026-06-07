"""Atomic JSON store for batch jobs."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field

from src.batch_gen.models import BatchJob
from src.shared import _log


class StoreSnapshot(BaseModel):
    jobs: list[BatchJob] = Field(default_factory=list)


class BatchStore:
    """Async-safe JSON store for batch jobs at `shared/data/batch-jobs.json`."""

    def __init__(self, path: Path):
        self._path = path
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    async def list_jobs(self, node_id: str | None = None) -> list[BatchJob]:
        async with self._lock:
            snap = await asyncio.to_thread(self._read)
        if node_id is None:
            return snap.jobs
        return [j for j in snap.jobs if j.node_id == node_id]

    async def get(self, job_id: str) -> BatchJob | None:
        async with self._lock:
            snap = await asyncio.to_thread(self._read)
        for j in snap.jobs:
            if j.id == job_id:
                return j
        return None

    async def upsert(self, job: BatchJob) -> None:
        async with self._lock:
            snap = await asyncio.to_thread(self._read)
            replaced = False
            for idx, existing in enumerate(snap.jobs):
                if existing.id == job.id:
                    snap.jobs[idx] = job
                    replaced = True
                    break
            if not replaced:
                snap.jobs.append(job)
            await asyncio.to_thread(self._write, snap)

    async def delete(self, job_id: str) -> bool:
        async with self._lock:
            snap = await asyncio.to_thread(self._read)
            before = len(snap.jobs)
            snap.jobs = [j for j in snap.jobs if j.id != job_id]
            if len(snap.jobs) < before:
                await asyncio.to_thread(self._write, snap)
                return True
            return False

    # -- internals (blocking, called via to_thread) --

    def _read(self) -> StoreSnapshot:
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        if not self._path.exists():
            return StoreSnapshot()
        try:
            raw = self._path.read_text(encoding="utf-8")
            data = json.loads(raw)
            return StoreSnapshot.model_validate(data)
        except Exception as exc:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = self._path.with_name(f"{self._path.name}.corrupt-{ts}")
            try:
                shutil.copy2(self._path, backup)
                _log(f"batch_gen: store corrupt ({exc}); backed up to {backup.name}")
            except Exception as copy_err:
                _log(f"batch_gen: store corrupt ({exc}) and backup failed: {copy_err}")
            return StoreSnapshot()

    def _write(self, snap: StoreSnapshot) -> None:
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        payload = snap.model_dump_json(indent=2)
        tmp.write_text(payload, encoding="utf-8", newline="\n")
        os.replace(tmp, self._path)
