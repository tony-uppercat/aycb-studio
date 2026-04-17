"""Video generation API client — Veo 3.1 via Google Gemini API.

The file is named ``vertex_video_gen`` for historical reasons; the initial
implementation used Vertex AI. Veo 3.1 is now invoked through the Gemini
Developer API with a simple API key (``AYCB_GEMINI_KEY``) — no gcloud /
ADC / GCP project required. See the companion ``src/vertex_client.py``
which still powers Imagen edit via Vertex.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

from config.settings import settings

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


_ALLOWED_DURATIONS = (4, 6, 8)


def _snap_duration(duration: int, has_refs: bool, quality: str = "720p") -> int:
    """Gemini API only accepts 4, 6, or 8 seconds.
    Refs/interpolation and 1080p/4k require 8s per official docs.
    """
    if has_refs or quality in ("1080p", "4k"):
        return 8
    return min(_ALLOWED_DURATIONS, key=lambda d: abs(d - duration))


def _build_config(
    aspect_ratio: str, duration: int, quality: str,
    last_frame: Any | None = None,
    reference_images: list[Any] | None = None,
    has_image: bool = False,
    seed: int = -1,
) -> Any:
    """Assemble a GenerateVideosConfig for Gemini API.

    person_generation note: docs list "allow_all" for T2V and "allow_adult"
    for image/interp/refs, but EU/UK/CH/MENA force "allow_adult" across the
    board. We default to "allow_adult" which is accepted in every region
    and for every mode.
    """
    from google.genai import types
    has_refs = has_image or last_frame is not None or bool(reference_images)
    snapped = _snap_duration(duration, has_refs, quality)
    kwargs: dict[str, Any] = {
        "aspect_ratio": aspect_ratio,
        "duration_seconds": snapped,
        "resolution": quality if quality in ("720p", "1080p") else "720p",
        "number_of_videos": 1,
        "person_generation": "allow_adult",
    }
    if last_frame is not None:
        kwargs["last_frame"] = last_frame
    if reference_images:
        kwargs["reference_images"] = reference_images
    if seed is not None and seed >= 0:
        kwargs["seed"] = seed
    return types.GenerateVideosConfig(**kwargs)


def _get_client(api_key: str) -> Any:
    """Build a fresh genai client for the Gemini Developer API."""
    from google import genai
    return genai.Client(api_key=api_key)


def _submit_sync(
    api_key: str, vertex_model: str, prompt: str, config: Any, image: Any | None,
) -> Any:
    """Run the blocking SDK call. Returns the Operation."""
    client = _get_client(api_key)
    kwargs: dict[str, Any] = {"model": vertex_model, "prompt": prompt, "config": config}
    if image is not None:
        kwargs["image"] = image
    logger.info("Veo submit: model=%s prompt=%s", vertex_model, prompt[:80])
    try:
        return client.models.generate_videos(**kwargs)
    except Exception as exc:
        raise VertexVideoGenError(f"Veo submit failed: {exc}") from exc


async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 8, quality: str = "720p",
    seed: int = -1,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Submit a T2V request. `api_key` is ignored (Vertex uses GCP creds)."""
    info = get_model_info(model_id)
    config = _build_config(aspect_ratio, duration, quality, seed=seed)
    op = await asyncio.to_thread(
        _submit_sync, api_key, info["vertex_model"], prompt, config, None,
    )
    return {"request_id": op.name, "status": "pending"}


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    ref_video_bytes: tuple[str, bytes] | None = None,
    audio_url: str = "",
    aspect_ratio: str = "16:9", duration: int = 8, quality: str = "720p",
    seed: int = -1,
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
            api_key, model_id, prompt, aspect_ratio, duration, quality, seed,
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
        has_image=True,
        seed=seed,
    )

    op = await asyncio.to_thread(
        _submit_sync, api_key, info["vertex_model"], prompt, config, image,
    )
    return {"request_id": op.name, "status": "pending"}


# ── Poll / Save ─────────────────────────────────────────────────────────────

def _safe_filename_from_id(request_id: str) -> str:
    """Operation names contain slashes. Flatten to a safe filename stem."""
    return request_id.replace("/", "_").replace("\\", "_")


def _save_video_sync(client: Any, video: Any, request_id: str) -> str:
    """Download bytes (if needed) and save to shared/Media. Returns relative URL."""
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    filename = f"veo_{_safe_filename_from_id(request_id)}.mp4"
    out_path = settings.media_dir / filename
    try:
        client.files.download(file=video)
        video.save(str(out_path))
    except Exception as exc:
        raise VertexVideoGenError(f"Failed to save Veo video: {exc}") from exc
    logger.info("Veo video saved -> %s", out_path)
    return f"/media/{filename}"


def _get_result_sync(api_key: str, request_id: str) -> dict[str, Any]:
    from google.genai import types
    client = _get_client(api_key)
    # SDK expects an Operation object, not a string. Rehydrate from the name.
    op_stub = types.GenerateVideosOperation(name=request_id)
    try:
        op = client.operations.get(op_stub)
    except Exception as exc:
        raise VertexVideoGenError(f"Veo operation lookup failed: {exc}") from exc

    if not op.done:
        return {"request_id": request_id, "status": "processing", "url": "", "error": ""}

    if getattr(op, "error", None):
        return {"request_id": request_id, "status": "failed",
                "url": "", "error": str(op.error)}

    response = getattr(op, "response", None)
    videos = getattr(response, "generated_videos", None) if response else None
    if not videos:
        raise VertexVideoGenError("Veo operation done but no video returned")

    url = _save_video_sync(client, videos[0].video, request_id)
    return {"request_id": request_id, "status": "completed", "url": url, "error": ""}


async def get_result(api_key: str, request_id: str) -> dict[str, Any]:
    """Poll a Veo operation. On completion, saves bytes locally and returns URL."""
    return await asyncio.to_thread(_get_result_sync, api_key, request_id)


async def wait_for_completion(
    api_key: str, request_id: str,
    poll_interval: float = POLL_INTERVAL, timeout: float = POLL_TIMEOUT,
) -> dict[str, Any]:
    """Poll until done or timeout. Matches the shape of other providers."""
    start = time.monotonic()
    while True:
        result = await get_result(api_key, request_id)
        if result["status"] == "completed":
            return result
        if result["status"] == "failed":
            raise VertexVideoGenError(
                f"Veo generation failed: {result.get('error', 'Unknown')}"
            )
        if time.monotonic() - start > timeout:
            raise VertexVideoGenError(
                f"Veo generation timed out after {timeout}s (status: {result['status']})"
            )
        await asyncio.sleep(poll_interval)
