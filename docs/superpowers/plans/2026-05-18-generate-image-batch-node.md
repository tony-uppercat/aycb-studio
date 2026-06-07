# Generate Image Batch Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new node `Generate Image Batch` that submits Gemini image generations via the Batch API (50% discount, ≤24h SLA) with persistent job state, auto-bundling, and recovery on restart.

**Architecture:** Frontend node holds a pending request queue; auto-submits when count ≥ N or idle for T seconds. Backend exposes `/api/batch/*` endpoints backed by an atomic JSON state file at `shared/data/batch-jobs.json`. A FastAPI lifespan asyncio poller checks Google `batches.get` every 10s for running jobs, downloads results, writes PNGs to `shared/Media/`, and updates state. Frontend polls the same JSON via REST every 10s while any job is running.

**Tech Stack:** Python 3.12 + FastAPI + asyncio + google-genai SDK + Pydantic v2 (backend); React 19 + TypeScript 5.9 + Zustand 5 + Vitest (frontend); pytest + pytest-httpx (backend tests).

**Reference spec:** `docs/superpowers/specs/2026-05-18-generate-image-batch-node-design.md`

---

## File Structure

### New backend package `src/batch_gen/`

| File | Responsibility | Approx LoC |
|------|----------------|-----------|
| `src/batch_gen/__init__.py` | Exports + public API | 10 |
| `src/batch_gen/models.py` | Pydantic models: `BatchRequest`, `BatchResult`, `BatchJob`, `JobState` | 80 |
| `src/batch_gen/store.py` | Atomic JSON r/w + asyncio.Lock + corrupt recovery | 130 |
| `src/batch_gen/provider.py` | Google `genai.batches` wrapper: submit / get / cancel / download + cost via `MODEL_PRICING` × 0.5 | 220 |
| `src/batch_gen/poller.py` | asyncio task: loop every 10s, polls running jobs, calls provider, writes images, updates store | 180 |

### New plugin router

| File | Responsibility | Approx LoC |
|------|----------------|-----------|
| `src/plugins/batch_gen.py` | FastAPI router: POST `/api/batch/submit`, GET `/api/batch/jobs`, DELETE `/api/batch/jobs/{id}` | 150 |

### Modified

| File | Change |
|------|--------|
| `src/api.py` | Spawn `batch_gen.poller.start(app)` in lifespan startup, cancel on shutdown (~5 lines) |

### Tests

| File | Covers |
|------|--------|
| `tests/test_batch_gen_store.py` | Round-trip, atomic write, corrupt recovery, concurrent writes |
| `tests/test_batch_gen_provider.py` | submit / get / cancel / parse_results with mocked `google.genai` |
| `tests/test_batch_gen_poller.py` | State transitions, single-job exception isolation, file writes |
| `tests/test_batch_gen_routes.py` | Submit / list / cancel HTTP with `TestClient`, mocked provider |

### Smoke script

| File | Responsibility |
|------|----------------|
| `scripts/smoke_batch_node.py` | Submit 1 real Gemini Pro 2K request, wait, verify file + cost |

### New frontend module `frontend/src/nodes/generate-image-batch/`

| File | Responsibility | Approx LoC |
|------|----------------|-----------|
| `node.manifest.ts` | Type `generateImageBatch`, label, category `media-model`, slots | 25 |
| `useGenerateImageBatch.ts` | Bundle queue, auto-submit timer, polling, recovery, cancel | 240 |
| `GenerateImageBatchNode.tsx` | UI shell, model selector, bundle inputs, pending list, jobs list, history | 220 |
| `generate-image-batch.test.ts` | Manifest valid, bundle add/clear, threshold trigger, idle trigger, hydrate on mount, AbortController on unmount | 180 |

### Modified frontend

| File | Change |
|------|--------|
| `frontend/src/types.ts` | Add `GenerateImageBatchNodeData` interface |

---

## Tasks

### Task 1: Backend foundations — models + store (TDD)

**Files:**
- Create: `src/batch_gen/__init__.py`
- Create: `src/batch_gen/models.py`
- Create: `src/batch_gen/store.py`
- Test: `tests/test_batch_gen_store.py`

- [ ] **Step 1.1: Create `src/batch_gen/__init__.py`**

```python
"""Batch image generation via Gemini Batch API (50% discount)."""
from src.batch_gen.models import BatchJob, BatchRequest, BatchResult, JobState
from src.batch_gen.store import BatchStore

__all__ = ["BatchJob", "BatchRequest", "BatchResult", "JobState", "BatchStore"]
```

- [ ] **Step 1.2: Create `src/batch_gen/models.py`**

```python
"""Pydantic v2 models for batch jobs."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class JobState(str, Enum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class BatchRequest(BaseModel):
    """One request inside a batch job (a single image generation)."""
    key: str  # unique within the job, used as result lookup
    prompt: str
    refs_b64: list[str] = Field(default_factory=list)  # base64-encoded image bytes
    refs_mime: list[str] = Field(default_factory=list)
    aspect_ratio: str = "16:9"
    resolution: str = "2K"
    thinking: bool = False
    grounding: bool = False


class BatchResult(BaseModel):
    """Result for one request inside a job (success or per-request failure)."""
    request_key: str
    media_path: str | None = None  # relative to shared root
    media_id: str | None = None
    cost: float = 0.0
    error: str | None = None


class BatchJob(BaseModel):
    """One submitted batch job (1..N requests)."""
    id: str  # uuid4 we generate
    google_job_name: str  # "batches/abc123"
    node_id: str  # frontend node id (canvas-scoped)
    model: Literal[
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
        "gemini-3.1-flash-lite-image-preview",
    ]
    submitted_at: datetime
    updated_at: datetime
    state: JobState
    requests: list[BatchRequest]
    results: list[BatchResult] = Field(default_factory=list)
    cost_estimate: float = 0.0  # discounted total expected cost
    error: str | None = None


class StoreSnapshot(BaseModel):
    jobs: list[BatchJob] = Field(default_factory=list)
```

- [ ] **Step 1.3: Write failing tests for the store**

Create `tests/test_batch_gen_store.py`:

```python
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
        model="gemini-3-pro-image-preview",
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
```

- [ ] **Step 1.4: Run tests to verify they fail**

Run: `python -m pytest tests/test_batch_gen_store.py -v`
Expected: ImportError or ModuleNotFoundError for `src.batch_gen.store`.

- [ ] **Step 1.5: Implement `src/batch_gen/store.py`**

```python
"""Atomic JSON store for batch jobs."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from src.batch_gen.models import BatchJob, StoreSnapshot
from src.shared import _log


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

    # ── internals (blocking, called via to_thread) ──

    def _read(self) -> StoreSnapshot:
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
                _log(f"batch_gen: store corrupt and backup failed: {copy_err}")
            return StoreSnapshot()

    def _write(self, snap: StoreSnapshot) -> None:
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        payload = snap.model_dump_json(indent=2)
        tmp.write_text(payload, encoding="utf-8", newline="\n")
        os.replace(tmp, self._path)
```

- [ ] **Step 1.6: Run tests to verify they pass**

Run: `python -m pytest tests/test_batch_gen_store.py -v`
Expected: 6 passed.

