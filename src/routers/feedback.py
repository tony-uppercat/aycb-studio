"""Feedback router — user feedback and urgent fixes."""
from __future__ import annotations

import json as _json
from fastapi import APIRouter, Form, HTTPException

from src.shared import _log, FeedbackItem, FEEDBACK_FILE, FEEDBACK_ALL_FILE

router = APIRouter(prefix="/api", tags=["feedback"])


def _read_json(path, label: str) -> list:
    """Read a JSON array file. Backs up and resets on corruption."""
    if not path.exists():
        return []
    try:
        return _json.loads(path.read_text(encoding="utf-8"))
    except _json.JSONDecodeError as e:
        _log(f"{label} corrupt — backing up and resetting: {e}")
        path.rename(path.with_suffix(".json.corrupt"))
        return []


@router.post("/feedback")
def add_feedback(item: FeedbackItem):
    FEEDBACK_ALL_FILE.parent.mkdir(parents=True, exist_ok=True)
    entries = _read_json(FEEDBACK_ALL_FILE, "feedback/all.json")
    entries.append(item.model_dump())
    FEEDBACK_ALL_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    return {"status": "ok", "count": len(entries)}


@router.post("/feedback/urgent")
def add_urgent_feedback(item: FeedbackItem):
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    entries = _read_json(FEEDBACK_FILE, "feedback/urgent.json")
    entries.append(item.model_dump())
    FEEDBACK_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    _log(f"URGENT feedback: {item.text[:80]}")
    return {"status": "ok", "count": len(entries)}


@router.get("/feedback/urgent")
def get_urgent_feedback():
    entries = _read_json(FEEDBACK_FILE, "feedback/urgent.json")
    return {"entries": entries}


@router.delete("/feedback/urgent/{item_id}")
def resolve_urgent_feedback(item_id: str):
    if not FEEDBACK_FILE.exists():
        return {"status": "not_found"}
    entries = _read_json(FEEDBACK_FILE, "feedback/urgent.json")
    entries = [e for e in entries if e.get("id") != item_id]
    FEEDBACK_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    return {"status": "ok", "remaining": len(entries)}


@router.post("/console/notify")
def console_notify(text: str = Form(...), type: str = Form("info")):
    prefix = "[SUCCESS]" if type == "success" else "[CLAUDE]"
    _log(f"{prefix} {text}")
    return {"status": "ok"}
