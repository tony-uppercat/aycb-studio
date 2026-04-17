"""Video generation API client — Seedance 2.0 via Atlas Cloud."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.atlascloud.ai/api/v1"

# ── Model registry ──────────────────────────────────────────────────────────

MODELS: dict[str, dict[str, Any]] = {
    "atlas-seedance-2.0-fast": {
        "name": "Seedance 2.0 Fast (Atlas)",
        "model_id": "bytedance/seedance-2.0-fast/text-to-video",
        "model_id_i2v": "bytedance/seedance-2.0-fast/image-to-video",
        "aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "qualities": ["720p"],
        "min_duration": 4,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"720p": 0.18},
    },
    "atlas-seedance-2.0": {
        "name": "Seedance 2.0 (Atlas)",
        "model_id": "bytedance/seedance-2.0/text-to-video",
        "model_id_i2v": "bytedance/seedance-2.0/image-to-video",
        "aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "qualities": ["720p"],
        "min_duration": 4,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"720p": 0.25},
    },
}

POLL_INTERVAL = 3
POLL_TIMEOUT = 600


class AtlasVideoGenError(Exception):
    """Raised on Atlas Cloud API errors."""


def get_model_info(model_id: str) -> dict[str, Any]:
    if model_id not in MODELS:
        raise AtlasVideoGenError(f"Unknown Atlas model: {model_id}. Available: {list(MODELS.keys())}")
    return MODELS[model_id]


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _to_data_uri(file_bytes: bytes, ext: str = ".png") -> str:
    mime = "image/png"
    if ext.lower() in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif ext.lower() == ".webp":
        mime = "image/webp"
    elif ext.lower() == ".mp4":
        mime = "video/mp4"
    elif ext.lower() in (".mp3", ".wav"):
        mime = f"audio/{ext.lower().lstrip('.')}"
    b64 = base64.b64encode(file_bytes).decode()
    return f"data:{mime};base64,{b64}"


# ── Submit ──────────────────────────────────────────────────────────────────

async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 5,
    seed: int = -1, **_kwargs: Any,
) -> dict[str, Any]:
    """Submit T2V request."""
    info = get_model_info(model_id)
    payload: dict[str, Any] = {
        "model": info["model_id"],
        "prompt": prompt,
        "duration": duration,
        "resolution": "720p",
        "ratio": aspect_ratio,
        "generate_audio": False,
    }
    if seed is not None and seed >= 0:
        payload["seed"] = seed
    return await _submit(api_key, info["name"], payload)


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    ref_video_bytes: tuple[str, bytes] | None = None,
    audio_url: str = "",
    aspect_ratio: str = "16:9", duration: int = 5,
    seed: int = -1, **_kwargs: Any,
) -> dict[str, Any]:
    """Submit I2V request. Atlas only supports first image as start keyframe."""
    info = get_model_info(model_id)

    if not ref_image_bytes:
        return await submit_text_to_video(api_key, model_id, prompt, aspect_ratio, duration, seed)

    if len(ref_image_bytes) > 1:
        logger.warning("Atlas I2V uses only the first image as start keyframe; %d extra ignored",
                        len(ref_image_bytes) - 1)
    if ref_video_bytes:
        logger.warning("Atlas Seedance does not support video references; ignored")
    if audio_url:
        logger.warning("Atlas Seedance does not support audio references; ignored")

    name, data = ref_image_bytes[0]
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ".png"
    payload: dict[str, Any] = {
        "model": info["model_id_i2v"],
        "prompt": prompt,
        "image_url": _to_data_uri(data, ext),
        "duration": duration,
        "resolution": "720p",
        "ratio": aspect_ratio,
        "generate_audio": False,
    }
    if seed is not None and seed >= 0:
        payload["seed"] = seed
    return await _submit(api_key, info["name"], payload)


async def _submit(api_key: str, name: str, payload: dict) -> dict[str, Any]:
    """Submit generation request. Returns {request_id, status}."""
    logger.info("%s submit: %s", name, payload.get("prompt", "")[:80])

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{BASE_URL}/model/generateVideo",
            json=payload,
            headers=_headers(api_key),
        )
        if resp.status_code != 200:
            raise AtlasVideoGenError(f"Submit failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        pred_id = data.get("data", {}).get("id")
        if not pred_id:
            raise AtlasVideoGenError(f"No prediction id in response: {data}")
        return {"request_id": pred_id, "status": "pending"}


# ── Poll / Result ──────────────────────────────────────────────────────────

async def get_result(api_key: str, request_id: str) -> dict[str, Any]:
    """Check prediction status. Normalizes to {request_id, status, url, error}."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/model/prediction/{request_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if resp.status_code != 200:
            raise AtlasVideoGenError(f"Status check failed ({resp.status_code}): {resp.text}")
        raw = resp.json()

    data = raw.get("data", {})
    status = (data.get("status") or "").lower()
    outputs = data.get("outputs") or []
    video_url = outputs[0] if outputs else ""
    error = data.get("error", "")

    if status in ("completed", "succeeded"):
        return {"request_id": request_id, "status": "completed", "url": video_url, "error": ""}
    if status == "failed":
        return {"request_id": request_id, "status": "failed", "url": "", "error": error or "Generation failed"}

    return {"request_id": request_id, "status": status or "processing", "url": "", "error": ""}


async def wait_for_completion(
    api_key: str, request_id: str,
    poll_interval: float = POLL_INTERVAL, timeout: float = POLL_TIMEOUT,
) -> dict[str, Any]:
    """Poll until completion or timeout."""
    start = time.monotonic()
    while True:
        result = await get_result(api_key, request_id)
        if result["status"] == "completed":
            return result
        if result["status"] == "failed":
            raise AtlasVideoGenError(f"Generation failed: {result.get('error', 'Unknown')}")
        if time.monotonic() - start > timeout:
            raise AtlasVideoGenError(f"Timed out after {timeout}s (status: {result['status']})")
        await asyncio.sleep(poll_interval)
