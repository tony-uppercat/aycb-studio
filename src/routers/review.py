"""Review router — shared review checklist between AI and user."""
from __future__ import annotations

import json as _json
import time
from pathlib import Path
from typing import Union

from fastapi import APIRouter
from pydantic import BaseModel

from src.shared import _log

router = APIRouter(prefix="/api/review", tags=["review"])

REVIEW_FILE = Path(__file__).resolve().parent.parent.parent / "feedback" / "review.json"


class ReviewItem(BaseModel):
    id: str = ""
    text: str
    category: str = "frontend"  # frontend, backend, ci, cloud
    priority: str = "P1"  # P0, P1, P2
    status: str = "pending"  # pending, pass, fail
    note: str = ""
    session: str = ""


def _load_items() -> list[dict]:
    if not REVIEW_FILE.exists():
        return []
    try:
        return _json.loads(REVIEW_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_items(items: list[dict]) -> None:
    REVIEW_FILE.parent.mkdir(parents=True, exist_ok=True)
    REVIEW_FILE.write_text(
        _json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8"
    )


@router.get("/items")
def list_items():
    return {"items": _load_items()}


@router.post("/items")
def add_items(payload: Union[ReviewItem, list[ReviewItem]]):
    items = _load_items()
    incoming = payload if isinstance(payload, list) else [payload]
    today = time.strftime("%Y-%m-%d")
    for item in incoming:
        d = item.model_dump()
        if not d["id"]:
            d["id"] = f"rv_{int(time.time() * 1000)}"
            time.sleep(0.002)  # ensure unique ids for batch
        if not d["session"]:
            d["session"] = today
        items.append(d)
    _save_items(items)
    _log(f"Review: added {len(incoming)} item(s)")
    return {"status": "ok", "count": len(items)}


@router.patch("/items/{item_id}")
def update_item(item_id: str, patch: dict):
    items = _load_items()
    found = False
    for item in items:
        if item.get("id") == item_id:
            for key in ("status", "note", "text", "category", "priority"):
                if key in patch:
                    item[key] = patch[key]
            found = True
            break
    if not found:
        return {"status": "not_found"}
    _save_items(items)
    return {"status": "ok"}


@router.delete("/items/{item_id}")
def delete_item(item_id: str):
    items = _load_items()
    before = len(items)
    items = [i for i in items if i.get("id") != item_id]
    _save_items(items)
    return {"status": "ok" if len(items) < before else "not_found", "remaining": len(items)}


@router.post("/clear")
def clear_passed():
    items = _load_items()
    before = len(items)
    items = [i for i in items if i.get("status") != "pass"]
    _save_items(items)
    cleared = before - len(items)
    _log(f"Review: cleared {cleared} passed item(s)")
    return {"status": "ok", "cleared": cleared, "remaining": len(items)}


@router.post("/carry-over")
def carry_over():
    items = _load_items()
    today = time.strftime("%Y-%m-%d")
    carried = 0
    for item in items:
        if item.get("status") in ("pending", "fail"):
            item["session"] = today
            carried += 1
    _save_items(items)
    _log(f"Review: carried over {carried} item(s) to {today}")
    return {"status": "ok", "carried": carried}
