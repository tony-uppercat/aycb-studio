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

# Module-level singletons (monkeypatched by tests)
_store: BatchStore = BatchStore(settings.shared_root / "data" / "batch-jobs.json")
_provider_cache: GeminiBatchProvider | None = None


def _get_provider() -> GeminiBatchProvider:
    global _provider_cache
    if _provider_cache is None:
        if not settings.gemini_api_key:
            raise HTTPException(422, "Missing AYCB_GEMINI_API_KEY in .env")
        from google import genai  # lazy import; tests monkeypatch this function
        client = genai.Client(api_key=settings.gemini_api_key)
        scratch = settings.shared_root / "data" / "batch_scratch"
        _provider_cache = GeminiBatchProvider(client=client, scratch_dir=scratch)
    return _provider_cache


def get_store() -> BatchStore:
    """Public accessor used by the lifespan to wire the poller."""
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
