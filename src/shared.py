"""Shared helpers for AYCB API routers."""
from __future__ import annotations

import base64
import io
import json
import re
import struct
import time
import zlib
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo
from pydantic import BaseModel

from config.settings import settings

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

# ── PNG constants ────────────────────────────────────────────────────────────
_PNG_SIG = b"\x89PNG\r\n\x1a\n"


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
    """Sanitize a filename for disk writes and Content-Disposition headers.

    Replaces path separators, quotes, and control chars with underscore;
    collapses '..' so no caller can escape its target directory.
    """
    if not name:
        return "file"
    clean = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', '_', name)
    clean = clean.replace("..", "_")
    return clean[:200] or "file"


def _sanitize_stem(stem: str | None) -> str:
    """Sanitize a stem for URL path parameters — alphanumeric + _ and - only.

    Stricter than _sanitize_filename: used for `/api/bridge/*` endpoints
    that accept a media stem from the client and must produce a value
    safe for both filesystem globs and URL paths.
    """
    if not stem:
        return ""
    return re.sub(r"[^a-zA-Z0-9_\-]", "", stem)


# ── Model map ────────────────────────────────────────────────────────────────
MODELS = {
    "Gemini 3.1 Pro": "gemini-3.1-pro-preview",
    "Gemini 3.1 Flash-Lite": "gemini-3.1-flash-lite",
    "Gemini 3 Flash": "gemini-3-flash-preview",
    # Migration aliases — saved canvases pre-2026-05-14 ship the legacy
    # preview id; rewrite to GA before the Gemini API call so they keep
    # working past the 2026-05-25 preview shutdown. Safe to remove after
    # 2026-06-30.
    "gemini-3.1-flash-lite-preview": "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview:thinking": "gemini-3.1-flash-lite:thinking",
}

IMAGE_MODELS = {
    "Gemini 3.1 Flash Image": "gemini-3.1-flash-image-preview",
    "Gemini 3 Pro Image": "gemini-3-pro-image-preview",
}

