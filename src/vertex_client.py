"""Cached Vertex AI genai client — shared by Imagen edit and Veo video."""
from __future__ import annotations

from typing import Any

from config.settings import settings
from src.shared import _log

_client: Any = None


def _create_client() -> Any:
    """Instantiate a new genai.Client for Vertex AI. Lazy import keeps boot fast."""
    from google import genai
    inst = genai.Client(
        vertexai=True,
        project=settings.gcp_project,
        location=settings.gcp_location,
    )
    _log(f"Vertex AI client created - project={settings.gcp_project}, location={settings.gcp_location}")
    return inst


def get_vertex_client() -> Any:
    """Return a cached Vertex AI genai client.

    Raises ValueError if GCP project is unset.
    """
    global _client
    if _client is not None:
        return _client
    if not settings.gcp_project:
        raise ValueError(
            "GCP project is not configured. Set it in Settings > GCP or AYCB_GCP_PROJECT env var."
        )
    try:
        _client = _create_client()
    except Exception as exc:
        _log(f"Vertex AI client creation FAILED - {exc}")
        raise
    return _client


def reset_vertex_client() -> None:
    """Reset the cached client (used in tests and hot-reload)."""
    global _client
    _client = None
