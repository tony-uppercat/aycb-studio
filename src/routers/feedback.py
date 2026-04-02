"""Feedback router — user feedback and urgent fixes."""
from __future__ import annotations

import json as _json
from fastapi import APIRouter, Form

from src.shared import _log, FeedbackItem, FEEDBACK_FILE, FEEDBACK_ALL_FILE

router = APIRouter(prefix="/api", tags=["feedback"])


@router.post("/feedback")
def add_feedback(item: FeedbackItem):
    FEEDBACK_ALL_FILE.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    if FEEDBACK_ALL_FILE.exists():
        try:
            entries = _json.loads(FEEDBACK_ALL_FILE.read_text(encoding="utf-8"))
        except Exception:
            entries = []
    entries.append(item.model_dump())
    FEEDBACK_ALL_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return {"status": "ok", "count": len(entries)}


@router.post("/feedback/urgent")
def add_urgent_feedback(item: FeedbackItem):
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    if FEEDBACK_FILE.exists():
        try:
            entries = _json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))
        except Exception:
            entries = []
    entries.append(item.model_dump())
    FEEDBACK_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    _log(f"URGENT feedback: {item.text[:80]}")
    return {"status": "ok", "count": len(entries)}


@router.get("/feedback/urgent")
def get_urgent_feedback():
    if not FEEDBACK_FILE.exists():
        return {"entries": []}
    try:
        return {"entries": _json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))}
    except Exception:
        return {"entries": []}


@router.delete("/feedback/urgent/{item_id}")
def resolve_urgent_feedback(item_id: str):
    if not FEEDBACK_FILE.exists():
        return {"status": "not_found"}
    entries = _json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))
    entries = [e for e in entries if e.get("id") != item_id]
    FEEDBACK_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return {"status": "ok", "remaining": len(entries)}


@router.post("/console/notify")
def console_notify(text: str = Form(...), type: str = Form("info")):
    prefix = "[SUCCESS]" if type == "success" else "[CLAUDE]"
    _log(f"{prefix} {text}")
    return {"status": "ok"}