# Cost per 1M tokens (USD): (input_per_1M, output_per_1M)
MODEL_PRICING = {
    # Gemini 3.1
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    # Transition alias — canvases saved before 2026-05-14 still pass this id.
    # Safe to remove after 2026-06-30.
    "gemini-3.1-flash-lite-preview": (0.25, 1.50),
    "gemini-3.1-flash-image-preview": (0.50, 60.00),   # image gen: $60/1M output
    # Gemini 3
    "gemini-3-flash-preview": (0.50, 3.00),
    "gemini-3-pro-image-preview": (2.00, 120.00),      # image gen: $120/1M output
    # Claude (Anthropic)
    "claude-sonnet-4-6-20250620": (3.00, 15.00),
    "claude-opus-4-6-20250620": (15.00, 75.00),
    "claude-haiku-4-5-20251001": (0.80, 4.00),
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


def _pil_to_b64(pil: PILImage.Image) -> str:
    """Convert PIL image to base64 PNG (8-bit)."""
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _require_key(api_key: str, provider: str) -> str:
    """Return the effective API key (request param or .env fallback)."""
    key = api_key.strip()
    if key:
        return key
    fallback = getattr(settings, f"{provider}_api_key", "")
    if fallback:
        return fallback
    label = provider.capitalize()
    raise HTTPException(400, detail=f"Missing {label} API key — set it in Settings > API Keys")


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


class PromptLibrarySave(BaseModel):
    name: str
    text: str
    tags: list[str] = []


class PromptLibraryUpdate(BaseModel):
    name: str | None = None
    text: str | None = None
    tags: list[str] | None = None


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

def _resolve_bridge_target(project_name: str, stem_prefix: str) -> tuple[Path, str, str]:
    """Return ``(target_dir, stem, generated_at_iso_z)`` for a bridge save.

    Shared between `_save_to_bridge` (images) and `_save_video_to_bridge`
    (videos) so the folder-sanitize + timestamp-stem + ISO conversion
    logic lives in one place.
    """
    if project_name.strip():
        folder = re.sub(r'[<>:"/\\|?*]', '_', project_name.strip())[:80]
    else:
        folder = time.strftime("%Y-%m-%d")
    target_dir = settings.media_dir / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{stem_prefix}_{int(time.time() * 1000)}"
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return target_dir, stem, generated_at


def _inject_png_text_chunks(png_bytes: bytes, meta: dict[str, str]) -> bytes:
    """Inject tEXt chunks before IDAT without re-encoding pixels.

    PNG layout: 8-byte signature + IHDR + [optional chunks] + IDAT + IEND.
    Each chunk: 4-byte length + 4-byte type + data + 4-byte CRC.
    tEXt chunks carry `keyword(1-79 Latin-1 bytes) + 0x00 + Latin-1 text`.

    tEXt chunks must appear before IDAT per PNG spec so PIL can read them.
    Returns the input bytes unchanged on parse failure so the save path
    never breaks on a malformed PNG.
    """
    if not png_bytes.startswith(_PNG_SIG):
        return png_bytes

    # Find the first IDAT chunk — that's where we insert before
    pos = 8  # skip PNG signature
    while pos + 12 <= len(png_bytes):
        (length,) = struct.unpack(">I", png_bytes[pos:pos + 4])
        chunk_type = png_bytes[pos + 4:pos + 8]
        if chunk_type == b"IDAT":
            insert_pos = pos
            break
        if chunk_type == b"IEND":
            # No IDAT found; can't inject safely
            return png_bytes
        pos += 12 + length
    else:
        return png_bytes

    extra = b""
    for key, value in meta.items():
        keyword = str(key).encode("latin-1", errors="replace")[:79]
        if not keyword:
            continue  # skip spec-illegal empty keyword
        text = str(value).encode("latin-1", errors="replace")
        data = keyword + b"\x00" + text
        chunk_type = b"tEXt"
        length_bytes = struct.pack(">I", len(data))
        crc_bytes = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        extra += length_bytes + chunk_type + data + crc_bytes

    return png_bytes[:insert_pos] + extra + png_bytes[insert_pos:]


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
    """Save image with embedded PNG tEXt metadata + sidecar .meta.json to shared/Media/.

    img_bytes path: byte-perfect — inject tEXt chunks into the raw Gemini bytes,
    write a sidecar JSON, never decode the pixels.
    pil_image path (legacy fallback, hit only when /api/generate/image runs
    server-side via gemini.py PIL flow): re-encode through PIL + sidecar JSON.
    """
    try:
        target_dir, stem, generated_at = _resolve_bridge_target(project_name, "generated")
        folder = target_dir.name
        img_path = target_dir / f"{stem}.png"

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

        # Always write the JSON sidecar — single forward-compatible reader path.
        sidecar_path = target_dir / f"{stem}.meta.json"
        sidecar_path.write_text(
            json.dumps(meta, indent=2),
            encoding="utf-8",
            newline="\n",
        )

        if img_bytes is not None:
            # Byte-perfect path: inject tEXt chunks without re-encoding pixels.
            text_meta = {k: str(v) for k, v in meta.items() if v is not None}
            enriched = _inject_png_text_chunks(img_bytes, text_meta)
            img_path.write_bytes(enriched)
            _log(f"Review Hub bridge — saved {folder}/{img_path.name} byte-perfect + sidecar")
            return {"status": "ok", "path": str(img_path.name), "stem": stem, "folder": folder}

        if pil_image is not None:
            # Legacy PIL path (server-side generation): pixel-lossless but re-encoded.
            png_info = PngInfo()
            for k, v in meta.items():
                if v is not None:
                    png_info.add_text(k, str(v))
            pil_image.save(str(img_path), format="PNG", pnginfo=png_info)
            _log(f"Review Hub bridge — saved {folder}/{img_path.name} via PIL + sidecar")
            return {"status": "ok", "path": str(img_path.name), "stem": stem, "folder": folder}

        _log("Review Hub bridge — error: no image data provided")
        return None
    except Exception as e:
        _log(f"Review Hub bridge — error: {e}")
        return None


def _save_video_to_bridge(
    video_bytes: bytes,
    prompt: str = "",
    model: str = "",
    model_name: str = "",
    aspect_ratio: str = "",
    duration: int = 0,
    cost_usd: float = 0.0,
    project_name: str = "",
) -> dict | None:
    """Save video with sidecar .meta.json to shared/Media/ for Review Hub."""
    try:
        target_dir, stem, generated_at = _resolve_bridge_target(project_name, "video")
        folder = target_dir.name
        video_path = target_dir / f"{stem}.mp4"

        video_path.write_bytes(video_bytes)

        meta = {
            "source": "aycb",
            "project": project_name.strip() or None,
            "prompt": prompt,
            "model": model,
            "model_name": model_name,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "cost_usd": cost_usd,
            "generated_at": generated_at,
        }
        meta_path = target_dir / f"{stem}.meta.json"
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8", newline="\n")

        _log(f"Video bridge — saved {folder}/{video_path.name} ({len(video_bytes)} bytes)")
        return {"status": "ok", "path": str(video_path.name), "stem": stem, "folder": folder}
    except Exception as e:
        _log(f"Video bridge — error: {e}")
        return None
