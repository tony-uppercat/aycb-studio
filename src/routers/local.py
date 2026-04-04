"""Local GPU router — status, generation, unload."""
from __future__ import annotations

from fastapi import APIRouter, Form

from src.shared import _log

router = APIRouter(prefix="/api/local", tags=["local"])


@router.get("/gpu")
def local_gpu_info():
    """Return local GPU info — used by frontend to check availability."""
    try:
        from src.local_gen import gpu_info
        info = gpu_info()
        return {
            "available": info.available,
            "device": info.device,
            "name": info.name,
            "vram_gb": info.vram_gb,
            "loaded_models": info.loaded_models,
            "supported_models": ["flux-schnell", "flux-dev", "flux-2-klein-4b", "sdxl"],
        }
    except ImportError:
        _log("local_gen not available — diffusers not installed")
        return {
            "available": False,
            "device": "cpu",
            "name": "diffusers not installed",
            "vram_gb": 0,
            "loaded_models": [],
            "supported_models": [],
        }


@router.post("/unload")
def local_unload(model_id: str = Form("")):
    """Unload model(s) from GPU to free VRAM."""
    try:
        from src.local_gen import unload
        removed = unload(model_id if model_id else None)
        return {"unloaded": removed}
    except ImportError:
        _log("local_gen not available — cannot unload models")
        return {"unloaded": []}