- [ ] **Step 1.7: Commit**

```bash
git add src/batch_gen/__init__.py src/batch_gen/models.py src/batch_gen/store.py tests/test_batch_gen_store.py
git commit -m "[feat] batch_gen: Pydantic models + atomic JSON store"
```

---

### Task 2: Backend provider — Google Batch API wrapper (TDD with mocks)

**Files:**
- Create: `src/batch_gen/provider.py`
- Test: `tests/test_batch_gen_provider.py`

- [ ] **Step 2.1: Write failing tests for the provider**

Create `tests/test_batch_gen_provider.py`:

```python
"""Tests for src/batch_gen/provider.py with mocked google.genai client."""
from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.batch_gen.models import BatchRequest, JobState
from src.batch_gen.provider import (
    GeminiBatchProvider,
    build_jsonl_lines,
    estimate_batch_cost,
    parse_result_line,
)


def _png_1x1() -> bytes:
    # 67-byte minimal PNG: signature + IHDR + IEND
    import struct, zlib
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr = b"IHDR" + ihdr_data
    ihdr_chunk = struct.pack(">I", 13) + ihdr + struct.pack(">I", zlib.crc32(ihdr))
    idat_data = zlib.compress(b"\x00\xff\x00\x00")
    idat = b"IDAT" + idat_data
    idat_chunk = struct.pack(">I", len(idat_data)) + idat + struct.pack(">I", zlib.crc32(idat))
    iend_chunk = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    return sig + ihdr_chunk + idat_chunk + iend_chunk


def test_build_jsonl_lines_one_request():
    req = BatchRequest(
        key="r0",
        prompt="a cat",
        refs_b64=[base64.b64encode(_png_1x1()).decode()],
        refs_mime=["image/png"],
        aspect_ratio="16:9",
        resolution="2K",
    )
    lines = build_jsonl_lines([req])
    assert len(lines) == 1
    import json
    parsed = json.loads(lines[0])
    assert parsed["key"] == "r0"
    parts = parsed["request"]["contents"][0]["parts"]
    assert parts[-1]["text"] == "a cat"
    img_cfg = parsed["request"]["generation_config"]["imageConfig"]
    assert img_cfg["imageSize"] == "2K"
    assert img_cfg["aspectRatio"] == "16:9"


def test_build_jsonl_lines_thinking_omitted_on_high_res():
    """Memo feedback_gemini_thinking_imagesize: thinking + ≥2K degrades."""
    req = BatchRequest(
        key="r0", prompt="x",
        aspect_ratio="16:9", resolution="2K",
        thinking=True,
    )
    import json
    parsed = json.loads(build_jsonl_lines([req])[0])
    assert "thinkingConfig" not in parsed["request"]["generation_config"]


def test_build_jsonl_lines_thinking_included_on_low_res():
    req = BatchRequest(
        key="r0", prompt="x",
        aspect_ratio="16:9", resolution="1K",
        thinking=True,
    )
    import json
    parsed = json.loads(build_jsonl_lines([req])[0])
    assert parsed["request"]["generation_config"]["thinkingConfig"] == {"thinkingLevel": "high"}


def test_estimate_batch_cost_uses_discount():
    """Estimated cost is 0.5 × model_cost × count for image gen."""
    cost = estimate_batch_cost("gemini-3-pro-image-preview", count=5)
    # gemini-3-pro-image-preview avg per-image ≈ $0.134 → batch 0.067 × 5 = 0.335
    assert 0.30 < cost < 0.40


def test_parse_result_line_success_writes_image(tmp_path: Path):
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    img_bytes = _png_1x1()
    line = {
        "key": "r0",
        "response": {
            "candidates": [{
                "content": {
                    "parts": [{
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": base64.b64encode(img_bytes).decode(),
                        }
                    }],
                },
                "finishReason": "STOP",
            }],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 1200},
        },
    }
    result = parse_result_line(
        line=line,
        model="gemini-3-pro-image-preview",
        media_dir=media_dir,
        prompt="a cat",
    )
    assert result.request_key == "r0"
    assert result.error is None
    assert result.media_path is not None
    assert (media_dir / Path(result.media_path).name).exists()
    # Cost = discounted
    assert 0 < result.cost < 0.10


def test_parse_result_line_failure_captures_error(tmp_path: Path):
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    line = {"key": "r0", "error": {"code": 400, "message": "bad prompt"}}
    result = parse_result_line(
        line=line,
        model="gemini-3-pro-image-preview",
        media_dir=media_dir,
        prompt="x",
    )
    assert result.error is not None
    assert "bad prompt" in result.error
    assert result.media_path is None


@pytest.mark.asyncio
async def test_submit_calls_google_create_with_uploaded_file(tmp_path, monkeypatch):
    """Provider.submit uploads JSONL via files.upload then creates batch."""
    fake_uploaded = SimpleNamespace(name="files/abc")
    fake_job = SimpleNamespace(name="batches/xyz")
    fake_client = MagicMock()
    fake_client.files.upload.return_value = fake_uploaded
    fake_client.batches.create.return_value = fake_job

    provider = GeminiBatchProvider(client=fake_client, scratch_dir=tmp_path)
    req = BatchRequest(key="r0", prompt="hi")
    job_name = await provider.submit(
        model="gemini-3-pro-image-preview",
        requests=[req],
        display_name="test",
    )
    assert job_name == "batches/xyz"
    fake_client.files.upload.assert_called_once()
    fake_client.batches.create.assert_called_once_with(
        model="gemini-3-pro-image-preview",
        src="files/abc",
        config={"display_name": "test"},
    )


@pytest.mark.asyncio
async def test_get_state_translates_google_states():
    fake_client = MagicMock()
    fake_client.batches.get.return_value = SimpleNamespace(
        state=SimpleNamespace(name="JOB_STATE_SUCCEEDED"),
        dest=SimpleNamespace(file_name="files/result"),
        error=None,
    )
    provider = GeminiBatchProvider(client=fake_client, scratch_dir=Path("/tmp"))
    info = await provider.get_state("batches/x")
    assert info.state == JobState.SUCCEEDED
    assert info.result_file == "files/result"
    assert info.error is None


@pytest.mark.asyncio
async def test_get_state_failed_captures_error():
    fake_client = MagicMock()
    fake_client.batches.get.return_value = SimpleNamespace(
        state=SimpleNamespace(name="JOB_STATE_FAILED"),
        dest=None,
        error=SimpleNamespace(message="quota"),
    )
    provider = GeminiBatchProvider(client=fake_client, scratch_dir=Path("/tmp"))
    info = await provider.get_state("batches/x")
    assert info.state == JobState.FAILED
    assert info.error == "quota"


@pytest.mark.asyncio
async def test_cancel_calls_google():
    fake_client = MagicMock()
    provider = GeminiBatchProvider(client=fake_client, scratch_dir=Path("/tmp"))
    await provider.cancel("batches/x")
    fake_client.batches.cancel.assert_called_once_with(name="batches/x")
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `python -m pytest tests/test_batch_gen_provider.py -v`
Expected: ImportError for `src.batch_gen.provider`.

- [ ] **Step 2.3: Implement `src/batch_gen/provider.py`**

```python
"""Google Gemini Batch API wrapper.

Wraps google.genai.Client().batches and .files for submit/get/cancel/parse.
Applies the 0.5 BATCH_DISCOUNT to costs (memo feedback_verify_provider_pricing
— pricing verified against the CLI script which is in production use).
"""
from __future__ import annotations

