"""Routes for folder management in shared/Media/."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config.settings import settings
from src.review_hub.db import get_db
from src.review_hub.queries import media as q

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
    """Strip path traversal and illegal characters from a folder name."""
    import re
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name.strip())
    # Prevent path traversal
    cleaned = cleaned.replace("..", "_")
    return cleaned[:100]


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
    """Rename a top-level project folder and update all DB records inside it."""
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
    src.rename(dst)

    # Update DB: directory and filepath for all media that lived under old name
    db = await get_db()
    try:
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
        if rows:
            await db.commit()
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
    db = await get_db()
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

        shutil.move(str(src), str(dest))

        await db.execute(
            "UPDATE media SET filepath=?, directory=?, updated_at=datetime('now') WHERE id=?",
            (str(dest), body.target_dir, body.media_id),
        )
        await db.commit()

        return {"ok": True, "new_path": str(dest)}
    finally:
        await db.close()
