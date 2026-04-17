"""Video generation API client — Kling v3 via fal.ai queue API."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

QUEUE_URL = "https://queue.fal.run"

# ── Model registry ──────────────────────────────────────────────────────────

MODELS: dict[str, dict[str, Any]] = {
    "fal-kling-v3-std": {
        "name": "Kling 3.0 Omni Std (fal)",
        "endpoint_t2v": "fal-ai/kling-video/v3/standard/text-to-video",
        "endpoint_i2v": "fal-ai/kling-video/v3/standard/image-to-video",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "qualities": ["720p"],
        "min_duration": 3,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"720p": 0.07},
    },
    "fal-kling-v3-pro": {
        "name": "Kling 3.0 Omni Pro (fal)",
        "endpoint_t2v": "fal-ai/kling-video/v3/pro/text-to-video",
        "endpoint_i2v": "fal-ai/kling-video/v3/pro/image-to-video",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "qualities": ["1080p"],
        "min_duration": 3,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"1080p": 0.10},
    },
    "fal-seedance-2.0": {
        "name": "Seedance 2.0 (fal)",
        "endpoint_t2v": "bytedance/seedance-2.0/text-to-video",
        "endpoint_i2v": "bytedance/seedance-2.0/image-to-video",
        "aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        "qualities": ["720p"],
        "min_duration": 4,
        "max_duration": 15,
        "default_duration": 5,
        "cost_per_sec": {"720p": 0.30},
    },
}

POLL_INTERVAL = 5
POLL_TIMEOUT = 600


class FalVideoGenError(Exception):
    """Raised on fal.ai API errors."""


def get_model_info(model_id: str) -> dict[str, Any]:
    """Get model config by ID."""
    if model_id not in MODELS:
        raise FalVideoGenError(f"Unknown fal model: {model_id}. Available: {list(MODELS.keys())}")
    return MODELS[model_id]


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}


def _image_to_data_uri(file_bytes: bytes, ext: str = ".png") -> str:
    """Convert image bytes to data URI for fal.ai."""
    mime = "image/png"
    if ext.lower() in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif ext.lower() == ".webp":
        mime = "image/webp"
    b64 = base64.b64encode(file_bytes).decode()
    return f"data:{mime};base64,{b64}"


# ── Submit ──────────────────────────────────────────────────────────────────

def _base_payload(model_id: str, prompt: str, duration: int, aspect_ratio: str, seed: int = -1) -> dict[str, Any]:
    """Build common payload fields. Kling uses cfg_scale/negative_prompt, Seedance does not."""
    payload: dict[str, Any] = {
        "prompt": prompt,
        "duration": str(duration),
        "aspect_ratio": aspect_ratio,
        "generate_audio": False,
    }
    if model_id.startswith("fal-kling"):
        payload["negative_prompt"] = "blur, distort, and low quality"
        payload["cfg_scale"] = 0.5
    if seed is not None and seed >= 0:
        payload["seed"] = seed
    return payload


async def submit_text_to_video(
    api_key: str, model_id: str, prompt: str,
    aspect_ratio: str = "16:9", duration: int = 5,
    seed: int = -1, **_kwargs: Any,
) -> dict[str, Any]:
    """Submit a T2V request. Returns {request_id, status_url, response_url}."""
    info = get_model_info(model_id)
    payload = _base_payload(model_id, prompt, duration, aspect_ratio, seed)
    return await _submit(api_key, info["endpoint_t2v"], info["name"], payload)


async def submit_with_refs(
    api_key: str, model_id: str, prompt: str,
    ref_image_bytes: list[tuple[str, bytes]] | None = None,
    aspect_ratio: str = "16:9", duration: int = 5,
    seed: int = -1, **_kwargs: Any,
) -> dict[str, Any]:
    """Submit I2V request. Images are sent as data URIs (no upload needed)."""
    info = get_model_info(model_id)

    if not ref_image_bytes:
        return await submit_text_to_video(api_key, model_id, prompt, aspect_ratio, duration, seed)

    start_name, start_data = ref_image_bytes[0]
    start_ext = "." + start_name.rsplit(".", 1)[-1] if "." in start_name else ".png"
    start_uri = _image_to_data_uri(start_data, start_ext)

    payload = _base_payload(model_id, prompt, duration, aspect_ratio, seed)

    # Kling uses start_image_url, Seedance uses image_url
    if model_id.startswith("fal-kling"):
        payload["start_image_url"] = start_uri
    else:
        payload["image_url"] = start_uri

    if len(ref_image_bytes) >= 2:
        end_name, end_data = ref_image_bytes[1]
        end_ext = "." + end_name.rsplit(".", 1)[-1] if "." in end_name else ".png"
        payload["end_image_url"] = _image_to_data_uri(end_data, end_ext)

    return await _submit(api_key, info["endpoint_i2v"], info["name"], payload)


async def _submit(api_key: str, endpoint: str, name: str, payload: dict) -> dict[str, Any]:
    """Submit to fal.ai queue. Returns normalized {request_id, status}."""
    logger.info("%s submit: %s", name, payload.get("prompt", "")[:80])

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{QUEUE_URL}/{endpoint}",
            json=payload,
            headers=_headers(api_key),
        )
        if resp.status_code != 200:
            raise FalVideoGenError(f"Submit failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        req_id = data.get("request_id")
        if not req_id:
            raise FalVideoGenError(f"No request_id in response: {data}")
        return {
            "request_id": req_id,
            "status": "pending",
            "_fal_status_url": data.get("status_url", ""),
            "_fal_response_url": data.get("response_url", ""),
            "_fal_endpoint": endpoint,
        }


# ── Poll / Result ──────────────────────────────────────────────────────────

async def get_result(api_key: str, request_id: str, endpoint: str = "") -> dict[str, Any]:
    """Check status and fetch result if completed.

    Normalizes to {request_id, status, url, error} matching PiAPI shape.
    """
    if not endpoint:
        raise FalVideoGenError("fal.ai polling requires endpoint (model path)")

    async with httpx.AsyncClient(timeout=30) as client:
        # Check status
        status_resp = await client.get(
            f"{QUEUE_URL}/{endpoint}/requests/{request_id}/status",
            headers=_headers(api_key),
        )
        if status_resp.status_code != 200:
            raise FalVideoGenError(f"Status check failed ({status_resp.status_code}): {status_resp.text}")

        status_data = status_resp.json()
        raw_status = (status_data.get("status") or "").upper()

        if raw_status == "COMPLETED":
            # Fetch result
            result_resp = await client.get(
                f"{QUEUE_URL}/{endpoint}/requests/{request_id}/response",
                headers=_headers(api_key),
            )
            if result_resp.status_code != 200:
                raise FalVideoGenError(f"Result fetch failed ({result_resp.status_code}): {result_resp.text}")
            result = result_resp.json()
            video_url = result.get("video", {}).get("url", "")
            return {"request_id": request_id, "status": "completed", "url": video_url, "error": ""}

        if raw_status in ("IN_QUEUE", "IN_PROGRESS"):
            mapped = "processing" if raw_status == "IN_PROGRESS" else "pending"
            return {"request_id": request_id, "status": mapped, "url": "", "error": ""}

        # Error or unknown
        err_msg = status_data.get("error", "") or status_data.get("error_type", "") or f"Unknown status: {raw_status}"
        return {"request_id": request_id, "status": "failed", "url": "", "error": str(err_msg)}


async def wait_for_completion(
    api_key: str, request_id: str, endpoint: str,
    poll_interval: float = POLL_INTERVAL, timeout: float = POLL_TIMEOUT,
) -> dict[str, Any]:
    """Poll until the generation completes or times out."""
    start = time.monotonic()
    while True:
        result = await get_result(api_key, request_id, endpoint)
        if result["status"] == "completed":
            return result
        if result["status"] == "failed":
            raise FalVideoGenError(f"Generation failed: {result.get('error', 'Unknown')}")
        if time.monotonic() - start > timeout:
            raise FalVideoGenError(f"Timed out after {timeout}s (status: {result['status']})")
        await asyncio.sleep(poll_interval)
