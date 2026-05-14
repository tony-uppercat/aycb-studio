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
    _log, _require_key, _require_prompt, _classify_error,
    _estimate_cost, _pil_to_b64, _save_to_bridge, _validate_image_upload,
    _read_upload,
    IMAGE_MODELS, MAX_IMAGE_BYTES,
)
# Lazy imports — src.gemini pulls cv2/numpy which may fail at boot on Windows
# from src.gemini import generate_image, get_last_usage  → inside endpoints
# from src.video_gen import ...                          → inside endpoints

router = APIRouter(prefix="/api/generate", tags=["generate"])


@router.post("/image")
async def generate_image_endpoint(
    prompt: str = Form(...),
    api_key: str = Form(""),
    model: str = Form("Gemini 3.1 Flash Image"),
    aspect_ratio: str = Form(""),
    image_size: str = Form(""),
    project_name: str = Form(""),
    use_grounding: str = Form(""),
    thinking: str = Form("true"),
    ref_images: list[UploadFile] | None = File(default=None),
):
    from src.gemini import generate_image, get_last_usage

    clean_prompt = _require_prompt(prompt)
    effective_key = _require_key(api_key, "gemini")

    pil_refs: list[PILImage.Image] = []
    if ref_images:
        for f in ref_images[:14]:
            _validate_image_upload(f)
            raw = await _read_upload(f, MAX_IMAGE_BYTES, "Reference image")
            pil_refs.append(PILImage.open(io.BytesIO(raw)).convert("RGB"))

    grounding = use_grounding.lower() in ("true", "1", "yes")
    thinking_bool = thinking.lower() in ("true", "1", "yes")
    model_id = IMAGE_MODELS.get(model, model)
    _log(f"Generate image — model={model} ({model_id}), {len(pil_refs)} refs, grounding={grounding}, thinking={thinking_bool}, prompt={clean_prompt[:80]}...")
    t0 = time.time()
    try:
        result = await asyncio.to_thread(
            generate_image, clean_prompt, pil_refs if pil_refs else None, model_id,
            aspect_ratio=aspect_ratio or None, image_size=image_size or None,
            api_key=effective_key, use_grounding=grounding,
            thinking=thinking_bool,
        )
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Image generation FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)

    usage = get_last_usage()
    cost = _estimate_cost(model_id, usage)

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
    model: str = Form("kling-3.0-omni"),
    aspect_ratio: str = Form("16:9"),
    duration: int = Form(5),
    quality: str = Form("720p"),
    api_key: str = Form(""),
    audio_url: str = Form(""),
    seed: int = Form(-1),
    character_orientation: str = Form("image"),
    ref_images: list[UploadFile] | None = File(default=None),
    ref_video: UploadFile | None = File(default=None),
):
    """Submit a video generation request via PiAPI, fal.ai, Atlas Cloud, or Vertex AI."""
    if model.startswith("vertex-"):
        return await _generate_video_vertex(
            prompt, model, api_key, aspect_ratio, duration, quality, ref_images, seed,
        )
    if model.startswith("fal-"):
        return await _generate_video_fal(prompt, model, api_key, aspect_ratio, duration, ref_images, seed)
    if model.startswith("atlas-"):
        return await _generate_video_atlas(
            prompt, model, api_key, aspect_ratio, duration, audio_url,
            ref_images, ref_video, seed,
            character_orientation=character_orientation,
        )
    return await _generate_video_piapi(
        prompt, model, api_key, aspect_ratio, duration, quality, audio_url, ref_images, ref_video, seed,
    )


