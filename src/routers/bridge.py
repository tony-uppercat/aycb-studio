"""Bridge router — media exchange between AYCB and Review Hub."""
from __future__ import annotations

import asyncio
import base64
import glob as _glob
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image as PILImage
from config.settings import settings
from src.review_hub.queries import bridge_ro
from src.shared import _log, _save_to_bridge, _save_video_to_bridge, _sanitize_stem

router = APIRouter(prefix="/api/bridge", tags=["bridge"])

# ── Media list cache ─────────────────────────────────────────────────────────
MEDIA_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm"}

_MEDIA_LIST_CACHE: list[dict] | None = None
_MEDIA_LIST_CACHE_TS: float = 0.0
_MEDIA_LIST_CACHE_TTL = 10.0  # seconds


# ── Bridge helpers ────────────────────────────────────────────────────────────

def _delete_bridge_media(stem: str) -> str | None:
    """Delete PNG for a given stem from shared/Media/. Returns deleted path or None."""
    pattern = str(settings.media_dir / "**" / f"{stem}.png")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    png_path = Path(matches[0])
    deleted_path = str(png_path)
    png_path.unlink(missing_ok=True)
    _log(f"Bridge media deleted: {deleted_path}")
    return deleted_path


def _get_review_from_db(stem: str) -> dict | None:
    """Thin router-side alias — schema knowledge lives in bridge_ro."""
    return bridge_ro.get_review_info(stem)


def _find_png_meta(stem: str) -> dict | None:
    """Read metadata from PNG tEXt chunks for a given stem in shared/Media/."""
    safe_id = _sanitize_stem(stem)
    if not safe_id:
        return None
    pattern = str(settings.media_dir / "**" / f"{safe_id}.png")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    try:
        img = PILImage.open(matches[0])
        info = img.info  # dict of tEXt chunks
        img.close()
        if not info or "source" not in info:
            return None
        # Convert cost_usd back to float
        meta = dict(info)
        if "cost_usd" in meta:
            try:
                meta["cost_usd"] = float(meta["cost_usd"])
            except (ValueError, TypeError) as exc:
                _log(f"PNG meta cost_usd parse error for '{stem}': {exc}")
        return meta
    except Exception as e:
        _log(f"PNG meta read error for '{stem}': {e}")
        return None


def _find_json_meta(stem: str) -> dict | None:
    """Read metadata from .meta.json sidecar for a video file."""
    import json as _json
    safe_id = _sanitize_stem(stem)
    if not safe_id:
        return None
    pattern = str(settings.media_dir / "**" / f"{safe_id}.meta.json")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    try:
        text = Path(matches[0]).read_text(encoding="utf-8")
        return _json.loads(text)
    except Exception as e:
        _log(f"JSON meta read error for '{stem}': {e}")
        return None


def _ext_to_mime(ext: str) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
    }.get(ext, "application/octet-stream")


def _load_filename_to_thumb() -> dict[str, str]:
    """Build {filename: thumbnail_url} for items whose thumbnail exists on disk.

    DB lookup is delegated to bridge_ro; the router adds the
    existence check + URL prefix because those are concerns of the
    HTTP layer, not the query layer.
    """
    thumb_dir = settings.thumbnails_dir
    mapping = bridge_ro.filename_to_thumbnail_id()
    result: dict[str, str] = {}
    for filename, media_id in mapping.items():
        if (thumb_dir / f"{media_id}.jpg").exists():
            result[filename] = f"/thumbnails/{media_id}.jpg"
    return result


