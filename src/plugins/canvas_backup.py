"""Canvas backup plugin — saves canvas state to shared/data/canvas_backups/ on disk."""
from __future__ import annotations

import json as _json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config.settings import settings
from src.shared import _log

router = APIRouter(prefix="/api/canvas", tags=["canvas"])

MAX_BACKUPS_PER_PROJECT = 20
_BACKUP_DIR_NAME = "canvas_backups"


class CanvasBackupRequest(BaseModel):
    project_id: str
    nodes: list[Any]
    edges: list[Any]
    viewport: dict[str, Any] | None = None


@router.post("/backup")
def save_canvas_backup(req: CanvasBackupRequest):
    backup_dir = settings.shared_root / "data" / _BACKUP_DIR_NAME / req.project_id
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"canvas_{ts}.json"
    filepath = backup_dir / filename

    payload = {
        "version": 2,
        "project_id": req.project_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "canvas": {
            "nodes": req.nodes,
            "edges": req.edges,
            "viewport": req.viewport,
        },
    }
    filepath.write_text(
        _json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
        newline="\n",
    )

    # Rotation: keep only the last MAX_BACKUPS_PER_PROJECT files
    existing = sorted(backup_dir.glob("canvas_*.json"))
    for old in existing[:-MAX_BACKUPS_PER_PROJECT]:
        try:
            old.unlink()
        except OSError as e:
            _log(f"canvas_backup: could not remove old backup {old.name}: {e}")

    remaining = len(existing)
    _log(f"canvas_backup: saved {filename} for {req.project_id} ({remaining} total)")
    return {"status": "ok", "file": filename, "total": remaining}


@router.get("/backup/open")
def open_backup_folder(project_id: str = Query(...)):
    backup_dir = settings.shared_root / "data" / _BACKUP_DIR_NAME / project_id
    backup_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.startfile(str(backup_dir))
    except Exception as e:
        _log(f"canvas_backup: could not open folder for {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok"}
