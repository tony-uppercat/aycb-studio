"""Video generation API client — Kling 3.0 Omni, Seedance 2.0 via PiAPI.ai."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import httpx

from src.registry import REGISTRY

logger = logging.getLogger(__name__)

BASE_URL = "https://api.piapi.ai/api/v1"
UPLOAD_URL = "https://upload.theapi.app/api/ephemeral_resource"

# ── Model registry ──────────────────────────────────────────────────────────
# Derived from src.registry.


def _build_models_dict() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for m in REGISTRY.values():
        if m.provider != "piapi":
            continue
        out[m.id] = {
            "name": m.name,
            "piapi_model": m.provider_model_id,
            "task_type": m.task_type,
            "aspect_ratios": list(m.aspect_ratios),
            "qualities": list(m.qualities),
            "min_duration": min(m.allowed_durations) if m.allowed_durations else 4,
            "max_duration": max(m.allowed_durations) if m.allowed_durations else 15,
            "default_duration": m.default_duration,
            "cost_per_sec": m.cost_per_sec or {},
        }
    return out


MODELS: dict[str, dict[str, Any]] = _build_models_dict()

POLL_INTERVAL = 5
POLL_TIMEOUT = 600


class VideoGenError(Exception):
    """Raised on API errors."""


def get_model_info(model_id: str) -> dict[str, Any]:
    """Get model config by ID."""
    if model_id not in MODELS:
        raise VideoGenError(f"Unknown model: {model_id}. Available: {list(MODELS.keys())}")
    return MODELS[model_id]


# ── File upload ─────────────────────────────────────────────────────────────

async def upload_ephemeral(api_key: str, filename: str, file_bytes: bytes) -> str:
    """Upload a file to PiAPI ephemeral storage. Returns public URL (24h TTL)."""
    b64_data = base64.b64encode(file_bytes).decode()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            UPLOAD_URL,
            json={"file_name": filename, "file_data": b64_data},
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
        )
        if resp.status_code == 403:
            raise VideoGenError(
                "PiAPI file upload requires Creator plan or higher. "
                "Upgrade at piapi.ai/pricing, or use text-to-video without reference images."
            )
        if resp.status_code != 200:
            raise VideoGenError(f"File upload failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        url = data.get("data", {}).get("url")
        if not url:
            raise VideoGenError(f"No URL in upload response: {data}")
        logger.info("Uploaded %s → %s", filename, url[:80])
        return url


# ── Submit helpers ──────────────────────────────────────────────────────────

def _build_kling_input(
    prompt: str, quality: str, duration: int, aspect_ratio: str,
    image_urls: list[str] | None = None, seed: int = -1,
) -> dict[str, Any]:
    """Build input dict for Kling 3.0 Omni.

    When 1-2 images are provided, appends @image_N directives so Kling
    uses them as start/end frames instead of generic references.
    """
    final_prompt = prompt
    if image_urls and len(image_urls) == 1:
        final_prompt = f"{prompt} Use @image_1 as first frame"
    elif image_urls and len(image_urls) == 2:
        final_prompt = f"{prompt} Use @image_1 as first frame, @image_2 as end frame"

    inp: dict[str, Any] = {
        "prompt": final_prompt,
        "version": "3.0",
        "resolution": quality if quality in ("720p", "1080p") else "720p",
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "enable_audio": False,
    }
    if image_urls:
        inp["images"] = image_urls
    if seed is not None and seed >= 0:
        inp["seed"] = seed
    return inp


def _build_seedance_input(
    prompt: str, duration: int, aspect_ratio: str,
    image_urls: list[str] | None = None,
    video_urls: list[str] | None = None,
    audio_urls: list[str] | None = None,
    seed: int = -1,
) -> dict[str, Any]:
    """Build input dict for Seedance 2.0. Auto-detects mode from refs.

    Mode selection:
    - No refs → text_to_video
    - 1-2 images only (no video/audio) → first_last_frames (start/end frame)
    - 3+ images, or any video/audio → omni_reference (flexible multi-ref)
    """
    n_images = len(image_urls) if image_urls else 0
    has_video = bool(video_urls)
    has_audio = bool(audio_urls)

    if n_images == 0 and not has_video and not has_audio:
        mode = "text_to_video"
    elif n_images <= 2 and not has_video and not has_audio:
        mode = "first_last_frames"
    else:
        mode = "omni_reference"

    inp: dict[str, Any] = {
        "prompt": prompt,
        "mode": mode,
        "duration": duration,
        "aspect_ratio": "auto" if mode == "first_last_frames" else aspect_ratio,
    }

    if mode == "first_last_frames" and image_urls:
        inp["image_urls"] = image_urls
    else:
        if image_urls:
            inp["image_urls"] = image_urls
        if video_urls:
            inp["video_urls"] = video_urls
        if audio_urls:
            inp["audio_urls"] = audio_urls

    if seed is not None and seed >= 0:
        inp["seed"] = seed
    return inp


async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 5, quality: str = "720p",
    seed: int = -1,
) -> dict[str, Any]:
    """Submit a T2V request (no references)."""
    info = get_model_info(model_id)
    if model_id.startswith("kling"):
        inp = _build_kling_input(prompt, quality, duration, aspect_ratio, seed=seed)
    else:
        inp = _build_seedance_input(prompt, duration, aspect_ratio, seed=seed)
    return await _submit(api_key, info, inp)


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    ref_video_bytes: tuple[str, bytes] | None = None,
    audio_url: str = "",
    aspect_ratio: str = "16:9", duration: int = 5, quality: str = "720p",
    seed: int = -1,
) -> dict[str, Any]:
    """Upload reference files to PiAPI ephemeral storage, then submit task."""
    info = get_model_info(model_id)

    # Upload images in parallel
    image_urls: list[str] = []
    if ref_image_bytes:
        tasks = [upload_ephemeral(api_key, name, data) for name, data in ref_image_bytes]
        image_urls = await asyncio.gather(*tasks)

    # Upload video
    video_urls: list[str] = []
    if ref_video_bytes:
        name, data = ref_video_bytes
        url = await upload_ephemeral(api_key, name, data)
        video_urls = [url]

    # Audio URL (already a URL, no upload needed)
    audio_urls: list[str] = [audio_url] if audio_url else []

    if model_id.startswith("kling"):
        inp = _build_kling_input(prompt, quality, duration, aspect_ratio, image_urls or None, seed=seed)
    else:
        inp = _build_seedance_input(
            prompt, duration, aspect_ratio,
            image_urls or None, video_urls or None, audio_urls or None,
            seed=seed,
        )
    return await _submit(api_key, info, inp)


async def get_result(api_key: str, request_id: str) -> dict[str, Any]:
    """Poll task status. Normalizes response to {request_id, status, url, error}."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/task/{request_id}",
            headers={"x-api-key": api_key},
        )
        if resp.status_code != 200:
            raise VideoGenError(f"Status check failed ({resp.status_code}): {resp.text}")
        raw = resp.json()

    data = raw.get("data", {})
    status = (data.get("status") or "").lower()
    output = data.get("output") or {}
    error_obj = data.get("error") or {}

    return {
        "request_id": data.get("task_id", request_id),
        "status": status,
        "url": output.get("video", ""),
        "error": error_obj.get("message", "") if error_obj.get("code") else "",
    }


