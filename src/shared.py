"""Shared helpers for AYCB API routers."""
from __future__ import annotations

import base64
import io
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo
from pydantic import BaseModel

from config.settings import save_api_key_to_env, settings

# ── Log buffer ───────────────────────────────────────────────────────────────
_log_buffer: deque[str] = deque(maxlen=500)


def _log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    formatted = f"[{ts}] {msg}"
    print(formatted)
    _log_buffer.append(formatted)


# ── Upload size limits ───────────────────────────────────────────────────────
MAX_IMAGE_BYTES = 50 * 1024 * 1024   # 50 MB
MAX_VIDEO_BYTES = 500 * 1024 * 1024  # 500 MB

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv"}


async def _read_upload(upload: UploadFile, max_bytes: int, kind: str = "file") -> bytes:
    """Read an upload and enforce size limits."""
    raw = await upload.read()
    if len(raw) > max_bytes:
        raise HTTPException(
            413,
            detail=f"{kind} too large: {len(raw) / 1024 / 1024:.1f} MB (max {max_bytes / 1024 / 1024:.0f} MB)",
        )
    return raw


def _validate_image_upload(upload: UploadFile) -> None:
    """Validate image file type by extension and PIL readability."""
    ext = Path(upload.filename or "").suffix.lower()
    if ext and ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(400, detail=f"Unsupported image type: {ext}")


def _validate_video_upload(upload: UploadFile) -> None:
    """Validate video file type by extension."""
    ext = Path(upload.filename or "").suffix.lower()
    if ext and ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(400, detail=f"Unsupported video type: {ext}")


def _safe_video_suffix(filename: str | None) -> str:
    """Return a validated video file suffix."""
    ext = Path(filename or "video.mp4").suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        return ".mp4"
    return ext


def _sanitize_filename(name: str | None) -> str:
    """Sanitize a filename for use in Content-Disposition headers."""
    if not name:
        return "file"
    # Remove path separators, quotes, control chars
    clean = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', '_', name)
    # Limit length
    return clean[:200] or "file"


# ── Model map ────────────────────────────────────────────────────────────────
MODELS = {
    "Gemini 3.1 Pro": "gemini-3.1-pro-preview",
    "Gemini 3.1 Flash-Lite": "gemini-3.1-flash-lite-preview",
    "Gemini 3 Pro": "gemini-3-pro-preview",
    "Gemini 3 Flash": "gemini-3-flash-preview",
    "Gemini 2.5 Flash": "gemini-2.5-flash",
    "Gemini 2.5 Pro": "gemini-2.5-pro",
}

IMAGE_MODELS = {
    "Gemini 3.1 Flash Image": "gemini-3.1-flash-image-preview",
    "Gemini 3 Pro Image": "gemini-3-pro-image-preview",
    "Gemini 2.5 Flash Image": "gemini-2.5-flash-image",
    "Imagen 4": "imagen-4.0-generate-001",
    "Imagen 4 Ultra": "imagen-4.0-ultra-generate-001",
    "Imagen 4 Fast": "imagen-4.0-fast-generate-001",
}

# Cost per 1M tokens (USD): (input_per_1M, output_per_1M)
MODEL_PRICING = {
    # Gemini 3.1
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.1-flash-lite-preview": (0.25, 1.50),
    "gemini-3.1-flash-image-preview": (0.50, 60.00),   # image gen: $60/1M output
    # Gemini 3
    "gemini-3-flash-preview": (0.50, 3.00),
    "gemini-3-pro-preview": (2.00, 12.00),
    "gemini-3-pro-image-preview": (2.00, 120.00),      # image gen: $120/1M output
    # Gemini 2.5
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.5-flash-image": (0.30, 30.00),           # ~$0.039/image
    # Imagen: per-image pricing (stored as output cost, input=0)
    "imagen-4.0-generate-001": (0, 40.00),              # $0.04/image
    "imagen-4.0-ultra-generate-001": (0, 60.00),        # $0.06/image
    "imagen-4.0-fast-generate-001": (0, 20.00),         # $0.02/image
}


