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


# ── Submit ──────────────────────────────────────────────────────────────────

def _build_image(image_bytes: bytes, filename: str) -> Any:
    """Wrap raw bytes in a google.genai Image with inferred mime type."""
    from google.genai import types
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "webp": "image/webp", "png": "image/png"}.get(ext, "image/png")
    return types.Image(image_bytes=image_bytes, mime_type=mime)


def _build_config(
    aspect_ratio: str, duration: int, quality: str,
    last_frame: Any | None = None,
    reference_images: list[Any] | None = None,
) -> Any:
    from google.genai import types
    return types.GenerateVideosConfig(
        aspect_ratio=aspect_ratio,
        duration_seconds=duration,
        resolution=quality if quality in ("720p", "1080p") else "720p",
        number_of_videos=1,
        generate_audio=True,
        person_generation="allow_adult",
        last_frame=last_frame,
        reference_images=reference_images or [],
    )


def _submit_sync(
    vertex_model: str, prompt: str, config: Any, image: Any | None,
) -> Any:
    """Run the blocking SDK call. Returns the Operation."""
    client = get_vertex_client()
    kwargs: dict[str, Any] = {"model": vertex_model, "prompt": prompt, "config": config}
    if image is not None:
        kwargs["image"] = image
    logger.info("Veo submit: model=%s prompt=%s", vertex_model, prompt[:80])
    try:
        return client.models.generate_videos(**kwargs)
    except Exception as exc:
        raise VertexVideoGenError(f"Vertex submit failed: {exc}") from exc


async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 8, quality: str = "720p",
    **_kwargs: Any,
) -> dict[str, Any]:
    """Submit a T2V request. `api_key` is ignored (Vertex uses GCP creds)."""
    info = get_model_info(model_id)
    config = _build_config(aspect_ratio, duration, quality)
    op = await asyncio.to_thread(_submit_sync, info["vertex_model"], prompt, config, None)
    return {"request_id": op.name, "status": "pending"}


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    ref_video_bytes: tuple[str, bytes] | None = None,
    audio_url: str = "",
    aspect_ratio: str = "16:9", duration: int = 8, quality: str = "720p",
    **_kwargs: Any,
) -> dict[str, Any]:
    """Submit an I2V / multi-ref request.

    Mode selection based on image count:
      0 refs -> text-to-video
      1 ref  -> I2V first frame
      2 refs -> first frame + last_frame interpolation
      3+ refs -> first frame + reference_images (up to 3, extras ignored)

    Video refs and audio URL are not supported by Veo and are logged as ignored.
    """
    if ref_video_bytes:
        logger.warning("Veo does not support video references; ignored")
    if audio_url:
        logger.warning("Veo generates audio internally; audio URL ignored")

    if not ref_image_bytes:
        return await submit_text_to_video(
            api_key, model_id, prompt, aspect_ratio, duration, quality,
        )

    info = get_model_info(model_id)

    first_name, first_bytes = ref_image_bytes[0]
    image = _build_image(first_bytes, first_name)

    last_frame = None
    reference_images: list[Any] = []

    if len(ref_image_bytes) == 2:
        last_name, last_bytes = ref_image_bytes[1]
        last_frame = _build_image(last_bytes, last_name)
    elif len(ref_image_bytes) >= 3:
        from google.genai import types as _types
        for name, data in ref_image_bytes[: info["max_ref_images"]]:
            reference_images.append(
                _types.VideoGenerationReferenceImage(
                    image=_build_image(data, name),
                    reference_type=_types.VideoGenerationReferenceType.ASSET,
                )
            )

    config = _build_config(
        aspect_ratio, duration, quality,
        last_frame=last_frame,
        reference_images=reference_images,
    )

    op = await asyncio.to_thread(
        _submit_sync, info["vertex_model"], prompt, config, image,
    )
    return {"request_id": op.name, "status": "pending"}
