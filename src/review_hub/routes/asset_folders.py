"""Routes for folder management in shared/Assets/."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config.settings import settings

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class CreateAssetFolderBody(BaseModel):
    path: str  # e.g. "Characters" or "Characters/Season2"


class RenameAssetFolderBody(BaseModel):
    new_name: str  # just the new leaf name


def _safe_segment(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name.strip())
    cleaned = cleaned.replace("..", "_")
    return cleaned[:100]


def _safe_path(path: str) -> str:
    """Sanitize a slash-separated folder path."""
    parts = [_safe_segment(p) for p in path.replace("\\", "/").split("/") if p.strip()]
    return "/".join(parts)


@router.get("/asset-folders")
async def list_asset_folders(parent: str | None = None):
    """List immediate subfolders of a given parent path (or root if omitted)."""
    settings.assets_dir.mkdir(parents=True, exist_ok=True)
    base = settings.assets_dir / _safe_path(parent) if parent else settings.assets_dir
    if not base.is_dir():
        return {"folders": []}
    folders = sorted(d.name for d in base.iterdir() if d.is_dir())
    return {"folders": folders}


@router.post("/asset-folders")
async def create_asset_folder(body: CreateAssetFolderBody):
    """Create folder at shared/Assets/{path}."""
    safe = _safe_path(body.path)
    if not safe:
        raise HTTPException(status_code=400, detail="path is required")
    target = settings.assets_dir / safe
    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")
    target.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": safe}


@router.delete("/asset-folders")
async def delete_asset_folder(path: str):
    """Delete a folder (must be empty)."""
    safe = _safe_path(path)
    target = settings.assets_dir / safe
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    if any(target.iterdir()):
        raise HTTPException(status_code=409, detail="Folder is not empty")
    target.rmdir()
    return {"ok": True}


@router.post("/asset-folders/rename")
async def rename_asset_folder(path: str, body: RenameAssetFolderBody):
    """Rename a folder's leaf segment."""
    safe_path = _safe_path(path)
    safe_new = _safe_segment(body.new_name)
    if not safe_new:
        raise HTTPException(status_code=400, detail="new_name is required")
    src = settings.assets_dir / safe_path
    if not src.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    dst = src.parent / safe_new
    if dst.exists():
        raise HTTPException(status_code=409, detail="Target name already exists")
    src.rename(dst)
    return {"ok": True, "new_path": str(Path(safe_path).parent / safe_new).replace("\\", "/")}
