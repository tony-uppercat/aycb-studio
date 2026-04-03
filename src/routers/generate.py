"""Generate router — image and video generation."""
from __future__ import annotations

import asyncio
import io
import os
import tempfile
import time
from pathlib import Path

from PIL import Image as PILImage

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.shared import (
    _log, _require_api_key, _require_prompt, _classify_error,
    _estimate_cost, _pil_to_b64, _save_to_bridge, _validate_image_upload,
    _read_upload,
    IMAGE_MODELS, MODEL_PRICING, MAX_IMAGE_BYTES,
)
# Lazy imports — src.gemini pulls cv2/numpy which may fail at boot on Windows
# from src.gemini import generate_image, get_last_usage  → inside endpoints
# from src.video_gen import ...                          → inside endpoints

router = APIRouter(prefix="/api/generate", tags=["generate"])


@router.post("/image")
async def generate_image_endpoint(
    prompt: str = Form(...),
    api_key: str = Form(""),
    model: str = Form("Gemini 2.5 Flash"),
    aspect_ratio: str = Form(""),
    image_size: str = Form(""),
    project_name: str = Form(""),
    ref_images: list[UploadFile] | None = File(default=None),
):
    from src.gemini import generate_image, get_last_usage

    clean_prompt = _require_prompt(prompt)
    effective_key = _require_api_key(api_key)

    pil_refs: list[PILImage.Image] = []
    if ref_images:
        for f in ref_images[:8]:
            _validate_image_upload(f)
            raw = await _read_upload(f, MAX_IMAGE_BYTES, "Reference image")
            pil_refs.append(PILImage.open(io.BytesIO(raw)).convert("RGB"))

    model_id = IMAGE_MODELS.get(model, model)
    _log(f"Generate image — model={model} ({model_id}), {len(pil_refs)} refs, prompt={clean_prompt[:80]}...")
    t0 = time.time()
    try:
        result = await asyncio.to_thread(
            generate_image, clean_prompt, pil_refs if pil_refs else None, model_id,
            aspect_ratio=aspect_ratio or None, image_size=image_size or None,
            api_key=effective_key,
        )
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Image generation FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)

    usage = get_last_usage()
    cost = _estimate_cost(model_id, usage)
    # For imagen models, estimate per-image cost (no token usage available)
    if model_id.startswith("imagen"):
        per_image_cost = MODEL_PRICING.get(model_id, (0, 0))[1] / 1_000_000 * 1000
        cost = {"input_tokens": 0, "output_tokens": 0, "cost_usd": round(per_image_cost, 6)}

    dt = time.time() - t0
    if result is None:
        _log(f"Image generation — no image returned, model={model} ({dt:.1f}s)")
        return {"image_b64": None, "status": "No image generated", "usage": cost}

    # Save to shared/Media/ with embedded PNG metadata for Review Hub
    bridge_result = _save_to_bridge(
        pil_image=result,
        prompt=clean_prompt,
        model=model_id,
        model_name=model,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
        cost_usd=cost.get("cost_usd", 0.0) if cost else 0.0,
        project_name=project_name,
    )
    bridge_stem = bridge_result.get("stem") if bridge_result else None

    _log(f"Image generated — model={model} ({dt:.1f}s)")
    return {"image_b64": _pil_to_b64(result), "status": "OK", "usage": cost, "bridge_stem": bridge_stem}


@router.post("/video")
async def generate_video(
    prompt: str = Form(...),
    model: str = Form("seedance-2.0"),
    mode: str = Form("t2v"),
    aspect_ratio: str = Form("16:9"),
    duration: int = Form(5),
    quality: str = Form("high"),
    api_key: str = Form(""),
    image_urls: str = Form(""),  # comma-separated URLs for i2v mode
):
    """Submit a video generation request (Seedance 2.0 / Kling 3.0). Returns request_id for polling."""
    from src.video_gen import VideoGenError, submit_image_to_video, submit_text_to_video

    key = api_key or os.environ.get("AYCB_MUAPI_KEY", "")
    if not key:
        raise HTTPException(400, "MuAPI key required. Set AYCB_MUAPI_KEY or pass api_key.")

    try:
        if mode == "i2v" and image_urls:
            urls = [u.strip() for u in image_urls.split(",") if u.strip()]
            result = await submit_image_to_video(
                api_key=key,
                model_id=model,
                prompt=prompt,
                image_urls=urls,
                aspect_ratio=aspect_ratio,
                duration=duration,
                quality=quality,
            )
        else:
            result = await submit_text_to_video(
                api_key=key,
                model_id=model,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                duration=duration,
                quality=quality,
            )
        _log(f"Video generation submitted — model={model}, mode={mode}, request_id={result.get('request_id')}")
        return result
    except VideoGenError as e:
        raise HTTPException(502, str(e))


@router.get("/video/status/{request_id}")
async def video_generation_status(request_id: str, api_key: str = ""):
    """Poll video generation status. Returns {status, url?, ...}."""
    from src.video_gen import VideoGenError, get_result as videogen_get_result

    key = api_key or os.environ.get("AYCB_MUAPI_KEY", "")
    if not key:
        raise HTTPException(400, "MuAPI key required.")
    try:
        result = await videogen_get_result(key, request_id)
        return result
    except VideoGenError as e:
        raise HTTPException(502, str(e))


@router.post("/video/image-upload")
async def video_image_upload(image: UploadFile = File(...)):
    """Upload an image for i2v mode — saves to temp and returns a local URL.
    This allows the frontend to pass local images as URLs for Seedance i2v."""
    import uuid
    ext = Path(image.filename or "image.png").suffix or ".png"
    tmp_dir = Path(tempfile.gettempdir()) / "aycb_video_refs"
    tmp_dir.mkdir(exist_ok=True)
    tmp_path = tmp_dir / f"{uuid.uuid4().hex}{ext}"
    content = await image.read()
    tmp_path.write_bytes(content)
    return {"path": str(tmp_path), "note": "For i2v, images must be publicly accessible URLs. Upload to a public host or use the built-in image hosting."}


@router.post("/local")
async def generate_local_endpoint(
    prompt: str = Form(...),
    model_id: str = Form("flux-schnell"),
    width: int = Form(1024),
    height: int = Form(1024),
    steps: int = Form(0),
    guidance: float = Form(0),
):
    """Generate image locally using diffusers + GPU."""
    clean_prompt = _require_prompt(prompt)
    _log(f"Local generate — model={model_id}, {width}x{height}, prompt={clean_prompt[:80]}...")

    try:
        from src.local_gen import generate
    except ImportError:
        raise HTTPException(501, detail="Local generation not available — install with: pip install aycb[local]")

    t0 = time.time()
    try:
        image_b64 = await asyncio.to_thread(
            generate,
            prompt=clean_prompt,
            model_id=model_id,
            width=width,
            height=height,
            num_inference_steps=steps if steps > 0 else None,
            guidance_scale=guidance if guidance > 0 else None,
        )
        dt = time.time() - t0
        _log(f"Local generate complete — model={model_id} ({dt:.1f}s)")
        return {"image_b64": image_b64, "status": "OK"}
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Local generate FAILED — {exc} ({dt:.1f}s)")
        raise HTTPException(500, detail=str(exc))
