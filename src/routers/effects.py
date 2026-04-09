"""Effects router — image processing (canny, depth)."""
from __future__ import annotations

import asyncio
import io

from PIL import Image as PILImage

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.shared import (
    _log, _read_upload, _validate_image_upload,
    _pil_to_b64, _require_key, _classify_error,
    MAX_IMAGE_BYTES,
)
router = APIRouter(prefix="/api/effects", tags=["effects"])


@router.post("/canny")
async def canny_edge_endpoint(
    image: UploadFile = File(...),
    threshold1: int = Form(50),
    threshold2: int = Form(150),
):
    """Apply Canny edge detection to an image, return result as base64 PNG."""
    _validate_image_upload(image)
    raw = await _read_upload(image, MAX_IMAGE_BYTES, "Image")
    _log(f"Canny edge — threshold={threshold1}/{threshold2}, size={len(raw)/1024:.0f} KB")
    pil = PILImage.open(io.BytesIO(raw)).convert("RGB")
    import cv2, numpy as np
    frame = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, threshold1, threshold2)
    # Convert back to 3-channel for consistency
    edges_bgr = cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)
    pil_result = PILImage.fromarray(cv2.cvtColor(edges_bgr, cv2.COLOR_BGR2RGB))
    return {"image_b64": _pil_to_b64(pil_result), "status": "OK"}


@router.post("/depth")
async def depth_estimation_endpoint(
    image: UploadFile = File(...),
    api_key: str = Form(""),
):
    """Generate depth map using Gemini image generation. Returns depth map as base64 PNG."""
    import time

    effective_key = _require_key(api_key, "gemini")

    _validate_image_upload(image)
    raw = await _read_upload(image, MAX_IMAGE_BYTES, "Image")
    pil = PILImage.open(io.BytesIO(raw)).convert("RGB")

    _log(f"Depth estimation — size={len(raw)/1024:.0f} KB (Gemini)")
    t0 = time.time()

    try:
        from src.shared import _estimate_cost

        from google.genai import types
        from src.gemini import _call_with_gemini_retries, _get_client
        client = _get_client(effective_key)
        response, usage = await asyncio.to_thread(
            lambda: _call_with_gemini_retries(
                lambda: client.models.generate_content(
                    model="gemini-3.1-flash-image-preview",
                    contents=[
                        pil,
                        "Generate a depth map of this image. Output ONLY a grayscale depth map where white is closest and black is farthest. No text, no labels, just the depth map image.",
                    ],
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                    ),
                ),
                operation="depth_estimation",
            )
        )

        parts = getattr(response.candidates[0].content, 'parts', None) or []
        for part in parts:
            if part.inline_data is not None:
                depth_pil = PILImage.open(io.BytesIO(part.inline_data.data)).convert("RGB")
                dt = time.time() - t0
                cost = _estimate_cost("gemini-3.1-flash-image-preview", usage)
                _log(f"Depth estimation complete ({dt:.1f}s)")
                return {"image_b64": _pil_to_b64(depth_pil), "status": "OK", "usage": cost}

        raise RuntimeError("No depth map generated — model returned no image")
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Depth estimation FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)