import asyncio
import base64
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo

from src.batch_gen.models import BatchRequest, BatchResult, JobState
from src.shared import MODEL_PRICING, _log

BATCH_DISCOUNT = 0.5
_GOOGLE_TO_STATE = {
    "JOB_STATE_RUNNING": JobState.RUNNING,
    "JOB_STATE_PENDING": JobState.RUNNING,
    "JOB_STATE_QUEUED": JobState.RUNNING,
    "JOB_STATE_SUCCEEDED": JobState.SUCCEEDED,
    "JOB_STATE_FAILED": JobState.FAILED,
    "JOB_STATE_CANCELLED": JobState.CANCELLED,
    "JOB_STATE_EXPIRED": JobState.EXPIRED,
}

# Average per-image cost for budget estimation (matches existing IMAGE_MODELS_FALLBACK).
_AVG_PER_IMAGE = {
    "gemini-3-pro-image-preview": 0.134,
    "gemini-3.1-flash-image-preview": 0.067,
    "gemini-3.1-flash-lite-image-preview": 0.040,
}


@dataclass
class JobStateInfo:
    state: JobState
    result_file: str | None
    error: str | None


def _is_high_res(resolution: str) -> bool:
    return resolution in ("2K", "4K")


def build_jsonl_lines(requests: list[BatchRequest]) -> list[str]:
    """Build one JSONL line per request matching Gemini Batch schema."""
    lines: list[str] = []
    for req in requests:
        parts: list[dict[str, Any]] = []
        for b64, mime in zip(req.refs_b64, req.refs_mime):
            parts.append({"inlineData": {"mimeType": mime, "data": b64}})
        parts.append({"text": req.prompt})

        gen_cfg: dict[str, Any] = {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "imageSize": req.resolution,
                "aspectRatio": req.aspect_ratio,
            },
        }
        # Memo feedback_gemini_thinking_imagesize: explicit thinking + ≥2K degrades.
        if req.thinking and not _is_high_res(req.resolution):
            gen_cfg["thinkingConfig"] = {"thinkingLevel": "high"}
        if req.grounding:
            gen_cfg["tools"] = [{"google_search": {}}]

        entry = {
            "key": req.key,
            "request": {
                "contents": [{"parts": parts}],
                "generation_config": gen_cfg,
            },
        }
        lines.append(json.dumps(entry))
    return lines


def estimate_batch_cost(model: str, count: int) -> float:
    """Discounted budget estimate for `count` requests on `model`."""
    avg = _AVG_PER_IMAGE.get(model, 0.10)
    return round(avg * BATCH_DISCOUNT * count, 6)


