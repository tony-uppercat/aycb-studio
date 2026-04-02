"""Video generation API client — Seedance 2.0, Kling 3.0 via MuAPI."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.muapi.ai/api/v1"

# ── Model registry ──────────────────────────────────────────────────────────

MODELS = {
    "seedance-2.0": {
        "name": "Seedance 2.0",
        "t2v": f"{BASE_URL}/seedance-v2.0-t2v",
        "i2v": f"{BASE_URL}/seedance-v2.0-i2v",
        "aspect_ratios": ["16:9", "9:16", "4:3", "3:4"],
        "quality_levels": ["basic", "high"],
        "max_duration": 10,
        "default_duration": 5,
    },
    "kling-3.0-std": {
        "name": "Kling 3.0 Standard",
        "t2v": f"{BASE_URL}/kling-v3-std-t2v",
        "i2v": f"{BASE_URL}/kling-v3-std-i2v",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "quality_levels": ["720p"],
        "max_duration": 10,
        "default_duration": 5,
    },
    "kling-3.0-pro": {
        "name": "Kling 3.0 Pro",
        "t2v": f"{BASE_URL}/kling-v3-pro-t2v",
        "i2v": f"{BASE_URL}/kling-v3-pro-i2v",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "quality_levels": ["1080p"],
        "max_duration": 10,
        "default_duration": 5,
    },
}

# Polling config
POLL_INTERVAL = 5  # seconds
POLL_TIMEOUT = 600  # 10 minutes max


class VideoGenError(Exception):
    """Raised on API errors."""


def get_model_info(model_id: str) -> dict:
    """Get model config by ID."""
    if model_id not in MODELS:
        raise VideoGenError(f"Unknown model: {model_id}. Available: {list(MODELS.keys())}")
    return MODELS[model_id]


async def submit_text_to_video(
    api_key: str,
    model_id: str,
    prompt: str,
    aspect_ratio: str = "16:9",
    duration: int = 5,
    quality: str = "high",
) -> dict[str, Any]:
    """Submit a text-to-video generation request. Returns {"request_id": ...}."""
    info = get_model_info(model_id)
    payload: dict[str, Any] = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "duration": duration,
    }
    # Seedance uses "quality", Kling uses "mode" — normalize
    if model_id.startswith("seedance"):
        payload["quality"] = quality
    return await _submit(api_key, info["t2v"], model_id, payload)


async def submit_image_to_video(
    api_key: str,
    model_id: str,
    prompt: str,
    image_urls: list[str],
    aspect_ratio: str = "16:9",
    duration: int = 5,
    quality: str = "high",
) -> dict[str, Any]:
    """Submit an image-to-video generation request. Returns {"request_id": ...}."""
    info = get_model_info(model_id)
    payload: dict[str, Any] = {
        "prompt": prompt,
        "images_list": image_urls,
        "aspect_ratio": aspect_ratio,
        "duration": duration,
    }
    if model_id.startswith("seedance"):
        payload["quality"] = quality
    return await _submit(api_key, info["i2v"], model_id, payload)


async def get_result(api_key: str, request_id: str) -> dict[str, Any]:
    """Check the status of a generation request."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/results/{request_id}",
            headers={"x-api-key": api_key},
        )
        if resp.status_code != 200:
            raise VideoGenError(f"Status check failed ({resp.status_code}): {resp.text}")
        return resp.json()


async def wait_for_completion(
    api_key: str,
    request_id: str,
    poll_interval: float = POLL_INTERVAL,
    timeout: float = POLL_TIMEOUT,
) -> dict[str, Any]:
    """Poll until the generation completes or times out."""
    start = time.monotonic()
    while True:
        result = await get_result(api_key, request_id)
        status = result.get("status", "").lower()
        if status in ("completed", "complete", "done", "success"):
            return result
        if status in ("failed", "error"):
            raise VideoGenError(f"Generation failed: {result.get('error', 'Unknown error')}")
        elapsed = time.monotonic() - start
        if elapsed > timeout:
            raise VideoGenError(f"Generation timed out after {timeout}s (status: {status})")
        await asyncio.sleep(poll_interval)


async def _submit(api_key: str, endpoint: str, model_id: str, payload: dict) -> dict[str, Any]:
    """Submit a generation request to the given endpoint."""
    logger.info("%s submit: %s", model_id, payload.get("prompt", "")[:80])

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            endpoint,
            json=payload,
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
        )
        if resp.status_code != 200:
            raise VideoGenError(f"Submit failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        if "request_id" not in data:
            raise VideoGenError(f"No request_id in response: {data}")
        return data
