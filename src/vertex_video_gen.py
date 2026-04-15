"""Video generation API client — Veo 3.1 via Google Vertex AI."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

from config.settings import settings
from src.vertex_client import get_vertex_client

logger = logging.getLogger(__name__)

# ── Model registry ──────────────────────────────────────────────────────────

MODELS: dict[str, dict[str, Any]] = {
    "vertex-veo-3.1": {
        "name": "Veo 3.1",
        "vertex_model": "veo-3.1-generate-preview",
        "aspect_ratios": ["16:9", "9:16"],
        "qualities": ["720p", "1080p"],
        "min_duration": 4,
        "max_duration": 8,
        "default_duration": 8,
        "cost_per_sec": {"720p": 0.40, "1080p": 0.40},
        "max_ref_images": 3,
    },
    "vertex-veo-3.1-fast": {
        "name": "Veo 3.1 Fast",
        "vertex_model": "veo-3.1-fast-generate-preview",
        "aspect_ratios": ["16:9", "9:16"],
        "qualities": ["720p"],
        "min_duration": 4,
        "max_duration": 8,
        "default_duration": 8,
        "cost_per_sec": {"720p": 0.15},
        "max_ref_images": 3,
    },
}

POLL_INTERVAL = 10
POLL_TIMEOUT = 600


class VertexVideoGenError(Exception):
    """Raised on Vertex AI video generation errors."""


def get_model_info(model_id: str) -> dict[str, Any]:
    """Look up a Veo model registry entry by ID."""
    if model_id not in MODELS:
        raise VertexVideoGenError(
            f"Unknown Vertex model: {model_id}. Available: {list(MODELS.keys())}"
        )
    return MODELS[model_id]