def _scan_media_list() -> list[dict]:
    """Walk shared/Media/ recursively and return a list of media entry dicts."""
    base = settings.media_dir
    if not base.exists():
        return []
    # Batch-load thumbnail URLs from Review Hub DB
    thumb_map = _load_filename_to_thumb()
    entries: list[dict] = []
    for f in sorted(base.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(base)
        if ".thumbs" in rel.parts:
            continue
        ext = f.suffix.lower()
        if ext not in MEDIA_EXTENSIONS:
            continue
        if f.name.endswith(".meta.json"):
            continue
        stat = f.stat()
        stem = f.stem
        rel_dir = str(rel.parent).replace("\\", "/")
        thumb_url = thumb_map.get(f.name)
        modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        entries.append({
            "id": stem,
            "filename": f.name,
            "project": rel_dir.split("/")[0] if "/" in rel_dir else rel_dir,
            "path": rel_dir,
            "size": stat.st_size,
            "type": _ext_to_mime(ext),
            "modified": modified,
            "thumb": thumb_url,
            "meta": f"/api/bridge/media/meta/{rel_dir}/{stem}",
        })
    return entries


def _lookup_media_id(stem: str) -> int | None:
    """Look up Review Hub media_id by filename stem, after sanitation."""
    stem = _sanitize_stem(stem)
    if not stem:
        return None
    return bridge_ro.find_media_id_by_stem(stem)


def _get_references_base_path() -> Path:
    return settings.references_dir


def _query_references(search: str = "", tag: str = "") -> list[dict]:
    """Thin router-side alias — schema knowledge lives in bridge_ro."""
    return bridge_ro.query_references(search, tag)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/media")
async def bridge_media(
    image_b64: str = Form(None),
    image_file: UploadFile = File(None),
    prompt: str = Form(""),
    model: str = Form(""),
    model_name: str = Form(""),
    aspect_ratio: str = Form(""),
    image_size: str = Form(""),
    cost_usd: str = Form("0"),
    project_name: str = Form(""),
):
    """Save a browser-generated image with embedded PNG metadata to shared/Media/{project}/."""
    try:
        if image_file and image_file.size:
            img_bytes = await image_file.read()
        elif image_b64:
            b64_data = image_b64.split(",", 1)[-1] if "," in image_b64 else image_b64
            img_bytes = base64.b64decode(b64_data)
        else:
            return {"status": "error", "detail": "No image provided"}
        result = _save_to_bridge(
            img_bytes=img_bytes,
            prompt=prompt,
            model=model,
            model_name=model_name,
            aspect_ratio=aspect_ratio,
            image_size=image_size,
            cost_usd=float(cost_usd) if cost_usd else 0.0,
            project_name=project_name,
        )
        return result or {"status": "error", "detail": "Save failed"}
    except Exception as e:
        _log(f"Review Hub bridge — error: {e}")
        return {"status": "error", "detail": str(e)}


@router.post("/video")
async def bridge_video(
    video_url: str = Form(...),
    prompt: str = Form(""),
    model: str = Form(""),
    model_name: str = Form(""),
    aspect_ratio: str = Form(""),
    duration: int = Form(0),
    cost_usd: str = Form("0"),
    project_name: str = Form(""),
):
    """Download a generated video from CDN and save to shared/Media/ with metadata."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            resp = await client.get(video_url)
            if resp.status_code != 200:
                return {"status": "error", "detail": f"Download failed ({resp.status_code})"}
            video_bytes = resp.content

        result = _save_video_to_bridge(
            video_bytes=video_bytes,
            prompt=prompt,
            model=model,
            model_name=model_name,
            aspect_ratio=aspect_ratio,
            duration=duration,
            cost_usd=float(cost_usd) if cost_usd else 0.0,
            project_name=project_name,
        )
        return result or {"status": "error", "detail": "Save failed"}
    except Exception as e:
        _log(f"Video bridge — error: {e}")
        return {"status": "error", "detail": str(e)}


@router.delete("/media/{stem}")
async def delete_bridge_media(stem: str):
    """Delete a bridged image from shared/Media/.

    stem is the filename without extension, e.g. 'generated_1774525338'.
    Searches recursively through project subdirectories.
    """
    safe_stem = _sanitize_stem(stem)
    if not safe_stem:
        raise HTTPException(status_code=400, detail="Invalid stem")
    deleted_path = await asyncio.to_thread(_delete_bridge_media, safe_stem)
    if deleted_path is None:
        raise HTTPException(status_code=404, detail="File not found in shared/Media")
    return {"deleted": True, "path": deleted_path}


@router.get("/meta/{stem}")
async def get_bridge_meta(stem: str):
    """Read metadata from PNG tEXt chunks or .meta.json sidecar.

    stem is the filename stem, e.g. 'generated_1774482284911' or 'video_1774482284911'.
    """
    try:
        safe_id = _sanitize_stem(stem)
        if not safe_id:
            return {}
        # Try PNG metadata first
        data = await asyncio.to_thread(_find_png_meta, safe_id)
        if data:
            return data
        # Try .meta.json sidecar (videos)
        data = await asyncio.to_thread(_find_json_meta, safe_id)
        return data if data is not None else {}
    except Exception as e:
        _log(f"Meta read error: {e}")
        return {}


@router.get("/review/{image_id}")
async def get_review_status(image_id: str):
    """Read review status from Review Hub DB for a generated image."""
    try:
        safe_id = _sanitize_stem(image_id)
        if not safe_id:
            return {"status": "not_reviewed"}
        data = await asyncio.to_thread(_get_review_from_db, safe_id)
        if data is None:
            return {"status": "not_reviewed"}
        return data
    except Exception as e:
        _log(f"Review status read error: {e}")
        return {"status": "not_reviewed"}


@router.get("/media/list")
async def list_media_files():
    """Scan shared/Media/ and return a JSON array of all media files.

    Result is cached for 10 seconds to avoid hammering the filesystem on
    every grid refresh.
    """
    global _MEDIA_LIST_CACHE, _MEDIA_LIST_CACHE_TS
    now = time.time()
    if _MEDIA_LIST_CACHE is not None and (now - _MEDIA_LIST_CACHE_TS) < _MEDIA_LIST_CACHE_TTL:
        return _MEDIA_LIST_CACHE
    entries = await asyncio.to_thread(_scan_media_list)
    _MEDIA_LIST_CACHE = entries
    _MEDIA_LIST_CACHE_TS = now
    return entries


@router.get("/media/thumb/{path:path}")
async def serve_media_thumb(path: str):
    """Serve a thumbnail from shared/Media/{project}/.thumbs/{name}.

    path is like 'Maserati/generated_1774537520830.jpg'.
    Path traversal guard: resolved path must start with shared_media_path.
    """
    base = settings.media_dir.resolve()
    # path is 'project[/sub]/stem.jpg' — inject .thumbs/ before filename
    clean = path.replace("\\", "/")
    slash_idx = clean.rfind("/")
    if slash_idx < 0:
        raise HTTPException(status_code=400, detail="Invalid thumb path")
    dir_part = clean[:slash_idx]
    filename = clean[slash_idx + 1:]
    abs_path = (base / dir_part / ".thumbs" / filename).resolve()
    if not str(abs_path).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    suffix = abs_path.suffix.lower()
    media_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else "image/png" if suffix == ".png" else "image/webp"
    return FileResponse(str(abs_path), media_type=media_type)


@router.get("/media/file/{path:path}")
async def serve_media_file(path: str):
    """Serve a full-resolution media file from shared/Media/{project}/{name}.

    path is like 'Maserati/generated_1774537520830.png'.
    Path traversal guard: resolved path must start with shared_media_path.
    """
    base = settings.media_dir.resolve()
    abs_path = (base / path).resolve()
    if not str(abs_path).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="Media file not found")
    ext = abs_path.suffix.lower()
    media_type = _ext_to_mime(ext)
    return FileResponse(str(abs_path), media_type=media_type)


# ── Explorer window cache ────────────────────────────────────────────────────
# Per-folder HWND cache so repeated Explorer requests focus the existing
# window instead of spawning a new one each time. Pure ctypes — no pywin32.
_explorer_cache: dict[str, int] = {}


def _is_window_alive(hwnd: int) -> bool:
    import ctypes
    return bool(ctypes.windll.user32.IsWindow(hwnd))


def _bring_window_to_front(hwnd: int) -> None:
    import ctypes
    user32 = ctypes.windll.user32
    SW_RESTORE = 9
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)


def _find_explorer_hwnd(folder_name: str) -> int | None:
    """Enumerate top-level windows; return the first CabinetWClass /
    ExploreWClass whose title matches folder_name, or None.

    Title for an Explorer window is just the leaf folder name (e.g.
    'Maserati' for 'C:\\...\\shared\\Media\\Maserati'). Two folders with
    the same leaf name collide — acceptable trade-off vs adding pywin32.
    """
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    found: list[int] = []
    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd, _lparam):
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if cls.value not in ("CabinetWClass", "ExploreWClass"):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        title = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, title, length + 1)
        if title.value == folder_name:
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(EnumProc(callback), 0)
    return found[0] if found else None


def _open_explorer_select(abs_path: str) -> tuple[bool, str]:
    """Open Explorer focused on the file. If a window for the file's parent
    folder already exists (cached or discovered via enumeration), bring it
    to the foreground instead of opening another. Returns (ok, detail).

    Windows-only dedup; on other platforms just opens the parent folder
    via xdg-open / open and lets the OS handle window reuse.
    """
    import os
    import platform
    import subprocess
    import time

    folder = str(Path(abs_path).parent)

    if platform.system() != "Windows":
        try:
            opener = "open" if platform.system() == "Darwin" else "xdg-open"
            subprocess.Popen([opener, folder])
            return True, "non-windows opener"
        except Exception as e:
            return False, str(e)

    folder_name = os.path.basename(folder.rstrip("\\/"))

    # 1. Cached HWND from a previous launch
    cached = _explorer_cache.get(folder)
    if cached:
        if _is_window_alive(cached):
            _bring_window_to_front(cached)
            return True, "focused cached"
        del _explorer_cache[folder]

    # 2. Live enumeration — folder might be open from a prior session
    existing = _find_explorer_hwnd(folder_name)
    if existing:
        _explorer_cache[folder] = existing
        _bring_window_to_front(existing)
        return True, "focused existing"

    # 3. No existing window — launch a new one
    try:
        subprocess.Popen(["explorer", f"/select,{abs_path}"])
    except Exception as e:
        msg = f"explorer launch failed for {abs_path}: {e}"
        _log(msg)
        return False, msg

    # 4. Poll briefly for the new window so the next click can dedup it
    for _ in range(20):  # up to 1 second
        time.sleep(0.05)
        new_hwnd = _find_explorer_hwnd(folder_name)
        if new_hwnd:
            _explorer_cache[folder] = new_hwnd
            return True, "launched new"
    return True, "launched (cache miss)"


@router.post("/explore/{path:path}")
async def explore_in_file_manager(path: str):
    """Open the file's parent folder in Windows Explorer and select it."""
    target = settings.media_dir / path
    if not target.exists():
        _log(f"explore: target not found: {target}")
        return {"status": "not_found", "path": str(target)}
    abs_path = str(target.resolve())
    ok, detail = await asyncio.to_thread(_open_explorer_select, abs_path)
    return {"status": "ok"} if ok else {"status": "error", "detail": detail}


@router.post("/explore-stem/{stem}")
async def explore_stem_in_file_manager(stem: str):
    """Find a file by stem name and open in Windows Explorer."""
    import glob as globmod
    pattern = str(settings.media_dir / "**" / f"{stem}.png")
    matches = globmod.glob(pattern, recursive=True)
    if not matches:
        _log(f"explore-stem: no match for stem='{stem}' in {settings.media_dir}")
        return {"status": "not_found", "stem": stem}
    abs_path = str(Path(matches[0]).resolve())
    ok, detail = await asyncio.to_thread(_open_explorer_select, abs_path)
    return {"status": "ok"} if ok else {"status": "error", "detail": detail}


@router.post("/favorite")
async def toggle_favorite(body: dict):
    """Toggle favorite/approved/rejected status via Review Hub DB."""
    stem = body.get("stem", "")
    status = body.get("status", "favorite")
    user_name = body.get("user_name", "aycb")

    media_id = await asyncio.to_thread(_lookup_media_id, stem)
    if media_id is None:
        raise HTTPException(status_code=404, detail=f"Media not found for stem: {stem}")

    from src.review_hub.db import get_db
    from src.review_hub.queries.favorites import toggle_favorite as db_toggle

    db = await get_db()
    try:
        result = await db_toggle(db, media_id=media_id, user_name=user_name, status=status)
        return result or {"ok": True}
    finally:
        await db.close()


@router.get("/references")
async def list_references(search: str = "", tag: str = ""):
    """List all references from Review Hub's SQLite DB.

    Optional query params:
    - search: filter by filename, tags, or notes (LIKE)
    - tag: filter by tag value (LIKE)
    """
    try:
        rows = await asyncio.to_thread(_query_references, search, tag)
        return rows
    except Exception as e:
        _log(f"list_references error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/references/{ref_id}/thumbnail")
async def get_reference_thumbnail(ref_id: int):
    """Serve the thumbnail image for a reference entry."""
    thumbnail_rel = await asyncio.to_thread(bridge_ro.get_reference_thumbnail_path, ref_id)
    if not thumbnail_rel:
        raise HTTPException(status_code=404, detail="Reference not found")

    tp = Path(thumbnail_rel)
    abs_path = tp if tp.is_absolute() else _get_references_base_path() / thumbnail_rel
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file not found on disk")

    suffix = abs_path.suffix.lower()
    media_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else "image/png" if suffix == ".png" else "image/webp"
    return FileResponse(str(abs_path), media_type=media_type)


@router.get("/references/{ref_id}/image")
async def get_reference_image(ref_id: int):
    """Serve the processed (full-size) image for a reference entry.

    Falls back to original_path if processed_path does not exist on disk.
    """
    processed_rel, original_rel = await asyncio.to_thread(
        bridge_ro.get_reference_image_paths, ref_id,
    )
    if processed_rel is None and original_rel is None:
        raise HTTPException(status_code=404, detail="Reference not found")

    base = _get_references_base_path()
    chosen: Path | None = None

    def _resolve_ref_path(raw: str | None) -> Path | None:
        if not raw:
            return None
        p = Path(raw)
        # If stored as absolute path and exists, use directly
        if p.is_absolute() and p.exists():
            return p
        # Otherwise treat as relative to references base dir
        candidate = base / raw
        return candidate if candidate.exists() else None

    if processed_rel:
        chosen = _resolve_ref_path(processed_rel)

    if chosen is None and original_rel:
        chosen = _resolve_ref_path(original_rel)

    if chosen is None:
        raise HTTPException(status_code=404, detail="Image file not found on disk")

    suffix = chosen.suffix.lower()
    media_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else "image/png" if suffix == ".png" else "image/webp"
    return FileResponse(str(chosen), media_type=media_type)
