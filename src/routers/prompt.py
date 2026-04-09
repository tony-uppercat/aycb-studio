"""Prompt router — saved prompts and history."""
from __future__ import annotations

import json as _json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from src.shared import PromptBody, PromptLibrarySave, PromptLibraryUpdate, _log

router = APIRouter(prefix="/api/prompt", tags=["prompt"])

_PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "prompts"
_PROMPT_FILE = _PROMPTS_DIR / "analyze.txt"
_PROMPT_HISTORY_FILE = _PROMPTS_DIR / "history.json"
_LIBRARY_FILE = _PROMPTS_DIR / "library.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_history() -> list[dict]:
    if not _PROMPT_HISTORY_FILE.exists():
        return []
    try:
        return _json.loads(_PROMPT_HISTORY_FILE.read_text(encoding="utf-8"))
    except _json.JSONDecodeError as e:
        _log(f"Prompt history corrupt — backing up and resetting: {e}")
        _PROMPT_HISTORY_FILE.rename(_PROMPT_HISTORY_FILE.with_suffix(".json.corrupt"))
        return []


def _save_to_history(text: str) -> None:
    history = _load_history()
    entry = {"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "prompt": text}
    if history and history[-1]["prompt"] == text:
        return
    history = (history + [entry])[-20:]
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _PROMPT_HISTORY_FILE.write_text(
        _json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n"
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def get_prompt():
    text = _PROMPT_FILE.read_text(encoding="utf-8") if _PROMPT_FILE.exists() else ""
    return {"prompt": text}


@router.put("")
def put_prompt(body: PromptBody):
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _PROMPT_FILE.write_text(body.text, encoding="utf-8", newline="\n")
    _save_to_history(body.text)
    return {"status": "saved"}


@router.get("/history")
def get_history():
    history = _load_history()
    choices = []
    for h in reversed(history):
        truncated = h["prompt"][:60] + ("..." if len(h["prompt"]) > 60 else "")
        choices.append({"label": f"[{h['timestamp']}] {truncated}", "prompt": h["prompt"]})
    return {"history": choices}


# ── Library ──────────────────────────────────────────────────────────────────

def _load_library() -> list[dict]:
    if not _LIBRARY_FILE.exists():
        return []
    try:
        return _json.loads(_LIBRARY_FILE.read_text(encoding="utf-8"))
    except _json.JSONDecodeError as e:
        _log(f"Prompt library corrupt — backing up and resetting: {e}")
        _LIBRARY_FILE.rename(_LIBRARY_FILE.with_suffix(".json.corrupt"))
        return []


def _save_library(entries: list[dict]) -> None:
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _LIBRARY_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False),
        encoding="utf-8",
        newline="\n",
    )


@router.get("/library")
def list_library():
    return {"prompts": _load_library()}


@router.post("/library", status_code=201)
def create_library_entry(body: PromptLibrarySave):
    entries = _load_library()
    entry = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "text": body.text,
        "tags": [t.strip().lower() for t in body.tags if t.strip()],
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    entries.append(entry)
    _save_library(entries)
    return entry


@router.put("/library/{entry_id}")
def update_library_entry(entry_id: str, body: PromptLibraryUpdate):
    entries = _load_library()
    for e in entries:
        if e["id"] == entry_id:
            if body.name is not None:
                e["name"] = body.name.strip()
            if body.text is not None:
                e["text"] = body.text
            if body.tags is not None:
                e["tags"] = [t.strip().lower() for t in body.tags if t.strip()]
            _save_library(entries)
            return e
    raise HTTPException(404, detail="Prompt not found")


@router.delete("/library/{entry_id}")
def delete_library_entry(entry_id: str):
    entries = _load_library()
    before = len(entries)
    entries = [e for e in entries if e["id"] != entry_id]
    if len(entries) == before:
        raise HTTPException(404, detail="Prompt not found")
    _save_library(entries)
    return {"status": "deleted"}
