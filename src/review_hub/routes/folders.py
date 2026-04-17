"""Routes for folder management in shared/Media/."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import media as q
from src.shared import _sanitize_filename, _log

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class MoveBody(BaseModel):
    media_id: int
    target_dir: str


class CreateFolderBody(BaseModel):
    project: str
    name: str


class RenameFolderBody(BaseModel):
    new_name: str


def _safe_name(name: str) -> str:
    """Thin wrapper — folder names get the same sanitation as filenames.

    Kept so call sites read naturally (``_safe_name(project)``) while all
    sanitation logic lives in ``src.shared._sanitize_filename``.
    """
    return _sanitize_filename(name.strip())


@router.get("/folders")
async def list_folders(project: str | None = None):
    """List subfolders. If project is given, list subfolders of that project dir."""
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    if project:
        base = settings.media_dir / _safe_name(project)
        if not base.is_dir():
            return {"folders": []}
        folders = sorted(d.name for d in base.iterdir() if d.is_dir())
    else:
        folders = sorted(d.name for d in settings.media_dir.iterdir() if d.is_dir())
    return {"folders": folders}


@router.post("/folders")
async def create_folder(body: CreateFolderBody):
    """Create a new subfolder: shared/Media/{project}/{name}/."""
    project = _safe_name(body.project)
    name = _safe_name(body.name)
    if not project or not name:
        raise HTTPException(status_code=400, detail="project and name are required")
    target = settings.media_dir / project / name
    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")
    target.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": f"{project}/{name}"}


@router.post("/folders/{name}/rename")
async def rename_folder(name: str, body: RenameFolderBody):
    """Rename a top-level project folder and update all DB records inside it.

    Transactional pattern: apply all DB UPDATEs first (uncommitted), then
    rename on disk. If either step fails, DB changes are discarded by
    not calling commit; if the disk rename succeeds but commit fails,
    the disk rename is reverted so the observed state stays consistent.
    """
    safe_old = _safe_name(name)
    safe_new = _safe_name(body.new_name)
    if not safe_old or not safe_new:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    src = settings.media_dir / safe_old
    dst = settings.media_dir / safe_new
    if not src.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    if dst.exists():
        raise HTTPException(status_code=409, detail="Target name already exists")

    db = await get_db()
    disk_renamed = False
    try:
        # 1. Stage all DB updates (not committed yet).
        old_prefix = safe_old + "/"
        cursor = await db.execute(
            "SELECT id, filepath, directory FROM media"
            " WHERE directory = ? OR directory LIKE ?",
            (safe_old, old_prefix + "%"),
        )
        rows = [dict(r) for r in await cursor.fetchall()]
        for row in rows:
            new_dir = safe_new if row["directory"] == safe_old else safe_new + row["directory"][len(safe_old):]
            new_fp = str(dst / Path(row["filepath"]).relative_to(src)) if row.get("filepath") else row.get("filepath")
            await db.execute(
                "UPDATE media SET directory=?, filepath=?, updated_at=datetime('now') WHERE id=?",
                (new_dir, new_fp, row["id"]),
            )

        # 2. Rename on disk. If this fails, no commit happens and the
        #    implicit transaction is discarded on close.
        src.rename(dst)
        disk_renamed = True

        # 3. Commit DB now that both halves succeeded.
        await db.commit()
    except Exception:
        if disk_renamed and dst.exists() and not src.exists():
            try:
                dst.rename(src)
            except OSError as revert_exc:
                _log(f"rename_folder revert FAILED {dst} -> {src}: {revert_exc}")
        raise
    finally:
        await db.close()

    return {"ok": True, "name": safe_new}


@router.delete("/folders/{name}")
async def delete_folder(name: str):
    """Delete a folder only if it is empty."""
    safe = _safe_name(name)
    target = settings.media_dir / safe
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    children = list(target.iterdir())
    if children:
        raise HTTPException(status_code=409, detail="Folder is not empty")
    target.rmdir()
    return {"ok": True}


@router.post("/folders/move")
async def move_media(body: MoveBody):
    """Move a media file to a different directory — DB row first, then disk.

    Same transactional pattern as rename_folder: stage the UPDATE, do the
    filesystem move, commit only if both succeed. On commit failure the
    file is moved back so observable state remains consistent.
    """
    db = await get_db()
    moved = False
    src: Path | None = None
    dest: Path | None = None
    try:
        item = await q.get_media(db, body.media_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Media not found")

        src = Path(item["filepath"]) if item.get("filepath") else None
        if src is None or not src.is_file():
            raise HTTPException(status_code=404, detail="Source file not found on disk")

        dest_dir = settings.media_dir / body.target_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / item["filename"]

        # 1. Stage DB update (not committed yet).
        await db.execute(
            "UPDATE media SET filepath=?, directory=?, updated_at=datetime('now') WHERE id=?",
            (str(dest), body.target_dir, body.media_id),
        )

        # 2. Move on disk.
        shutil.move(str(src), str(dest))
        moved = True

        # 3. Commit.
        await db.commit()
        return {"ok": True, "new_path": str(dest)}
    except HTTPException:
        raise
    except Exception:
        if moved and src is not None and dest is not None and dest.exists() and not src.exists():
            try:
                shutil.move(str(dest), str(src))
            except OSError as revert_exc:
                _log(f"move_media revert FAILED {dest} -> {src}: {revert_exc}")
        raise
    finally:
        await db.close()
