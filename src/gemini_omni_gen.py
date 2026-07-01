"""Video generation client — Gemini Omni Flash via the Gemini-native
``interactions`` REST endpoint.

Unlike Veo (``veo_gen.py``) which goes through the google-genai SDK,
Omni Flash is driven by a raw async ``httpx`` POST to
``/v1beta/interactions`` (see ``gemini_omni_helpers.py``). ponytail: we
hit REST directly instead of an SDK ``interactions`` helper because that
method's name/shape is unstable across google-genai versions — a raw POST
is version-proof.

``interactions.create`` BLOCKS until the clip renders (tens of seconds),
so we model the standard submit->poll contract with an in-memory job
table: ``submit_*`` spawns a background asyncio task and returns
immediately; ``get_result`` reads the table. ponytail: ``_JOBS`` is
in-memory and lost on a ``--reload`` restart — acceptable for a 30-120s
render the user is actively waiting on.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
import uuid
from typing import Any

from src.registry import REGISTRY
from src.gemini_omni_helpers import (
    GeminiOmniGenError,
    _extract_video,
    _fetch_file_uri,
    _post_interaction,
    _save_video,
)

logger = logging.getLogger(__name__)

# Poll cadence for get_result / wait_for_completion (job-table lookups).
POLL_INTERVAL = 5
POLL_TIMEOUT = 600

_MIN_DURATION = 3
_MAX_DURATION = 10
_ALLOWED_ASPECT = ("16:9", "9:16")

__all__ = [
    "GeminiOmniGenError",
    "MODELS",
    "get_model_info",
    "submit_text_to_video",
    "submit_with_refs",
    "get_result",
    "wait_for_completion",
]


# ── Model registry ──────────────────────────────────────────────────────────

def _build_models_dict() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for m in REGISTRY.values():
        if m.provider != "gemini" or m.capability != "video":
            continue
        out[m.id] = {
            "name": m.name,
            "provider_model_id": m.provider_model_id,
            "aspect_ratios": list(m.aspect_ratios),
            "qualities": list(m.qualities),
            "min_duration": min(m.allowed_durations) if m.allowed_durations else _MIN_DURATION,
            "max_duration": max(m.allowed_durations) if m.allowed_durations else _MAX_DURATION,
            "default_duration": m.default_duration,
            "cost_per_sec": m.cost_per_sec or {},
            "max_ref_images": m.max_ref_images,
        }
    return out


MODELS: dict[str, dict[str, Any]] = _build_models_dict()

# In-memory submit->poll job table. request_id -> {status, url, error}.
_JOBS: dict[str, dict[str, Any]] = {}


def get_model_info(model_id: str) -> dict[str, Any]:
    if model_id not in MODELS:
        raise GeminiOmniGenError(
            f"Unknown Gemini Omni model: {model_id}. Available: {list(MODELS.keys())}"
        )
    return MODELS[model_id]


# ── Request building / validation ────────────────────────────────────────────

def _mime_for(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "webp": "image/webp", "png": "image/png"}.get(ext, "image/png")


def _validate_aspect(aspect_ratio: str) -> str:
    if aspect_ratio not in _ALLOWED_ASPECT:
        raise GeminiOmniGenError(
            f"Gemini Omni aspect_ratio must be one of {_ALLOWED_ASPECT}; got {aspect_ratio}"
        )
    return aspect_ratio


def _validate_duration(duration: int) -> int:
    # ponytail: Omni allows a contiguous 3..10s range (no discrete snap
    # targets like Veo's 4/6/8), so this is pure validation — raise loudly
    # so the UI surfaces the constraint instead of silently clamping.
    if not (_MIN_DURATION <= duration <= _MAX_DURATION):
        raise GeminiOmniGenError(
            f"Gemini Omni duration must be {_MIN_DURATION}-{_MAX_DURATION}s; got {duration}s"
        )
    return duration


def _build_body(
    model_id: str, prompt: str, aspect_ratio: str, duration: int,
    ref_images: list[tuple[str, str]],
) -> dict[str, Any]:
    """Assemble the interactions request body.

    ``ref_images`` is a list of ``(mime_type, base64_data)`` — empty for T2V,
    one or more for image/reference-to-video.
    """
    info = get_model_info(model_id)
    if not ref_images:
        inp: Any = prompt
        task = "text_to_video"
    else:
        inp = [{"type": "image", "data": b64, "mime_type": mime} for mime, b64 in ref_images]
        inp.append({"type": "text", "text": prompt})
        task = "image_to_video"
    return {
        "model": info["provider_model_id"],
        "input": inp,
        "response_format": {
            "type": "video",
            "aspect_ratio": aspect_ratio,
            "delivery": "uri",
        },
        # ponytail: duration_seconds placement is a best guess — the canonical
        # body schema only specified `task`, but the render needs the length.
        "generation_config": {
            "video_config": {"task": task, "duration_seconds": duration},
        },
    }


# ── Submit (spawns a background render) ───────────────────────────────────────

def _spawn(api_key: str, body: dict[str, Any]) -> dict[str, str]:
    request_id = uuid.uuid4().hex
    _JOBS[request_id] = {"status": "processing", "url": "", "error": ""}
    asyncio.create_task(_run(api_key, request_id, body))
    return {"request_id": request_id, "status": "pending"}


async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 8, quality: str = "720p",
    seed: int = -1, **_kwargs: Any,
) -> dict[str, str]:
    """Submit a text-to-video render. Returns immediately with a pending job."""
    get_model_info(model_id)
    _validate_aspect(aspect_ratio)
    _validate_duration(duration)
    # ponytail: Omni's body schema exposes no seed field, so seed is accepted
    # for router-interface parity but not forwarded.
    body = _build_body(model_id, prompt, aspect_ratio, duration, [])
    logger.info("Omni submit (T2V): model=%s prompt=%s", model_id, prompt[:80])
    return _spawn(api_key, body)


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    aspect_ratio: str = "16:9", duration: int = 8, quality: str = "720p",
    seed: int = -1, **_kwargs: Any,
) -> dict[str, str]:
    """Submit an image/reference-to-video render (up to max_ref_images refs)."""
    if not ref_image_bytes:
        return await submit_text_to_video(
            api_key, model_id, prompt, aspect_ratio, duration, quality, seed,
        )
    info = get_model_info(model_id)
    _validate_aspect(aspect_ratio)
    _validate_duration(duration)
    max_refs = info.get("max_ref_images", 1) or 1
    if len(ref_image_bytes) > max_refs:
        logger.warning(
            "Gemini Omni accepts up to %d reference images; using the first %d, ignoring %d extra",
            max_refs, max_refs, len(ref_image_bytes) - max_refs,
        )
    refs = [(_mime_for(name), base64.b64encode(data).decode("ascii"))
            for name, data in ref_image_bytes[:max_refs]]
    body = _build_body(model_id, prompt, aspect_ratio, duration, refs)
    logger.info("Omni submit (I2V): model=%s refs=%d prompt=%s", model_id, len(refs), prompt[:80])
    return _spawn(api_key, body)


# ── Render worker ─────────────────────────────────────────────────────────────

async def _run(api_key: str, request_id: str, body: dict[str, Any]) -> None:
    """Background render worker. Never raises — records outcome in ``_JOBS``."""
    try:
        data = await _post_interaction(api_key, body)
        video_bytes, uri = _extract_video(data)
        if video_bytes is None and uri:
            video_bytes = await _fetch_file_uri(api_key, uri)
        if not video_bytes:
            raise GeminiOmniGenError("Omni response contained no video data or file uri")
        url = _save_video(video_bytes, request_id)
        _JOBS[request_id] = {"status": "completed", "url": url, "error": ""}
    except Exception as exc:
        # Never `except: pass` — log and surface via the job table.
        logger.error("Omni render failed for %s: %s", request_id, exc)
        _JOBS[request_id] = {"status": "failed", "url": "", "error": str(exc)}


# ── Poll ──────────────────────────────────────────────────────────────────────

async def get_result(api_key: str, request_id: str) -> dict[str, Any]:
    """Read the job table. Unknown ids report 'processing' (submit may be racing)."""
    job = _JOBS.get(request_id)
    if job is None:
        return {"request_id": request_id, "status": "processing", "url": "", "error": ""}
    return {
        "request_id": request_id,
        "status": job["status"],
        "url": job.get("url", ""),
        "error": job.get("error", ""),
    }


async def wait_for_completion(
    api_key: str, request_id: str,
    poll_interval: float = POLL_INTERVAL, timeout: float = POLL_TIMEOUT,
) -> dict[str, Any]:
    """Poll the job table until done or timeout. Mirrors veo_gen."""
    start = time.monotonic()
    while True:
        result = await get_result(api_key, request_id)
        if result["status"] == "completed":
            return result
        if result["status"] == "failed":
            raise GeminiOmniGenError(
                f"Gemini Omni generation failed: {result.get('error', 'Unknown')}"
            )
        if time.monotonic() - start > timeout:
            raise GeminiOmniGenError(
                f"Gemini Omni generation timed out after {timeout}s (status: {result['status']})"
            )
        await asyncio.sleep(poll_interval)
