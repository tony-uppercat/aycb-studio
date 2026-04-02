"""Bridge router — media exchange between AYCB and Review Hub."""
from __future__ import annotations

import asyncio
import base64
import glob as _glob
import io
import json as _json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo
from pydantic import BaseModel

from config.settings import settings
from src.shared import FavoriteToggle, _log

router = APIRouter(prefix="/api/bridge", tags=["bridge"])

# ── Media list cache ─────────────────────────────────────────────────────────
MEDIA_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm"}

_MEDIA_LIST_CACHE: list[dict] | None = None
_MEDIA_LIST_CACHE_TS: float = 0.0
_MEDIA_LIST_CACHE_TTL = 10.0  # seconds


# ── Bridge helpers ────────────────────────────────────────────────────────────

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
        target_dir = settings.shared_media_path / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        stem = f"generated_{int(time.time() * 1000)}"
        img_path = target_dir / f"{stem}.png"

        # Build metadata dict
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

        # Get or create PIL image
        if pil_image is None and img_bytes is not None:
            pil_img = PILImage.open(io.BytesIO(img_bytes))
        elif pil_image is not None:
            pil_img = pil_image
        else:
            _log("Review Hub bridge — error: no image data provided")
            return None

        # Embed metadata as PNG tEXt chunks
        png_info = PngInfo()
        png_info.add_text("source", "aycb")
        png_info.add_text("project", project_name.strip() or "")
        png_info.add_text("prompt", prompt)
        png_info.add_text("model", model)
        png_info.add_text("model_name", model_name)
        png_info.add_text("aspect_ratio", aspect_ratio)
        png_info.add_text("image_size", image_size)
        png_info.add_text("cost_usd", str(cost_usd))
        png_info.add_text("generated_at", generated_at)

        # Save PNG with embedded metadata
        pil_img.save(str(img_path), format="PNG", pnginfo=png_info)

        _log(f"Review Hub bridge — saved {folder}/{img_path.name} + embedded meta")
        return {"status": "ok", "path": str(img_path.name), "stem": stem, "folder": folder}
    except Exception as e:
        _log(f"Review Hub bridge — error: {e}")
        return None


def _delete_bridge_media(stem: str) -> str | None:
    """Delete PNG + .review.json for a given stem from shared/Media/. Returns deleted path or None."""
    pattern = str(settings.shared_media_path / "**" / f"{stem}.png")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    png_path = Path(matches[0])
    deleted_path = str(png_path)
    png_path.unlink(missing_ok=True)
    # Remove review sidecar if it exists
    review_path = png_path.with_name(f"{stem}.review.json")
    review_path.unlink(missing_ok=True)
    _log(f"Bridge media deleted: {deleted_path}")
    return deleted_path


def _find_review_json(stem: str) -> dict | None:
    """Search shared/Media/ recursively for {stem}.review.json and return parsed data, or None."""
    pattern = str(settings.shared_media_path / "**" / f"{stem}.review.json")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    review_path = Path(matches[0])
    return _json.loads(review_path.read_text(encoding="utf-8"))


def _find_png_meta(stem: str) -> dict | None:
    """Read metadata from PNG tEXt chunks for a given stem in shared/Media/."""
    safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
    if not safe_id:
        return None
    pattern = str(settings.shared_media_path / "**" / f"{safe_id}.png")
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
            except (ValueError, TypeError):
                pass
        return meta
    except Exception:
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


def _scan_media_list() -> list[dict]:
    """Walk shared/Media/ recursively and return a list of media entry dicts."""
    base = settings.shared_media_path
    if not base.exists():
        return []
    entries: list[dict] = []
    for f in sorted(base.rglob("*")):
        if not f.is_file():
            continue
        # Skip .thumbs directories
        rel = f.relative_to(base)
        if ".thumbs" in rel.parts:
            continue
        ext = f.suffix.lower()
        if ext not in MEDIA_EXTENSIONS:
            continue
        if f.name.endswith(".meta.json") or f.name.endswith(".review.json"):
            continue
        stat = f.stat()
        stem = f.stem
        # relative path from base to the file's parent
        rel_dir = str(rel.parent).replace("\\", "/")
        thumb_path = f.parent / ".thumbs" / f"{stem}.jpg"
        thumb_url = (
            f"/api/bridge/media/thumb/{rel_dir}/{stem}.jpg"
            if thumb_path.exists()
            else None
        )
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
    """Look up Review Hub media_id by filename stem."""
    import sqlite3

    # Sanitise: only allow alphanumeric, underscore, hyphen (same as other bridge endpoints)
    stem = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
    if not stem:
        return None

    db_path = settings.shared_media_path.parent / "data" / "review-hub.db"
    if not db_path.exists():
        return None
    uri = db_path.as_uri() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        row = con.execute(
            "SELECT id FROM media WHERE filename LIKE ? LIMIT 1",
            (f"{stem}%",),
        ).fetchone()
        con.close()
        return row[0] if row else None
    except Exception:
        return None