async def wait_for_completion(
    api_key: str, request_id: str,
    poll_interval: float = POLL_INTERVAL, timeout: float = POLL_TIMEOUT,
) -> dict[str, Any]:
    """Poll until the generation completes or times out."""
    start = time.monotonic()
    while True:
        result = await get_result(api_key, request_id)
        status = result["status"]
        if status == "completed":
            return result
        if status == "failed":
            raise VideoGenError(f"Generation failed: {result.get('error', 'Unknown error')}")
        if time.monotonic() - start > timeout:
            raise VideoGenError(f"Generation timed out after {timeout}s (status: {status})")
        await asyncio.sleep(poll_interval)


async def _submit(api_key: str, info: dict[str, Any], inp: dict[str, Any]) -> dict[str, Any]:
    """Submit a generation task to PiAPI unified endpoint."""
    payload = {
        "model": info["piapi_model"],
        "task_type": info["task_type"],
        "input": inp,
    }
    logger.info("%s submit: %s", info["name"], inp.get("prompt", "")[:80])

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{BASE_URL}/task",
            json=payload,
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
        )
        if resp.status_code != 200:
            raise VideoGenError(f"Submit failed ({resp.status_code}): {resp.text}")
        raw = resp.json()
        data = raw.get("data", {})
        task_id = data.get("task_id")
        if not task_id:
            raise VideoGenError(f"No task_id in response: {raw}")
        return {"request_id": task_id, "status": (data.get("status") or "pending").lower()}
