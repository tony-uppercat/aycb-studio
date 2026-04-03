"""Analyze router — image and video analysis via Gemini."""
from __future__ import annotations

import asyncio
import io
import tempfile
import time
from pathlib import Path

from PIL import Image as PILImage

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.shared import (
    _log, _read_upload, _validate_image_upload, _validate_video_upload,
    _require_api_key, _require_prompt, _estimate_cost, _classify_error,
    _pil_to_b64, _safe_video_suffix,
    MODELS, MODEL_PRICING, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
)

from config.settings import settings

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


@router.post("/image")
async def analyze_image_endpoint(
    image: UploadFile = File(...),
    model: str = Form("gemini-3-flash-preview"),
    do_embed: bool = Form(False),
    api_key: str = Form(""),
):
    effective_key = _require_api_key(api_key)
    _validate_image_upload(image)

    raw = await _read_upload(image, MAX_IMAGE_BYTES, "Image")
    pil = PILImage.open(io.BytesIO(raw)).convert("RGB")
    import cv2, numpy as np
    frame_bgr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

    model_id = MODELS.get(model, model)
    fname = image.filename or "unknown"
    _log(f"Analyze image — {fname} ({len(raw)/1024:.0f} KB), model={model}")

    t0 = time.time()
    try:
        from src.gemini import process_image, AnalysisResult
        result_tuple = await asyncio.to_thread(
            process_image, frame_bgr, source_path="upload", do_embed=do_embed, model_id=model_id,
            api_key=effective_key,
        )
        result: AnalysisResult = result_tuple[0]
        usage: dict | None = result_tuple[1]
        cost = _estimate_cost(model_id, usage)
        dt = time.time() - t0
        _log(f"Image analysis complete — {len(result.prompt_text)} chars ({dt:.1f}s)")
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Image analysis FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)

    return {
        "text": result.prompt_text,
        "json": result.prompt_json,
        "embedding_info": f"dim={len(result.embedding)}" if result.embedding else "",
        "preview_b64": _pil_to_b64(pil),
        "usage": cost,
    }


@router.post("/video")
async def analyze_video_endpoint(
    video: UploadFile = File(...),
    model: str = Form("gemini-3-flash-preview"),
    n_frames: int = Form(3),
    do_embed: bool = Form(False),
    api_key: str = Form(""),
    mode: str = Form("sharpness"),
    cut_threshold: float = Form(0.4),
    export_folder: str = Form(""),
    video_name: str = Form(""),
    prompt: str = Form(""),
):
    effective_key = _require_api_key(api_key)
    _validate_video_upload(video)

    model_id = MODELS.get(model, model)

    raw = await _read_upload(video, MAX_VIDEO_BYTES, "Video")
    fname = video.filename or "unknown"
    suffix = _safe_video_suffix(fname)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = Path(tmp.name)

    max_keyframes = n_frames if n_frames > 0 else settings.max_keyframes

    _log(f"Analyze video — {fname} ({len(raw)/1024:.0f} KB), model={model}, {n_frames} frames, mode={mode}")
    t0 = time.time()

    try:
        from src.frames import extract_keyframes
        frames = await asyncio.to_thread(
            extract_keyframes, tmp_path, max_keyframes, None, mode, cut_threshold
        )
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Video frame extraction FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not frames:
        _log(f"Video analysis — no frames extracted ({time.time()-t0:.1f}s)")
        return {"frames": [], "text": "No frames extracted", "json_text": "", "embedding_info": "", "usage": None}

    # Export frames to shared/Media/{export_folder}/ if requested
    video_stem = video_name or Path(fname).stem
    export_dir = None
    if export_folder:
        export_dir = settings.shared_media_path / export_folder
        export_dir.mkdir(parents=True, exist_ok=True)

    try:
        frames_out, texts = [], []
        total_input_tokens = 0
        total_output_tokens = 0
        for i, frame in enumerate(frames):
            # Export frame as PNG to shared/Media/{folder}/{video}_f{####}.png
            frame_filename = f"{video_stem}_f{str(i).zfill(4)}.png"
            if export_dir:
                import cv2
                pil_export = PILImage.fromarray(cv2.cvtColor(frame.image, cv2.COLOR_BGR2RGB))
                pil_export.save(export_dir / frame_filename, format="PNG")

            from src.gemini import process_image, AnalysisResult
            result_tuple = await asyncio.to_thread(
                process_image, frame.image, source_path=f"frame_{i+1}", do_embed=do_embed,
                model_id=model_id, custom_prompt=prompt or None, api_key=effective_key,
            )
            result: AnalysisResult = result_tuple[0]
            frame_usage: dict | None = result_tuple[1]
            if frame_usage:
                total_input_tokens += frame_usage.get('input_tokens', 0)
                total_output_tokens += frame_usage.get('output_tokens', 0)
            import cv2
            pil = PILImage.fromarray(cv2.cvtColor(frame.image, cv2.COLOR_BGR2RGB))
            frames_out.append({
                "b64": _pil_to_b64(pil),
                "label": f"F{i+1} t={frame.timestamp_sec:.1f}s",
                "timestamp": frame.timestamp_sec,
                "analysis": result.prompt_text,
                "filename": frame_filename,
            })
            texts.append(f"=== Frame {i+1} (t={frame.timestamp_sec:.2f}s) ===\n{result.prompt_text}")

        accumulated_usage = {
            'input_tokens': total_input_tokens,
            'output_tokens': total_output_tokens,
            'total_tokens': total_input_tokens + total_output_tokens,
        } if (total_input_tokens or total_output_tokens) else None
        cost = _estimate_cost(model_id, accumulated_usage)

        dt = time.time() - t0
        _log(f"Video analysis complete — {len(frames)} frames exported to {export_folder or 'none'} ({dt:.1f}s)")
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Video analysis FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)

    return {
        "frames": frames_out,
        "text": "\n\n".join(texts),
        "usage": cost,
    }
