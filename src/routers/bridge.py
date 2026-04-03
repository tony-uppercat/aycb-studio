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
from src.shared import _log, _save_to_bridge

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
    """Query Review Hub DB for review status by filename stem."""
    import sqlite3

    db_path = settings.db_path
    if not db_path.exists():
        return None
    uri = db_path.as_uri() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT id FROM media WHERE filename LIKE ? LIMIT 1",
            (f"{stem}%",),
        ).fetchone()
        if not row:
            con.close()
            return None
        media_id = row["id"]
        favs = con.execute(
            "SELECT status, user_name FROM favorites WHERE media_id=?",
            (media_id,),
        ).fetchall()
        comment_count = con.execute(
            "SELECT COUNT(*) FROM comments WHERE media_id=?",
            (media_id,),
        ).fetchone()[0]
        drawing_count = con.execute(
            "SELECT COUNT(*) FROM drawings WHERE media_id=?",
            (media_id,),
        ).fetchone()[0]
        con.close()

        status = None
        reviewed_by = None
        favorite = False
        for f in favs:
            if f["status"] in ("approved", "rejected"):
                status = f["status"]
                reviewed_by = f["user_name"]
            if f["status"] == "favorite":
                favorite = True

        return {
            "status": status,
            "reviewed_by": reviewed_by,
            "favorite": favorite,
            "comments_count": comment_count,
            "drawings_count": drawing_count,
        }
    except Exception as e:
        _log(f"Review DB query error for '{stem}': {e}")
        return None


def _find_png_meta(stem: str) -> dict | None:
    """Read metadata from PNG tEXt chunks for a given stem in shared/Media/."""
    safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "", stem)
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
            except (ValueError, TypeError):
                pass
        return meta
    except Exception as e:
        _log(f"PNG meta read error for '{stem}': {e}")
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
    base = settings.media_dir
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
        if f.name.endswith(".meta.json"):
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

    db_path = settings.db_path
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
    except Exception as e:
        _log(f"Media lookup error for '{stem}': {e}")
        return None


def _get_references_db_path() -> Path:
    return settings.db_path


def _get_references_base_path() -> Path:
    return settings.references_dir


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


@router.delete("/media/{stem}")
async def delete_bridge_media(stem: str):
    """Delete a bridged image from shared/Media/.

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
    """Read review status from Review Hub DB for a generated image."""
    try:
        safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "", image_id)
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


@router.post("/explore/{path:path}")
async def explore_in_file_manager(path: str):
    """Open the file's parent folder in Windows Explorer and select it."""
    import subprocess
    target = settings.media_dir / path
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
    pattern = str(settings.media_dir / "**" / f"{stem}.png")
    matches = globmod.glob(pattern, recursive=True)
    if not matches:
        return {"status": "not_found"}
    abs_path = str(Path(matches[0]).resolve())
    await asyncio.to_thread(subprocess.Popen, f'explorer /select,"{abs_path}"')
    return {"status": "ok"}


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
