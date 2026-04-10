"""Video generation API client — Kling 3.0 Omni, Seedance 2.0 via PiAPI.ai."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.piapi.ai/api/v1"
UPLOAD_URL = "https://upload.theapi.app/api/ephemeral_resource"

# ── Model registry ──────────────────────────────────────────────────────────

MODELS: dict[str, dict[str, Any]] = {
    "kling-3.0-omni": {
        "name": "Kling 3.0 Omni",
        "piapi_model": "kling",
        "task_type": "omni_video_generation",
        "version": "3.0",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "qualities": ["720p", "1080p"],
        "min_duration": 3,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"720p": 0.10, "1080p": 0.15},
    },
    "seedance-2.0": {
        "name": "Seedance 2.0",
        "piapi_model": "seedance",
        "task_type": "seedance-2",
        "aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "qualities": ["standard"],
        "min_duration": 4,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"standard": 0.15},
    },
    "seedance-2.0-fast": {
        "name": "Seedance 2.0 Fast",
        "piapi_model": "seedance",
        "task_type": "seedance-2-fast",
        "aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "qualities": ["standard"],
        "min_duration": 4,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"standard": 0.10},
    },
}

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
    image_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Build input dict for Kling 3.0 Omni."""
    inp: dict[str, Any] = {
        "prompt": prompt,
        "version": "3.0",
        "resolution": quality if quality in ("720p", "1080p") else "720p",
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "enable_audio": False,
    }
    if image_urls:
        inp["images"] = image_urls
    return inp


def _build_seedance_input(
    prompt: str, duration: int, aspect_ratio: str,
    image_urls: list[str] | None = None,
    video_urls: list[str] | None = None,
    audio_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Build input dict for Seedance 2.0. Auto-detects mode from refs."""
    has_images = bool(image_urls)
    has_video = bool(video_urls)
    has_audio = bool(audio_urls)

    # Mode detection:
    # - No refs → text_to_video
    # - Any refs → omni_reference (more flexible, no aspect ratio constraint)
    # Note: first_last_frames is NOT used because it requires matching aspect ratios
    # between frames, which breaks multi-ref with mixed source images.
    if has_images or has_video or has_audio:
        mode = "omni_reference"
    else:
        mode = "text_to_video"

    inp: dict[str, Any] = {
        "prompt": prompt,
        "mode": mode,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
    }

    if image_urls:
        inp["image_urls"] = image_urls
    if video_urls:
        inp["video_urls"] = video_urls
    if audio_urls:
        inp["audio_urls"] = audio_urls

    return inp


async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 5, quality: str = "720p",
) -> dict[str, Any]:
    """Submit a T2V request (no references)."""
    info = get_model_info(model_id)
    if model_id.startswith("kling"):
        inp = _build_kling_input(prompt, quality, duration, aspect_ratio)
    else:
        inp = _build_seedance_input(prompt, duration, aspect_ratio)
    return await _submit(api_key, info, inp)


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    ref_video_bytes: tuple[str, bytes] | None = None,
    audio_url: str = "",
    aspect_ratio: str = "16:9", duration: int = 5, quality: str = "720p",
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
        inp = _build_kling_input(prompt, quality, duration, aspect_ratio, image_urls or None)
    else:
        inp = _build_seedance_input(
            prompt, duration, aspect_ratio,
            image_urls or None, video_urls or None, audio_urls or None,
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
