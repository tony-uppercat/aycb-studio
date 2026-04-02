"""Prompt router — saved prompts and history."""
from __future__ import annotations

import json as _json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter

from src.shared import PromptBody

router = APIRouter(prefix="/api/prompt", tags=["prompt"])

_PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "prompts"
_PROMPT_FILE = _PROMPTS_DIR / "analyze.txt"
_PROMPT_HISTORY_FILE = _PROMPTS_DIR / "history.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_history() -> list[dict]:
    try:
        return _json.loads(_PROMPT_HISTORY_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, _json.JSONDecodeError):
        return []


def _save_to_history(text: str) -> None:
    history = _load_history()
    entry = {"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "prompt": text}
    if history and history[-1]["prompt"] == text:
        return
    history = (history + [entry])[-20:]
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _PROMPT_HISTORY_FILE.write_text(
        _json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def get_prompt():
    try:
        text = _PROMPT_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        text = ""
    return {"prompt": text}


@router.put("")
def put_prompt(body: PromptBody):
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _PROMPT_FILE.write_text(body.text, encoding="utf-8")
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
