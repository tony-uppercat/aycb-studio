"""Routes for server log buffer."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/rh", tags=["review-hub"])

MAX_ENTRIES = 200


@router.get("/logs")
async def get_logs(n: int = MAX_ENTRIES):
    """Return the last N entries from the shared server log buffer."""
    from src.shared import _log_buffer
    entries = list(_log_buffer)
    limit = max(1, min(n, MAX_ENTRIES))
    return {"logs": entries[-limit:], "total": len(entries)}