async def _generate_video_piapi(
    prompt: str, model: str, api_key: str, aspect_ratio: str,
    duration: int, quality: str, audio_url: str,
    ref_images: list[UploadFile] | None, ref_video: UploadFile | None,
    seed: int = -1,
):
    from src.video_gen import VideoGenError, submit_text_to_video, submit_with_refs

    key = api_key or os.environ.get("AYCB_PIAPI_KEY", "")
    if not key:
        raise HTTPException(400, "PiAPI key required. Set AYCB_PIAPI_KEY or pass api_key.")
    try:
        has_refs = (ref_images and len(ref_images) > 0) or ref_video or audio_url
        if has_refs:
            image_bytes: list[tuple[str, bytes]] = []
            if ref_images:
                for i, f in enumerate(ref_images[:12]):
                    data = await f.read()
                    ext = Path(f.filename or "ref.png").suffix or ".png"
                    image_bytes.append((f"ref_{i}{ext}", data))
            video_bytes: tuple[str, bytes] | None = None
            if ref_video:
                data = await ref_video.read()
                ext = Path(ref_video.filename or "ref.mp4").suffix or ".mp4"
                video_bytes = (f"ref_video{ext}", data)
            result = await submit_with_refs(
                api_key=key, model_id=model, prompt=prompt,
                ref_image_bytes=image_bytes or None, ref_video_bytes=video_bytes,
                audio_url=audio_url, aspect_ratio=aspect_ratio, duration=duration, quality=quality,
                seed=seed,
            )
        else:
            result = await submit_text_to_video(
                api_key=key, model_id=model, prompt=prompt,
                aspect_ratio=aspect_ratio, duration=duration, quality=quality,
                seed=seed,
            )
        _log(f"Video submitted (PiAPI) — model={model}, request_id={result.get('request_id')}")
        return result
    except VideoGenError as e:
        raise HTTPException(422, str(e))


async def _generate_video_fal(
    prompt: str, model: str, api_key: str, aspect_ratio: str,
    duration: int, ref_images: list[UploadFile] | None,
    seed: int = -1,
):
    from src.fal_video_gen import FalVideoGenError, submit_text_to_video as fal_t2v, submit_with_refs as fal_refs

    key = api_key or os.environ.get("AYCB_FAL_KEY", "")
    if not key:
        raise HTTPException(400, "fal.ai key required. Set AYCB_FAL_KEY or pass api_key.")
    try:
        has_refs = ref_images and len(ref_images) > 0
        if has_refs:
            image_bytes: list[tuple[str, bytes]] = []
            for i, f in enumerate(ref_images[:2]):
                data = await f.read()
                ext = Path(f.filename or "ref.png").suffix or ".png"
                image_bytes.append((f"ref_{i}{ext}", data))
            result = await fal_refs(
                api_key=key, model_id=model, prompt=prompt,
                ref_image_bytes=image_bytes, aspect_ratio=aspect_ratio, duration=duration,
                seed=seed,
            )
        else:
            result = await fal_t2v(
                api_key=key, model_id=model, prompt=prompt,
                aspect_ratio=aspect_ratio, duration=duration,
                seed=seed,
            )
        _log(f"Video submitted (fal) — model={model}, request_id={result.get('request_id')}")
        return result
    except FalVideoGenError as e:
        raise HTTPException(422, str(e))


async def _generate_video_atlas(
    prompt: str, model: str, api_key: str, aspect_ratio: str,
    duration: int, audio_url: str,
    ref_images: list[UploadFile] | None, ref_video: UploadFile | None,
    seed: int = -1,
    *,
    character_orientation: str = "image",
):
    from src.atlas_video_gen import AtlasVideoGenError, submit_text_to_video as atlas_t2v, submit_with_refs as atlas_refs

    key = api_key or os.environ.get("AYCB_ATLAS_KEY", "")
    if not key:
        raise HTTPException(400, "Atlas Cloud key required. Set AYCB_ATLAS_KEY or pass api_key.")
    try:
        has_refs = (ref_images and len(ref_images) > 0) or ref_video or audio_url
        if has_refs:
            image_bytes: list[tuple[str, bytes]] = []
            if ref_images:
                for i, f in enumerate(ref_images[:9]):
                    data = await f.read()
                    ext = Path(f.filename or "ref.png").suffix or ".png"
                    image_bytes.append((f"ref_{i}{ext}", data))
            video_bytes: tuple[str, bytes] | None = None
            if ref_video:
                data = await ref_video.read()
                ext = Path(ref_video.filename or "ref.mp4").suffix or ".mp4"
                video_bytes = (f"ref_video{ext}", data)
            result = await atlas_refs(
                api_key=key, model_id=model, prompt=prompt,
                ref_image_bytes=image_bytes or None, ref_video_bytes=video_bytes,
                audio_url=audio_url, aspect_ratio=aspect_ratio, duration=duration,
                seed=seed,
                character_orientation=character_orientation,
            )
        else:
            result = await atlas_t2v(
                api_key=key, model_id=model, prompt=prompt,
                aspect_ratio=aspect_ratio, duration=duration,
                seed=seed,
            )
        _log(f"Video submitted (Atlas) — model={model}, request_id={result.get('request_id')}")
        return result
    except AtlasVideoGenError as e:
        raise HTTPException(422, str(e))


