"""GET /api/llm/skills — list Agent Skills the Claude-CLI LLM node can fire.
Auto-discovered plugin router (rule 3). Thin wrapper over src.skill_scanner."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src import skill_scanner
from src.shared import _log

router = APIRouter(prefix="/api/llm", tags=["llm"])


def _collect() -> list[dict]:
    return skill_scanner.scan_skills(skill_scanner.default_skill_paths())


@router.get("/skills")
async def list_skills_endpoint():
    try:
        return {"skills": _collect()}
    except Exception as exc:  # surfaced, not swallowed (rule 12)
        _log(f"skill_list: scan failed — {exc}")
        raise HTTPException(500, detail=f"Skill scan failed: {exc}")