def _get_references_db_path() -> Path:
    return settings.shared_media_path.parent / "data" / "review-hub.db"


def _get_references_base_path() -> Path:
    return settings.shared_media_path.parent / "References"


def _query_references(search: str = "", tag: str = "") -> list[dict]:
    """Read references from Review Hub SQLite DB. Returns empty list if DB missing."""
    import sqlite3

    db_path = _get_references_db_path()
    if not db_path.exists():
        return []

    uri = db_path.as_uri() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        con.row_factory = sqlite3.Row
        cur = con.cursor()

        params: list[str] = []
        where_clauses: list[str] = []

        if search:
            like = f"%{search}%"
            where_clauses.append(
                "(filename LIKE ? OR tags LIKE ? OR notes LIKE ?)"
            )
            params.extend([like, like, like])

        if tag:
            where_clauses.append("tags LIKE ?")
            params.append(f"%{tag}%")

        sql = "SELECT * FROM [references]"
        if where_clauses:
            sql += " WHERE " + " AND ".join(where_clauses)
        sql += " ORDER BY created_at DESC"

        cur.execute(sql, params)
        rows = cur.fetchall()
        con.close()
        return [dict(row) for row in rows]
    except Exception as exc:
        _log(f"References DB query error: {exc}")
        return []


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
    """Save a browser-generated image + metadata sidecar to shared/Media/{project}/ for Review Hub."""
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


@router.delete("/media/{stem}")
async def delete_bridge_media(stem: str):
    """Delete a bridged image and its sidecars from shared/Media/.

    stem is the filename without extension, e.g. 'generated_1774525338'.
    Searches recursively through project subdirectories.
    """
    safe_stem = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
    if not safe_stem:
        raise HTTPException(status_code=400, detail="Invalid stem")
    deleted_path = await asyncio.to_thread(_delete_bridge_media, safe_stem)
    if deleted_path is None:
        raise HTTPException(status_code=404, detail="File not found in shared/Media")
    return {"deleted": True, "path": deleted_path}


@router.get("/meta/{stem}")
async def get_bridge_meta(stem: str):
    """Read metadata from PNG tEXt chunks for a generated image.

    stem is the filename stem, e.g. 'generated_1774482284911'.
    Returns the parsed meta dict if found, or {} if not.
    """
    try:
        safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
        if not safe_id:
            return {}
        data = await asyncio.to_thread(_find_png_meta, safe_id)
        return data if data is not None else {}
    except Exception as e:
        _log(f"Meta read error: {e}")
        return {}


@router.get("/review/{image_id}")
async def get_review_status(image_id: str):
    """Read .review.json sidecar for a generated image.

    image_id is the filename stem, e.g. 'generated_1774482284911'.
    Searches recursively through project subdirectories in shared/Media/.
    Returns the parsed review JSON if found, or {"status": "not_reviewed"} if not.
    """
    try:
        # Sanitise: only allow alphanumeric, underscore, hyphen
        safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "", image_id)
        if not safe_id:
            return {"status": "not_reviewed"}
        data = await asyncio.to_thread(_find_review_json, safe_id)
        if data is None:
            return {"status": "not_reviewed"}
        return data
    except Exception as e:
        _log(f"Review status read error: {e}")
        return {"status": "not_reviewed"}


@router.get("/review-status")
async def get_review_status_batch(ids: str = ""):
    """Batch-read .review.json sidecars for multiple images.

    Query param 'ids' is a comma-separated list of filename stems,
    e.g. ?ids=generated_1774482284911,generated_1774482399022
    Returns a dict of { stem: review_data } for each stem.
    Missing reviews get {"status": "not_reviewed"}.
    """
    if not ids.strip():
        return {}
    stems = [s.strip() for s in ids.split(",") if s.strip()]
    # Cap to 100 to avoid abuse
    stems = stems[:100]

    not_reviewed = {"status": "not_reviewed"}
    result: dict[str, dict] = {}

    def _read_all():
        for stem in stems:
            safe = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
            if not safe:
                result[stem] = not_reviewed
                continue
            data = _find_review_json(safe)
            result[safe] = data if data is not None else not_reviewed

    try:
        await asyncio.to_thread(_read_all)
    except Exception as e:
        _log(f"Batch review status error: {e}")
        # Fill remaining stems with not_reviewed
        for stem in stems:
            safe = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
            if safe and safe not in result:
                result[safe] = not_reviewed
    return result


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
    base = settings.shared_media_path.resolve()
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
    base = settings.shared_media_path.resolve()
    abs_path = (base / path).resolve()
    if not str(abs_path).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="Media file not found")
    ext = abs_path.suffix.lower()
    media_type = _ext_to_mime(ext)
    return FileResponse(str(abs_path), media_type=media_type)