def _estimate_cost(model_id: str, usage: dict | None) -> dict | None:
    if not usage:
        return None
    pricing = MODEL_PRICING.get(model_id)
    if not pricing:
        return {"input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0), "cost_usd": 0}
    inp_cost = (usage.get("input_tokens", 0) / 1_000_000) * pricing[0]
    out_cost = (usage.get("output_tokens", 0) / 1_000_000) * pricing[1]
    return {
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "cost_usd": round(inp_cost + out_cost, 6),
    }


def _pil_to_b64(pil: PILImage.Image, depth16: bool = True) -> str:
    """Convert PIL image to base64 PNG. If depth16=True, save as 16-bit per channel."""
    import cv2
    import numpy as np
    buf = io.BytesIO()
    if depth16:
        arr = np.array(pil)
        if arr.dtype == np.uint8:
            arr16 = arr.astype(np.uint16) * 257  # scale 0-255 → 0-65535
        else:
            arr16 = arr.astype(np.uint16)
        # Use cv2 to write 16-bit PNG since PIL doesn't support it natively
        if arr16.ndim == 3 and arr16.shape[2] >= 3:
            arr16 = cv2.cvtColor(arr16, cv2.COLOR_RGB2BGR)
        _, encoded = cv2.imencode('.png', arr16)
        return base64.b64encode(encoded.tobytes()).decode()
    else:
        pil.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()


def _require_api_key(api_key: str) -> str:
    """Validate and return the effective API key without mutating global settings."""
    key = api_key.strip()
    if key:
        save_api_key_to_env(key)
        return key
    if settings.gemini_api_key:
        return settings.gemini_api_key
    raise HTTPException(400, detail="Missing api_key")


def _require_prompt(prompt: str) -> str:
    stripped = prompt.strip()
    if not stripped:
        raise HTTPException(400, detail="Missing prompt")
    return stripped


def _classify_error(exc: Exception) -> tuple[int, str]:
    raw = str(exc)
    msg = raw.lower()
    # Include the actual error so users can diagnose issues
    short = raw[:300] if len(raw) > 300 else raw
    if "invalid" in msg or "unsupported" in msg:
        return 400, f"Invalid request: {short}"
    if "permission" in msg or "api key" in msg or "authenticate" in msg:
        return 401, f"Auth error: {short}"
    if "429" in msg or "rate limit" in msg or "quota" in msg or "resource_exhausted" in msg:
        return 429, "Rate limit exceeded — try again later"
    return 500, f"Internal server error: {short}"


# ── Feedback ─────────────────────────────────────────────────────────────────
FEEDBACK_FILE = Path(__file__).resolve().parent.parent / "feedback" / "urgent.json"
FEEDBACK_ALL_FILE = Path(__file__).resolve().parent.parent / "feedback" / "all.json"
REPORTS_DIR = Path(__file__).resolve().parent.parent / "reports"


class FeedbackItem(BaseModel):
    id: str
    text: str
    category: str
    timestamp: str
    nodeId: str | None = None
    nodeType: str | None = None
    nodeLabel: str | None = None
    nodeData: dict | None = None


# ── Pydantic models used by multiple routers ─────────────────────────────────
class PromptBody(BaseModel):
    text: str


class ReportCostEntry(BaseModel):
    timestamp: str
    nodeId: str
    nodeName: str
    model: str
    inputTokens: int
    outputTokens: int
    costUsd: float


class ReportFeedbackEntry(BaseModel):
    id: str
    text: str
    category: str
    timestamp: str
    nodeId: str | None = None
    nodeType: str | None = None
    resolved: bool = False


class SessionReportPayload(BaseModel):
    costs: list[ReportCostEntry] = []
    feedback: list[ReportFeedbackEntry] = []
    sessionStart: str
    sessionEnd: str


# ── Bridge helper ───────────────────────────────────────────────────────────

def _save_to_bridge(
    img_bytes: bytes | None = None,
    prompt: str = "",
    model: str = "",
    model_name: str = "",
    aspect_ratio: str = "",
    image_size: str = "",
    cost_usd: float = 0.0,
    project_name: str = "",
    pil_image: PILImage.Image | None = None,
) -> dict | None:
    """Save image with embedded PNG tEXt metadata to shared/Media/ for Review Hub."""
    try:
        if project_name.strip():
            folder = re.sub(r'[<>:"/\\|?*]', '_', project_name.strip())[:80]
        else:
            folder = time.strftime("%Y-%m-%d")
        target_dir = settings.media_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        stem = f"generated_{int(time.time() * 1000)}"
        img_path = target_dir / f"{stem}.png"

        generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        meta = {
            "source": "aycb",
            "project": project_name.strip() or None,
            "prompt": prompt,
            "model": model,
            "model_name": model_name,
            "aspect_ratio": aspect_ratio,
            "image_size": image_size,
            "cost_usd": cost_usd,
            "generated_at": generated_at,
        }

        if pil_image is None and img_bytes is not None:
            pil_img = PILImage.open(io.BytesIO(img_bytes))
        elif pil_image is not None:
            pil_img = pil_image
        else:
            _log("Review Hub bridge — error: no image data provided")
            return None

        png_info = PngInfo()
        for k, v in meta.items():
            if v is not None:
                png_info.add_text(k, str(v))

        pil_img.save(str(img_path), format="PNG", pnginfo=png_info)
        _log(f"Review Hub bridge — saved {folder}/{img_path.name} + embedded meta")
        return {"status": "ok", "path": str(img_path.name), "stem": stem, "folder": folder}
    except Exception as e:
        _log(f"Review Hub bridge — error: {e}")
        return None
