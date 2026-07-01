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
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gemini-3.1-flash-lite-image",
    ]
    submitted_at: datetime
    updated_at: datetime
    state: JobState
    requests: list[BatchRequest]
    results: list[BatchResult] = Field(default_factory=list)
    cost_estimate: float = 0.0  # discounted total expected cost
    error: str | None = None