@router.post("/explore/{path:path}")
async def explore_in_file_manager(path: str):
    """Open the file's parent folder in Windows Explorer and select it."""
    import subprocess
    target = settings.shared_media_path / path
    if not target.exists():
        return {"status": "not_found"}
    abs_path = str(target.resolve())
    await asyncio.to_thread(subprocess.Popen, f'explorer /select,"{abs_path}"')
    return {"status": "ok"}


@router.post("/explore-stem/{stem}")
async def explore_stem_in_file_manager(stem: str):
    """Find a file by stem name and open in Windows Explorer."""
    import subprocess
    import glob as globmod
    pattern = str(settings.shared_media_path / "**" / f"{stem}.png")
    matches = globmod.glob(pattern, recursive=True)
    if not matches:
        return {"status": "not_found"}
    abs_path = str(Path(matches[0]).resolve())
    await asyncio.to_thread(subprocess.Popen, f'explorer /select,"{abs_path}"')
    return {"status": "ok"}


@router.post("/favorite")
async def toggle_favorite(body: FavoriteToggle):
    """Proxy favorite toggle to Review Hub API.

    Looks up media_id from Review Hub SQLite by stem, then calls
    Review Hub's POST /api/favorites/toggle endpoint.
    """
    import httpx

    media_id = await asyncio.to_thread(_lookup_media_id, body.stem)
    if media_id is None:
        raise HTTPException(status_code=404, detail=f"Media not found for stem: {body.stem}")

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                "http://localhost:3002/api/favorites/toggle",
                json={
                    "media_id": media_id,
                    "user_name": body.user_name,
                    "status": body.status,
                },
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        _log(f"Favorite toggle proxy error: {e}")
        raise HTTPException(status_code=502, detail=str(e))


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
    import sqlite3

    def _fetch_thumbnail_path(rid: int) -> str | None:
        db_path = _get_references_db_path()
        if not db_path.exists():
            return None
        uri = db_path.as_uri() + "?mode=ro"
        try:
            con = sqlite3.connect(uri, uri=True)
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            cur.execute("SELECT thumbnail_path FROM [references] WHERE id = ?", (rid,))
            row = cur.fetchone()
            con.close()
            return row["thumbnail_path"] if row else None
        except Exception as exc:
            _log(f"References thumbnail DB error: {exc}")
            return None

    thumbnail_rel = await asyncio.to_thread(_fetch_thumbnail_path, ref_id)
    if not thumbnail_rel:
        raise HTTPException(status_code=404, detail="Reference not found")

    abs_path = _get_references_base_path() / thumbnail_rel
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
    import sqlite3

    def _fetch_image_paths(rid: int) -> tuple[str | None, str | None]:
        db_path = _get_references_db_path()
        if not db_path.exists():
            return None, None
        uri = db_path.as_uri() + "?mode=ro"
        try:
            con = sqlite3.connect(uri, uri=True)
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            cur.execute(
                "SELECT processed_path, original_path FROM [references] WHERE id = ?",
                (rid,),
            )
            row = cur.fetchone()
            con.close()
            if row:
                return row["processed_path"], row["original_path"]
            return None, None
        except Exception as exc:
            _log(f"References image DB error: {exc}")
            return None, None

    processed_rel, original_rel = await asyncio.to_thread(_fetch_image_paths, ref_id)
    if processed_rel is None and original_rel is None:
        raise HTTPException(status_code=404, detail="Reference not found")

    base = _get_references_base_path()
    chosen: Path | None = None

    if processed_rel:
        candidate = base / processed_rel
        if candidate.exists():
            chosen = candidate

    if chosen is None and original_rel:
        candidate = base / original_rel
        if candidate.exists():
            chosen = candidate

    if chosen is None:
        raise HTTPException(status_code=404, detail="Image file not found on disk")

    suffix = chosen.suffix.lower()
    media_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else "image/png" if suffix == ".png" else "image/webp"
    return FileResponse(str(chosen), media_type=media_type)
