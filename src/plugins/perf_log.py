"""Browser performance & error log endpoint.

Accepts batched events from the frontend perfLogger and appends them
to shared/data/browser-perf.jsonl. Auto-rotates at 1 MB.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from config.settings import settings
from src.shared import _log

router = APIRouter(prefix="/api", tags=["perf"])

_MAX_FILE_SIZE = 1_048_576  # 1 MB


class PerfEvent(BaseModel):
    type: str
    message: str | None = None
    timestamp: str | None = None
    value: float | None = None
    extra: dict | None = None


class PerfBatch(BaseModel):
    events: list[PerfEvent]


def _log_path() -> Path:
    d = settings.shared_root / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d / "browser-perf.jsonl"


@router.post("/perf")
async def receive_perf(batch: PerfBatch):
    path = _log_path()

    # Rotate: if file exceeds limit, keep last half
    if path.exists() and path.stat().st_size > _MAX_FILE_SIZE:
        lines = path.read_text(encoding="utf-8").splitlines()
        half = lines[len(lines) // 2 :]
        path.write_text("\n".join(half) + "\n", encoding="utf-8", newline="\n")
        _log(f"perf log rotated — kept {len(half)} of {len(lines)} lines")

    now = datetime.now().isoformat()
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        for ev in batch.events:
            row = {"type": ev.type, "ts": ev.timestamp or now}
            if ev.message:
                row["msg"] = ev.message
            if ev.value is not None:
                row["val"] = ev.value
            if ev.extra:
                row["extra"] = ev.extra
            f.write(json.dumps(row) + "\n")

    return {"ok": True, "count": len(batch.events)}