async def _generate_video_vertex(
    prompt: str, model: str, api_key: str, aspect_ratio: str,
    duration: int, quality: str,
    ref_images: list[UploadFile] | None,
    seed: int = -1,
):
    from src.veo_gen import (
        VertexVideoGenError,
        submit_text_to_video as vertex_t2v,
        submit_with_refs as vertex_refs,
    )

    key = _require_key(api_key, "gemini")
    try:
        image_bytes: list[tuple[str, bytes]] = []
        if ref_images:
            for i, f in enumerate(ref_images[:3]):
                data = await f.read()
                ext = Path(f.filename or "ref.png").suffix or ".png"
                image_bytes.append((f"ref_{i}{ext}", data))

        if image_bytes:
            result = await vertex_refs(
                api_key=key, model_id=model, prompt=prompt,
                ref_image_bytes=image_bytes,
                aspect_ratio=aspect_ratio, duration=duration, quality=quality,
                seed=seed,
            )
        else:
            result = await vertex_t2v(
                api_key=key, model_id=model, prompt=prompt,
                aspect_ratio=aspect_ratio, duration=duration, quality=quality,
                seed=seed,
            )
        _log(f"Video submitted (Veo) — model={model}, request_id={result.get('request_id')}, refs={len(image_bytes)}")
        return result
    except ValueError as e:
        _log(f"Veo ValueError: {e}")
        raise HTTPException(400, str(e))
    except VertexVideoGenError as e:
        _log(f"Veo error: {e}")
        raise HTTPException(422, str(e))


@router.get("/video/status/{request_id:path}")
async def video_generation_status(
    request_id: str, api_key: str = "", provider: str = "piapi", endpoint: str = "",
):
    """Poll video generation status. Provider: 'piapi', 'fal', 'atlas', or 'vertex'."""
    if provider == "vertex":
        from src.veo_gen import VertexVideoGenError, get_result as vertex_get_result
        key = _require_key(api_key, "gemini")
        try:
            return await vertex_get_result(key, request_id)
        except ValueError as e:
            _log(f"Veo status ValueError: {e}")
            raise HTTPException(400, str(e))
        except VertexVideoGenError as e:
            _log(f"Veo status error: {e}")
            raise HTTPException(422, str(e))
    if provider == "fal":
        from src.fal_video_gen import FalVideoGenError, get_result as fal_get_result
        key = api_key or os.environ.get("AYCB_FAL_KEY", "")
        if not key:
            raise HTTPException(400, "fal.ai key required.")
        try:
            return await fal_get_result(key, request_id, endpoint)
        except FalVideoGenError as e:
            raise HTTPException(422, str(e))
    elif provider == "atlas":
        from src.atlas_video_gen import AtlasVideoGenError, get_result as atlas_get_result
        key = api_key or os.environ.get("AYCB_ATLAS_KEY", "")
        if not key:
            raise HTTPException(400, "Atlas Cloud key required.")
        try:
            return await atlas_get_result(key, request_id)
        except AtlasVideoGenError as e:
            raise HTTPException(422, str(e))
    else:
        from src.video_gen import VideoGenError, get_result as videogen_get_result
        key = api_key or os.environ.get("AYCB_PIAPI_KEY", "")
        if not key:
            raise HTTPException(400, "PiAPI key required.")
        try:
            return await videogen_get_result(key, request_id)
        except VideoGenError as e:
            raise HTTPException(422, str(e))


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
