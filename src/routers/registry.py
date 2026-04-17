"""Registry router — exposes the single source of truth for models.

Lets the frontend drop its four parallel dicts (IMAGE_MODELS, VIDEO_MODELS,
MODEL_MAP, BFL_MODELS + pricing tables) in favor of a single cached fetch.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.registry import REGISTRY, by_capability, to_dict

router = APIRouter(prefix="/api/registry", tags=["registry"])


@router.get("/models")
async def list_models():
    """Return every registered model, serialized for client consumption."""
    return {"models": [to_dict(m) for m in REGISTRY.values()]}


@router.get("/models/{capability}")
async def list_by_capability(capability: str):
    """Return models filtered by capability (text/image/edit/video)."""
    if capability not in ("text", "image", "edit", "video"):
        raise HTTPException(status_code=400, detail=f"Unknown capability: {capability}")
    return {"models": [to_dict(m) for m in by_capability(capability)]}