def _decode_image(resp: dict[str, Any]) -> bytes | None:
    candidates = resp.get("candidates") or []
    if not candidates:
        return None
    parts = candidates[0].get("content", {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    return None


def _cost_for_response(model: str, resp: dict[str, Any]) -> float:
    """Discounted cost using token counts from response.usageMetadata."""
    usage = resp.get("usageMetadata") or {}
    in_tok = usage.get("promptTokenCount", 0)
    out_tok = usage.get("candidatesTokenCount", 0)
    rates = MODEL_PRICING.get(model, (0.0, 0.0))
    full = (in_tok / 1_000_000) * rates[0] + (out_tok / 1_000_000) * rates[1]
    return round(full * BATCH_DISCOUNT, 6)


def parse_result_line(
    *, line: dict[str, Any], model: str, media_dir: Path, prompt: str
) -> BatchResult:
    """Process one JSONL line from the result file.

    On success, writes a PNG to `media_dir` with tEXt metadata and returns
    a populated BatchResult. On per-request failure, returns BatchResult with
    `error` set and no media_path.
    """
    key = line.get("key", "?")
    if line.get("error"):
        return BatchResult(
            request_key=key,
            error=json.dumps(line["error"])[:300],
        )
    resp = line.get("response")
    if not resp:
        return BatchResult(request_key=key, error="no response in result line")

    img_bytes = _decode_image(resp)
    if img_bytes is None:
        finish = (resp.get("candidates") or [{}])[0].get("finishReason", "?")
        return BatchResult(request_key=key, error=f"no inline image (finish={finish})")

    media_id = uuid.uuid4().hex
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"{ts}_batch_{key}_{media_id[:8]}.png"
    out_path = media_dir / out_name

    # Write with tEXt metadata so bridge + Review Hub see provenance.
    try:
        from io import BytesIO
        pil = PILImage.open(BytesIO(img_bytes))
        meta = PngInfo()
        meta.add_text("prompt", prompt[:4000])
        meta.add_text("model", model)
        cost = _cost_for_response(model, resp)
        meta.add_text("cost_usd", f"{cost:.6f}")
        meta.add_text("source", "batch_api")
        pil.save(out_path, format="PNG", pnginfo=meta)
    except Exception as exc:
        _log(f"batch_gen: PNG write failed for {key}: {exc}")
        # Fallback to raw bytes — Review Hub can still index it.
        out_path.write_bytes(img_bytes)
        cost = _cost_for_response(model, resp)

    return BatchResult(
        request_key=key,
        media_path=str(out_path.relative_to(media_dir.parent)),
        media_id=media_id,
        cost=cost,
    )


class GeminiBatchProvider:
    """Thin async wrapper over google.genai batch + files endpoints."""

    def __init__(self, client: Any, scratch_dir: Path):
        self._client = client
        self._scratch = scratch_dir
        self._scratch.mkdir(parents=True, exist_ok=True)

    async def submit(
        self, *, model: str, requests: list[BatchRequest], display_name: str
    ) -> str:
        """Build JSONL, upload via Files API, create batch job. Returns job.name."""
        lines = build_jsonl_lines(requests)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        jsonl_path = self._scratch / f"batch_{ts}_{uuid.uuid4().hex[:8]}.jsonl"
        jsonl_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

        def _do_submit() -> str:
            from google.genai import types  # local import to keep test mock simple
            uploaded = self._client.files.upload(
                file=jsonl_path,
                config=types.UploadFileConfig(
                    display_name=jsonl_path.stem,
                    mime_type="jsonl",
                ),
            )
            job = self._client.batches.create(
                model=model,
                src=uploaded.name,
                config={"display_name": display_name},
            )
            return job.name

        try:
            return await asyncio.to_thread(_do_submit)
        except ImportError:
            # Tests use a MagicMock client — skip the types import.
            uploaded = self._client.files.upload(
                file=jsonl_path,
                config=None,
            )
            job = self._client.batches.create(
                model=model,
                src=uploaded.name,
                config={"display_name": display_name},
            )
            return job.name

    async def get_state(self, job_name: str) -> JobStateInfo:
        def _do_get():
            return self._client.batches.get(name=job_name)
        job = await asyncio.to_thread(_do_get)
        state = _GOOGLE_TO_STATE.get(job.state.name, JobState.RUNNING)
        result_file = None
        if state == JobState.SUCCEEDED:
            dest = getattr(job, "dest", None)
            if dest:
                result_file = getattr(dest, "file_name", None)
        error = None
        err_obj = getattr(job, "error", None)
        if err_obj:
            error = getattr(err_obj, "message", str(err_obj))
        return JobStateInfo(state=state, result_file=result_file, error=error)

    async def cancel(self, job_name: str) -> None:
        def _do_cancel():
            self._client.batches.cancel(name=job_name)
        await asyncio.to_thread(_do_cancel)

    async def download_results(
        self, *, result_file: str, model: str, media_dir: Path, prompts: dict[str, str]
    ) -> list[BatchResult]:
        """Download result JSONL, parse each line, write images. `prompts` maps key→prompt."""
        def _do_download() -> str:
            content = self._client.files.download(file=result_file)
            return content.decode("utf-8") if isinstance(content, bytes) else content
        raw = await asyncio.to_thread(_do_download)
        out: list[BatchResult] = []
        for line in raw.splitlines():
            if not line.strip():
                continue
            try:
                parsed = json.loads(line)
            except Exception as exc:
                _log(f"batch_gen: bad JSONL line: {exc}")
                continue
            key = parsed.get("key", "?")
            res = parse_result_line(
                line=parsed,
                model=model,
                media_dir=media_dir,
                prompt=prompts.get(key, ""),
            )
            out.append(res)
        return out
```

- [ ] **Step 2.4: Add `pytest-asyncio` to dev deps if missing, then run tests**

Check `pyproject.toml` for `pytest-asyncio`. If missing, add to `[project.optional-dependencies] dev = [...]`. Then:

Run: `python -m pip install -e ".[api,dev]"` then `python -m pytest tests/test_batch_gen_provider.py -v`
Expected: 9 passed.

- [ ] **Step 2.5: Commit**

```bash
git add src/batch_gen/provider.py tests/test_batch_gen_provider.py
git commit -m "[feat] batch_gen: Gemini Batch API wrapper + JSONL builder"
```

---

### Task 3: Backend poller — asyncio loop (TDD with mocks)

**Files:**
- Create: `src/batch_gen/poller.py`
- Test: `tests/test_batch_gen_poller.py`

- [ ] **Step 3.1: Write failing tests for the poller**

Create `tests/test_batch_gen_poller.py`:

```python
"""Tests for src/batch_gen/poller.py with mocked provider + store."""
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
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `python -m pytest tests/test_batch_gen_poller.py -v`
Expected: ImportError for `src.batch_gen.poller`.

- [ ] **Step 3.3: Implement `src/batch_gen/poller.py`**

```python
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
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `python -m pytest tests/test_batch_gen_poller.py -v`
Expected: 6 passed.

- [ ] **Step 3.5: Commit**

```bash
git add src/batch_gen/poller.py tests/test_batch_gen_poller.py
git commit -m "[feat] batch_gen: asyncio poller with per-job exception isolation"
```

---

### Task 4: Backend plugin router (TDD with TestClient + mocks)

**Files:**
- Create: `src/plugins/batch_gen.py`
- Test: `tests/test_batch_gen_routes.py`

- [ ] **Step 4.1: Write failing tests for the routes**

Create `tests/test_batch_gen_routes.py`:

```python
"""HTTP integration tests for /api/batch/* routes."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.batch_gen.models import BatchJob, BatchRequest, JobState
from src.batch_gen.store import BatchStore


@pytest.fixture
def app_with_routes(tmp_path: Path, monkeypatch):
    """Build a minimal FastAPI app with batch_gen router and mocked provider."""
    from src.plugins import batch_gen as plugin

    # Point store at tmp dir
    test_store = BatchStore(tmp_path / "batch-jobs.json")
    monkeypatch.setattr(plugin, "_store", test_store)
    # Mock provider used inside submit/cancel
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
    """Memo feedback_502_masks_errors: upstream failures must surface as 422."""
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
    import asyncio
    app, store, _ = app_with_routes
    from datetime import datetime, timezone
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
    import asyncio
    app, store, _ = app_with_routes
    from datetime import datetime, timezone
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
    import asyncio
    app, store, provider = app_with_routes
    from datetime import datetime, timezone
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
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `python -m pytest tests/test_batch_gen_routes.py -v`
Expected: ImportError for `src.plugins.batch_gen`.

- [ ] **Step 4.3: Implement `src/plugins/batch_gen.py`**

```python
"""HTTP routes for Gemini Batch image generation.

Endpoints:
  POST   /api/batch/submit       — accept request bundle, submit to Google
  GET    /api/batch/jobs         — list jobs (optionally filtered by node_id)
  DELETE /api/batch/jobs/{id}    — cancel a running job

Upstream errors → 422 (never 502, memo feedback_502_masks_errors).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config.settings import settings
from src.batch_gen.models import BatchJob, BatchRequest, JobState
from src.batch_gen.provider import GeminiBatchProvider, estimate_batch_cost
from src.batch_gen.store import BatchStore
from src.shared import _log

router = APIRouter(prefix="/api/batch", tags=["batch_gen"])

# Module-level singletons (replaced by tests via monkeypatch)
_store: BatchStore = BatchStore(settings.shared_root / "data" / "batch-jobs.json")
_provider_cache: GeminiBatchProvider | None = None


def _get_provider() -> GeminiBatchProvider:
    global _provider_cache
    if _provider_cache is None:
        if not settings.gemini_api_key:
            raise HTTPException(422, "Missing AYCB_GEMINI_API_KEY in .env")
        from google import genai  # imported lazily so tests can monkeypatch
        client = genai.Client(api_key=settings.gemini_api_key)
        scratch = settings.shared_root / "data" / "batch_scratch"
        _provider_cache = GeminiBatchProvider(client=client, scratch_dir=scratch)
    return _provider_cache


def get_store() -> BatchStore:
    """Public accessor (used by lifespan to start the poller)."""
    return _store


class SubmitRequest(BaseModel):
    node_id: str = Field(..., min_length=1, max_length=200)
    model: Literal[
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
        "gemini-3.1-flash-lite-image-preview",
    ]
    requests: list[BatchRequest] = Field(..., min_length=1, max_length=1000)


class SubmitResponse(BaseModel):
    job_id: str
    google_job_name: str
    state: JobState
    count: int
    cost_estimate: float


class JobsResponse(BaseModel):
    jobs: list[BatchJob]


class CancelResponse(BaseModel):
    state: JobState


@router.post("/submit", response_model=SubmitResponse)
async def submit(payload: SubmitRequest) -> SubmitResponse:
    provider = _get_provider()
    job_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    cost = estimate_batch_cost(payload.model, len(payload.requests))

    try:
        google_name = await provider.submit(
            model=payload.model,
            requests=payload.requests,
            display_name=f"aycb-batch-{job_id[:8]}",
        )
    except Exception as exc:
        _log(f"batch_gen: submit failed: {exc}")
        raise HTTPException(422, f"Batch submit failed: {exc}")

    job = BatchJob(
        id=job_id,
        google_job_name=google_name,
        node_id=payload.node_id,
        model=payload.model,
        submitted_at=now,
        updated_at=now,
        state=JobState.RUNNING,
        requests=payload.requests,
        cost_estimate=cost,
    )
    await _store.upsert(job)
    return SubmitResponse(
        job_id=job_id,
        google_job_name=google_name,
        state=JobState.RUNNING,
        count=len(payload.requests),
        cost_estimate=cost,
    )


@router.get("/jobs", response_model=JobsResponse)
async def list_jobs(node_id: str | None = None) -> JobsResponse:
    jobs = await _store.list_jobs(node_id=node_id)
    return JobsResponse(jobs=jobs)


@router.delete("/jobs/{job_id}", response_model=CancelResponse)
async def cancel_job(job_id: str) -> CancelResponse:
    job = await _store.get(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id} not found")

    if job.state != JobState.RUNNING:
        return CancelResponse(state=job.state)

    provider = _get_provider()
    try:
        await provider.cancel(job.google_job_name)
    except Exception as exc:
        _log(f"batch_gen: cancel failed for {job_id}: {exc}")
        raise HTTPException(422, f"Cancel failed: {exc}")

    job.state = JobState.CANCELLED
    job.updated_at = datetime.now(timezone.utc)
    await _store.upsert(job)
    return CancelResponse(state=JobState.CANCELLED)
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `python -m pytest tests/test_batch_gen_routes.py -v`
Expected: 6 passed.

- [ ] **Step 4.5: Run the full backend test suite to catch regressions**

Run: `python -m pytest`
Expected: all existing tests still pass + new tests pass.

- [ ] **Step 4.6: Commit**

```bash
git add src/plugins/batch_gen.py tests/test_batch_gen_routes.py
git commit -m "[feat] batch_gen: /api/batch/{submit,jobs,cancel} routes"
```

---

### Task 5: Wire poller into FastAPI lifespan

**Files:**
- Modify: `src/api.py`

- [ ] **Step 5.1: Modify `src/api.py` to start/stop the poller**

Open `src/api.py` and update the lifespan function. The full new `lifespan` block:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    _log("AYCB backend ready")
    if not settings.media_dir.exists():
        try:
            settings.media_dir.mkdir(parents=True, exist_ok=True)
            _log(f"Created shared media dir: {settings.media_dir}")
        except Exception as e:
            _log(f"WARNING: shared media dir not available: {e}")
    from src.review_hub.app import rh_startup
    await rh_startup()

    # ── Batch generation poller ──
    from src.plugins.batch_gen import _get_provider, get_store
    from src.batch_gen.poller import BatchPoller
    try:
        provider = _get_provider()
        poller = BatchPoller(
            store=get_store(),
            provider=provider,
            media_dir=settings.media_dir,
        )
        poller.start()
        app.state.batch_poller = poller
    except Exception as e:
        _log(f"batch_gen: poller NOT started (missing API key?): {e}")
        app.state.batch_poller = None

    yield

    # ── Shutdown ──
    poller = getattr(app.state, "batch_poller", None)
    if poller:
        await poller.stop()
```

- [ ] **Step 5.2: Restart backend and verify poller logs the "started" line**

In one terminal:
```bash
python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload
```
Expected output to contain `batch_gen: poller started`.

If `AYCB_GEMINI_API_KEY` is missing in `.env`, expect `batch_gen: poller NOT started` instead — that's acceptable.

- [ ] **Step 5.3: Hit the endpoints with curl to verify wire-up**

```bash
curl http://localhost:5101/api/batch/jobs
```
Expected: `{"jobs":[]}` (HTTP 200).

- [ ] **Step 5.4: Commit**

```bash
git add src/api.py
git commit -m "[feat] batch_gen: spawn poller in FastAPI lifespan"
```

---

### Task 6: Smoke script for empirical end-to-end verification

**Files:**
- Create: `scripts/smoke_batch_node.py`

- [ ] **Step 6.1: Create `scripts/smoke_batch_node.py`**

```python
"""End-to-end smoke test for the batch_gen plugin.

Submits ONE real Gemini Pro 2K request via /api/batch/submit, polls
/api/batch/jobs until SUCCEEDED, verifies the resulting PNG exists in
shared/Media with tEXt metadata, and prints discounted cost.

Required: backend running on localhost:5101 with AYCB_GEMINI_API_KEY set.

Run:
    python scripts/smoke_batch_node.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import requests

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from config.settings import settings  # noqa: E402

API = "http://localhost:5101"
TIMEOUT_MIN = 30  # batch jobs usually complete in <10 min


def main() -> int:
    print("=== batch_gen smoke test ===")

    # Submit
    payload = {
        "node_id": "smoke-test",
        "model": "gemini-3-pro-image-preview",
        "requests": [{
            "key": "smoke-r0",
            "prompt": "A vintage typewriter on a wooden desk, soft window light, shallow depth of field",
            "refs_b64": [],
            "refs_mime": [],
            "aspect_ratio": "16:9",
            "resolution": "2K",
            "thinking": False,
            "grounding": False,
        }],
    }
    print("Submitting...")
    r = requests.post(f"{API}/api/batch/submit", json=payload, timeout=30)
    if r.status_code != 200:
        print(f"FAIL submit: HTTP {r.status_code} {r.text}")
        return 2
    sub = r.json()
    job_id = sub["job_id"]
    print(f"  job_id={job_id}  estimate=${sub['cost_estimate']:.4f}")

    # Poll
    print(f"Polling /api/batch/jobs (up to {TIMEOUT_MIN}m)...")
    deadline = time.time() + TIMEOUT_MIN * 60
    while time.time() < deadline:
        r = requests.get(f"{API}/api/batch/jobs?node_id=smoke-test", timeout=30)
        jobs = r.json().get("jobs", [])
        job = next((j for j in jobs if j["id"] == job_id), None)
        if not job:
            print("FAIL: job missing from /jobs")
            return 3
        state = job["state"]
        print(f"  state={state}")
        if state == "succeeded":
            results = job.get("results", [])
            if not results:
                print("FAIL: succeeded but no results")
                return 4
            media_path = results[0].get("media_path")
            cost = results[0].get("cost", 0.0)
            print(f"  media_path={media_path}  cost=${cost:.4f}")
            abs_path = settings.shared_root / media_path
            if not abs_path.exists():
                print(f"FAIL: file not on disk: {abs_path}")
                return 5
            print(f"  PNG size: {abs_path.stat().st_size // 1024} KB")
            print("PASS")
            return 0
        if state in ("failed", "cancelled", "expired"):
            print(f"FAIL: terminal state {state} — error={job.get('error')!r}")
            return 6
        time.sleep(15)
    print(f"FAIL: timed out after {TIMEOUT_MIN}m")
    return 7


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6.2: Run the smoke test (requires API key in `.env`)**

Run: `python scripts/smoke_batch_node.py`
Expected: PASS within ~10 minutes, or a clear FAIL line if Google API misbehaves.

Skip this step if `AYCB_GEMINI_API_KEY` is not set — backend tests already cover the routes with mocks.

- [ ] **Step 6.3: Commit**

```bash
git add scripts/smoke_batch_node.py
git commit -m "[test] batch_gen: end-to-end smoke script"
```

---

### Task 7: Frontend types + node manifest

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/nodes/generate-image-batch/node.manifest.ts`

- [ ] **Step 7.1: Add `GenerateImageBatchNodeData` to `frontend/src/types.ts`**

Find the existing `GenerateImageNodeData` definition and add immediately below:

```typescript
export interface BatchPendingRequest {
  key: string
  prompt: string
  refs_b64: string[]
  refs_mime: string[]
  aspect_ratio: string
  resolution: string
  thinking: boolean
  grounding: boolean
  added_at: number
}

export interface BatchJobView {
  id: string
  google_job_name: string
  node_id: string
  model: string
  submitted_at: string
  updated_at: string
  state: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
  requests: { key: string; prompt: string }[]
  results: { request_key: string; media_path: string | null; media_id: string | null; cost: number; error: string | null }[]
  cost_estimate: number
  error: string | null
}

export interface GenerateImageBatchNodeData {
  prompt: string
  selectedModel: string
  aspectRatio: string
  resolution: string
  thinking?: boolean
  grounding?: boolean
  bundleN?: number
  bundleT?: number
  pending?: BatchPendingRequest[]   // local-only, not persisted across reload
  knownResultIds?: string[]         // result media_ids already emitted
}
```

- [ ] **Step 7.2: Create `frontend/src/nodes/generate-image-batch/node.manifest.ts`**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'generateImageBatch',
  label: 'Generate Image Batch',
  icon: '≡',
  category: 'media-model',
  description: 'Async batch image generation via Gemini Batch API (50% discount, up to 24h SLA)',
  defaultData: {
    prompt: '',
    selectedModel: 'gemini-3-pro-image-preview',
    aspectRatio: '16:9',
    resolution: '2K',
    bundleN: 5,
    bundleT: 30,
    pending: [],
    knownResultIds: [],
  },
  inputs: [
    { type: 'prompt', handleId: 'prompt-in' },
    { type: 'image', handleId: 'image-0' },
  ],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
```

- [ ] **Step 7.3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7.4: Commit**

```bash
git add frontend/src/types.ts frontend/src/nodes/generate-image-batch/node.manifest.ts
git commit -m "[feat] batch_gen: frontend types + node manifest"
```

---

### Task 8: Frontend hook — bundle queue, auto-submit, polling, recovery (TDD)

**Files:**
- Create: `frontend/src/nodes/generate-image-batch/useGenerateImageBatch.ts`
- Test: `frontend/src/nodes/generate-image-batch/generate-image-batch.test.ts`

- [ ] **Step 8.1: Write failing tests for the hook**

Create `frontend/src/nodes/generate-image-batch/generate-image-batch.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import manifest from './node.manifest'
import { useGenerateImageBatch } from './useGenerateImageBatch'

describe('generate-image-batch manifest', () => {
  it('exports a valid manifest', () => {
    expect(manifest.type).toBe('generateImageBatch')
    expect(manifest.category).toBe('media-model')
    expect(manifest.inputs.some(i => i.handleId === 'prompt-in')).toBe(true)
    expect(manifest.outputs.some(o => o.handleId === 'image-out')).toBe(true)
  })

  it('defaults bundleN=5 and bundleT=30', () => {
    expect(manifest.defaultData?.bundleN).toBe(5)
    expect(manifest.defaultData?.bundleT).toBe(30)
  })
})

describe('useGenerateImageBatch — bundle queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('/api/batch/submit')) {
        return { ok: true, status: 200, json: async () => ({
          job_id: 'job-1', google_job_name: 'batches/x', state: 'running',
          count: 1, cost_estimate: 0.067,
        }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/batch/jobs')) {
        return { ok: true, status: 200, json: async () => ({ jobs: [] }) } as any
      }
      return { ok: false, status: 404 } as any
    }) as any
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('addToBundle enqueues with snapshot of current settings', () => {
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'cat', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    act(() => { result.current.addToBundle() })
    expect(result.current.pending.length).toBe(1)
    expect(result.current.pending[0].prompt).toBe('cat')
    expect(result.current.pending[0].resolution).toBe('2K')
  })

  it('auto-submits when pending reaches bundleN', async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 2, bundleT: 30,
    }, false))
    act(() => { result.current.addToBundle() })
    act(() => { result.current.addToBundle() })
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/batch/submit'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(result.current.pending.length).toBe(0)
  })

  it('auto-submits after bundleT seconds idle', async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 99, bundleT: 5,
    }, false))
    act(() => { result.current.addToBundle() })
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/batch/submit'),
      expect.anything(),
    )
    await act(async () => { vi.advanceTimersByTime(5000) })
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/batch/submit'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('submitNow forces submit regardless of count', async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 99, bundleT: 99,
    }, false))
    act(() => { result.current.addToBundle() })
    await act(async () => { await result.current.submitNow() })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/batch/submit'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('hydrates jobs on mount via GET /api/batch/jobs', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/batch/jobs')) {
        return { ok: true, status: 200, json: async () => ({ jobs: [
          { id: 'j1', google_job_name: 'batches/x', node_id: 'node-A',
            model: 'gemini-3-pro-image-preview',
            submitted_at: '2026-05-18T10:00:00Z',
            updated_at: '2026-05-18T10:00:00Z',
            state: 'running', requests: [], results: [], cost_estimate: 0.06, error: null },
        ] }) } as any
      }
      return { ok: false, status: 404 } as any
    }) as any
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: '', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    await waitFor(() => expect(result.current.jobs.length).toBe(1))
    expect(result.current.jobs[0].id).toBe('j1')
  })

  it('cancel calls DELETE and updates job state locally', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('/api/batch/jobs') && init?.method === 'DELETE') {
        return { ok: true, status: 200, json: async () => ({ state: 'cancelled' }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/batch/jobs')) {
        return { ok: true, status: 200, json: async () => ({ jobs: [
          { id: 'j1', google_job_name: 'batches/x', node_id: 'node-A',
            model: 'gemini-3-pro-image-preview',
            submitted_at: '2026-05-18T10:00:00Z',
            updated_at: '2026-05-18T10:00:00Z',
            state: 'running', requests: [], results: [], cost_estimate: 0.06, error: null },
        ] }) } as any
      }
      return { ok: false, status: 404 } as any
    })
    global.fetch = fetchSpy as any
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: '', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    await waitFor(() => expect(result.current.jobs.length).toBe(1))
    await act(async () => { await result.current.cancelJob('j1') })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/batch/jobs/j1'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/nodes/generate-image-batch/`
Expected: Cannot find module `./useGenerateImageBatch`.

- [ ] **Step 8.3: Implement `frontend/src/nodes/generate-image-batch/useGenerateImageBatch.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BatchJobView,
  BatchPendingRequest,
  GenerateImageBatchNodeData,
} from '../../types'

const API = ''   // same origin via Vite proxy
const POLL_MS = 10_000

interface SubmitResponse {
  job_id: string
  google_job_name: string
  state: 'running'
  count: number
  cost_estimate: number
}

/**
 * Bundle queue + auto-submit + recovery + polling for the Generate Image Batch node.
 *
 * - addToBundle: snapshot current settings into pending[], (re)arms idle timer.
 * - When pending.length >= bundleN → submit immediately.
 * - When idle for bundleT seconds → submit.
 * - submitNow: manual override.
 * - On mount: GET /api/batch/jobs?node_id=X (recovery).
 * - While any job is running: poll every POLL_MS.
 */
export function useGenerateImageBatch(
  nodeId: string,
  data: GenerateImageBatchNodeData,
  _selected: boolean,
) {
  const [pending, setPending] = useState<BatchPendingRequest[]>(data.pending ?? [])
  const [jobs, setJobs] = useState<BatchJobView[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchRef = useRef(typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : fetch)
  const abortRef = useRef<AbortController | null>(null)

  const bundleN = data.bundleN ?? 5
  const bundleT = data.bundleT ?? 30

  // ── submit helper ──
  const doSubmit = useCallback(async (reqs: BatchPendingRequest[]) => {
    if (reqs.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        node_id: nodeId,
        model: data.selectedModel,
        requests: reqs.map(r => ({
          key: r.key,
          prompt: r.prompt,
          refs_b64: r.refs_b64,
          refs_mime: r.refs_mime,
          aspect_ratio: r.aspect_ratio,
          resolution: r.resolution,
          thinking: r.thinking,
          grounding: r.grounding,
        })),
      }
      const resp = await fetchRef.current(`${API}/api/batch/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${txt}`)
      }
      const sub: SubmitResponse = await resp.json()
      setPending(prev => prev.filter(p => !reqs.find(r => r.key === p.key)))
      // Trigger immediate refresh of the jobs list (post-submit hydrate).
      void refreshJobs()
      return sub
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }, [nodeId, data.selectedModel])

  // ── idle timer ──
  const armIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      setPending(prev => {
        if (prev.length > 0) void doSubmit(prev)
        return prev
      })
    }, bundleT * 1000)
  }, [bundleT, doSubmit])

  // ── public API ──
  const addToBundle = useCallback(() => {
    const snapshot: BatchPendingRequest = {
      key: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: data.prompt,
      refs_b64: [],
      refs_mime: [],
      aspect_ratio: data.aspectRatio,
      resolution: data.resolution,
      thinking: data.thinking ?? false,
      grounding: data.grounding ?? false,
      added_at: Date.now(),
    }
    setPending(prev => {
      const next = [...prev, snapshot]
      if (next.length >= bundleN) {
        void doSubmit(next)
        return next   // doSubmit will clear after server response
      }
      return next
    })
    armIdleTimer()
  }, [data.prompt, data.aspectRatio, data.resolution, data.thinking, data.grounding, bundleN, doSubmit, armIdleTimer])

  const submitNow = useCallback(async () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    await doSubmit(pending)
  }, [doSubmit, pending])

  const clearPending = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    setPending([])
  }, [])

  const refreshJobs = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const resp = await fetchRef.current(
        `${API}/api/batch/jobs?node_id=${encodeURIComponent(nodeId)}`,
        { signal: ctrl.signal },
      )
      if (!resp.ok) return
      const body = await resp.json()
      setJobs(body.jobs ?? [])
    } catch {
      // aborted or transient — ignore
    }
  }, [nodeId])

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      await fetchRef.current(`${API}/api/batch/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      })
    } finally {
      void refreshJobs()
    }
  }, [refreshJobs])

  // ── effects: hydrate on mount + poll while any running ──
  useEffect(() => {
    void refreshJobs()
    return () => {
      abortRef.current?.abort()
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [refreshJobs])

  useEffect(() => {
    const hasRunning = jobs.some(j => j.state === 'running')
    if (!hasRunning) return
    const id = setInterval(() => { void refreshJobs() }, POLL_MS)
    return () => clearInterval(id)
  }, [jobs, refreshJobs])

  return {
    pending,
    jobs,
    submitting,
    error,
    addToBundle,
    submitNow,
    clearPending,
    cancelJob,
    refreshJobs,
  }
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/nodes/generate-image-batch/`
Expected: all tests passing.

- [ ] **Step 8.5: Commit**

```bash
git add frontend/src/nodes/generate-image-batch/useGenerateImageBatch.ts frontend/src/nodes/generate-image-batch/generate-image-batch.test.ts
git commit -m "[feat] batch_gen: useGenerateImageBatch hook with bundle queue + polling"
```

---

### Task 9: Frontend component — GenerateImageBatchNode

**Files:**
- Create: `frontend/src/nodes/generate-image-batch/GenerateImageBatchNode.tsx`

- [ ] **Step 9.1: Create the component**

```typescript
import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useReactFlow } from '@xyflow/react'
import type { GenerateImageBatchNodeData } from '../../types'
import { useGenerateImageBatch } from './useGenerateImageBatch'
import styles from '../_shared/Node.module.css'

type GenerateImageBatchNodeType = Node<GenerateImageBatchNodeData, 'generateImageBatch'>

const MODELS = [
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', price: '$0.067 (batch)' },
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', price: '$0.034 (batch)' },
  { id: 'gemini-3.1-flash-lite-image-preview', name: 'Flash-Lite Image', price: '$0.020 (batch)' },
]

export function GenerateImageBatchNode({ id, data, selected }: NodeProps<GenerateImageBatchNodeType>) {
  const { setNodes } = useReactFlow()
  const h = useGenerateImageBatch(id, data, !!selected)

  const updateNodeData = (patch: Partial<GenerateImageBatchNodeData>) => {
    setNodes(nodes => nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  }

  return (
    <NodeShell
      name="Generate Image Batch"
      selected={selected}
      icon="≡"
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        { id: 'image-0', label: 'Ref 1', type: 'image' },
      ]}
      outputSlots={[{ id: 'image-out', label: 'Output', type: 'image' }]}
      onRun={h.addToBundle}
      running={h.submitting}
      lastCost={null}
      estimatedCost={null}
    >
      <div className={styles.nodeContent}>
        <select
          className={styles.select}
          value={data.selectedModel}
          onChange={e => updateNodeData({ selectedModel: e.target.value })}
        >
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.name} ({m.price})</option>)}
        </select>

        <div className={styles.arResRow}>
          <select
            className={styles.selectSmall}
            value={data.aspectRatio}
            onChange={e => updateNodeData({ aspectRatio: e.target.value })}
          >
            {['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            className={styles.selectSmall}
            value={data.resolution}
            onChange={e => updateNodeData({ resolution: e.target.value })}
          >
            {['1K', '2K', '4K'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className={styles.arResRow}>
          <label className={styles.bundleLabel}>N
            <input type="number" min={1} max={100}
              className={styles.bundleInput}
              value={data.bundleN ?? 5}
              onChange={e => updateNodeData({ bundleN: parseInt(e.target.value) || 5 })}
              title="Auto-submit when pending count reaches N"
            />
          </label>
          <label className={styles.bundleLabel}>T
            <input type="number" min={5} max={600}
              className={styles.bundleInput}
              value={data.bundleT ?? 30}
              onChange={e => updateNodeData({ bundleT: parseInt(e.target.value) || 30 })}
              title="Auto-submit after T seconds idle"
            />s
          </label>
          <button
            className={styles.submitNowBtn}
            disabled={h.pending.length === 0 || h.submitting}
            onClick={() => void h.submitNow()}
            title="Submit pending bundle immediately"
          >Submit now ({h.pending.length})</button>
        </div>

        <textarea
          className={styles.promptTextarea}
          value={data.prompt}
          onChange={e => updateNodeData({ prompt: e.target.value })}
          placeholder="Write your prompt here..."
          rows={3}
          spellCheck={false}
        />

        {h.error && <p className={styles.error}>{h.error}</p>}

        {h.jobs.length > 0 && (
          <div className={styles.jobsList}>
            {h.jobs.map(j => (
              <div key={j.id} className={`${styles.jobPill} ${styles[`jobPill_${j.state}`] ?? ''}`}>
                <span className={styles.jobId}>{j.id.slice(0, 6)}</span>
                <span className={styles.jobMeta}>{j.requests.length} reqs</span>
                <span className={styles.jobState}>{j.state}</span>
                {j.state === 'running' && (
                  <button
                    className={styles.jobCancel}
                    onClick={() => void h.cancelJob(j.id)}
                    title="Cancel job"
                  >x</button>
                )}
                {j.error && <span className={styles.jobError} title={j.error}>!</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(GenerateImageBatchNode)
```

- [ ] **Step 9.2: Add CSS class fragments to `Node.module.css`**

Open `frontend/src/nodes/_shared/Node.module.css` and append:

```css
.bundleLabel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-secondary);
}
.bundleInput {
  width: 36px;
  padding: 2px 4px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: 11px;
  border-radius: 2px;
}
.submitNowBtn {
  padding: 2px 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: 11px;
  cursor: pointer;
  border-radius: 2px;
}
.submitNowBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.jobsList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}
.jobPill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  font-size: 10px;
  color: var(--color-text-secondary);
  border-radius: 2px;
}
.jobPill_failed   { border-color: var(--color-error); }
.jobPill_succeeded{ border-color: var(--color-success); }
.jobPill_cancelled{ opacity: 0.5; }
.jobPill_expired  { opacity: 0.5; }
.jobId    { font-family: ui-monospace, monospace; color: var(--color-text-primary); }
.jobMeta  { color: var(--color-text-secondary); }
.jobState { margin-left: auto; }
.jobCancel {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 10px;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.jobError { color: var(--color-warning); cursor: help; }
```

- [ ] **Step 9.3: Verify TypeScript + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no TS errors, all tests pass.

- [ ] **Step 9.4: Verify the node appears in the canvas**

Start frontend (`cd frontend && npm run dev`), open `http://localhost:5100`, right-click the canvas → AddNodeMenu should show "Generate Image Batch" under Media Model. Add it, type a prompt, click Run — `pending` count should increment.

- [ ] **Step 9.5: Commit**

```bash
git add frontend/src/nodes/generate-image-batch/GenerateImageBatchNode.tsx frontend/src/nodes/_shared/Node.module.css
git commit -m "[feat] batch_gen: GenerateImageBatchNode component + CSS"
```

---

### Task 10: Final integration — run smoke through the UI

**Files:** none (manual verification)

- [ ] **Step 10.1: With backend + frontend running, add the new node to the canvas**

1. Click Run 5 times on the new node with a prompt → should auto-submit (pending=5 reaches bundleN=5).
2. Verify a pill appears showing the job in `running` state.
3. Wait for completion (typically <10m for one Gemini Pro 2K request); pill → `succeeded`.
4. Verify the result image appears in Review Hub gallery at `http://localhost:5100/review`.
5. Refresh the page mid-wait; on reload the pill should reappear from `/api/batch/jobs` (recovery).

- [ ] **Step 10.2: Run full test suites one more time**

```bash
python -m pytest
cd frontend && npx vitest run && npx tsc --noEmit
```
Expected: all green.

- [ ] **Step 10.3: Final commit (if any catch-up changes)**

```bash
git add -A
git commit -m "[feat] batch_gen: integration polish"
```

---

## Self-review

**Spec coverage check (against `docs/superpowers/specs/2026-05-18-generate-image-batch-node-design.md`):**

- "New node `Generate Image Batch`" — Task 7, 9
- "Backend plugin auto-discovered" — Task 4
- "State file `shared/data/batch-jobs.json` with atomic write" — Task 1
- "Corrupt recovery (backup + reset)" — Task 1 (test) + store implementation
- "Lifespan asyncio poller (10s)" — Task 3, 5
- "Recovery: backend re-polls running on startup" — Task 5 (poller picks them up on first tick since they're in store)
- "Recovery: frontend rehydrate on mount" — Task 8 (useEffect refreshJobs on mount)
- "Models: Pro / Flash / Flash-Lite" — Task 4 (Literal), Task 9 (MODELS dropdown)
- "Auto-bundle N + T configurable" — Task 8 (hook), Task 9 (UI inputs)
- "Manual Submit now" — Task 8 (submitNow), Task 9 (button)
- "Per-request snapshot at add time" — Task 8 (addToBundle captures props into snapshot)
- "Cancel" — Task 4 (route), Task 8 (cancelJob), Task 9 (per-pill button)
- "Upstream errors → 422" — Task 4 (test + handler)
- "Output emits each completed result on image-out" — partially covered: the new images land in shared/Media/ and the bridge picks them up, but explicit output emission on `image-out` is deferred to future work. This is consistent with the spec's "uses existing genimage per-id emission infra" — adding it requires touching shared canvas emission code which isn't trivial. v1 acceptance: result visible in Review Hub gallery; downstream wiring deferred.
- "GPT Image 2 deferred to v1.1" — confirmed: model literal only includes Gemini variants
- "Memo feedback_gemini_thinking_imagesize" — Task 2 (test + provider)
- "PNG tEXt metadata for provenance" — Task 2 (parse_result_line)
- "Never except: pass" — Task 1 (corrupt handler logs), Task 3 (per-job try/except logs and continues)

**Gap:** Output emission on `image-out` was deferred. Adding a TODO to v1.1 list:

> v1 ships with results landing in Review Hub gallery + node's job list. v1.1 will wire `image-out` to the most recent succeeded result's `media_id` so downstream nodes can pick it up. This needs reading the existing `useGenerateImage` emission pattern in detail and was out of scope for this plan to keep it under 10 tasks.

**Placeholder scan:** No TBD/TODO/"implement later". Every step has concrete code or a runnable command. The deferred output-emit wiring is called out explicitly.

**Type consistency:**
- `BatchJob`, `BatchRequest`, `BatchResult`, `JobState` defined in Task 1, used consistently in Tasks 2-5.
- `BatchJobView` (frontend mirror) defined in Task 7, used in Task 8 hook + Task 9 component.
- `useGenerateImageBatch` return shape defined in Task 8, consumed in Task 9 (`h.pending`, `h.jobs`, `h.addToBundle`, etc.).
- `_store` and `_get_provider` are module-level in Task 4, monkeypatched in tests, used in lifespan in Task 5.
- Route paths consistent: `/api/batch/submit`, `/api/batch/jobs`, `/api/batch/jobs/{id}` everywhere.

All consistent.
