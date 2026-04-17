"""Local image generation using diffusers (Flux, SDXL, etc.)

Requires: pip install aycb[local]
"""
from __future__ import annotations

import base64
import io
import logging
import threading
from dataclasses import dataclass

from PIL import Image as PILImage

logger = logging.getLogger(__name__)

# Pipeline cache — load once, reuse across requests
_pipeline_lock = threading.Lock()
_loaded: dict[str, object] = {}  # model_id -> pipeline


@dataclass
class LocalGPUInfo:
    available: bool
    device: str
    name: str
    vram_gb: float
    loaded_models: list[str]


def gpu_info() -> LocalGPUInfo:
    """Return GPU info without importing torch at module level."""
    try:
        import torch

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            return LocalGPUInfo(
                available=True,
                device="cuda",
                name=props.name,
                vram_gb=round(props.total_memory / 1024**3, 1),
                loaded_models=list(_loaded.keys()),
            )
    except ImportError:
        logger.debug("torch not available — reporting CPU-only")
    return LocalGPUInfo(available=False, device="cpu", name="CPU", vram_gb=0, loaded_models=[])


# Supported local models
LOCAL_MODELS = {
    "flux-dev": "black-forest-labs/FLUX.1-dev",
    "flux-schnell": "black-forest-labs/FLUX.1-schnell",
    "flux-2-klein-4b": "black-forest-labs/FLUX.2-klein-4B",
    "sdxl": "stabilityai/stable-diffusion-xl-base-1.0",
}

# Models that need Flux2KleinPipeline instead of AutoPipeline
_KLEIN_MODELS = {"flux-2-klein-4b"}


def _load_pipeline(model_id: str):
    """Load a diffusers pipeline, cached per model_id."""
    with _pipeline_lock:
        if model_id in _loaded:
            return _loaded[model_id]

        import torch

        hf_id = LOCAL_MODELS.get(model_id, model_id)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if device == "cuda" else torch.float32

        logger.info("Loading %s (%s) on %s...", model_id, hf_id, device)

        if model_id in _KLEIN_MODELS:
            from diffusers import Flux2KleinPipeline
            pipe = Flux2KleinPipeline.from_pretrained(
                hf_id,
                torch_dtype=dtype,
            )
        else:
            from diffusers import AutoPipelineForText2Image
            pipe = AutoPipelineForText2Image.from_pretrained(
                hf_id,
                torch_dtype=dtype,
            )

        pipe.to(device)

        # Enable memory optimizations
        if device == "cuda":
            try:
                pipe.enable_model_cpu_offload()
            except Exception as e:
                logger.debug("cpu_offload not supported for %s: %s", model_id, e)

        _loaded[model_id] = pipe
        logger.info("Loaded %s successfully", model_id)
        return pipe


def generate(
    prompt: str,
    model_id: str = "flux-schnell",
    width: int = 1024,
    height: int = 1024,
    num_inference_steps: int | None = None,
    guidance_scale: float | None = None,
) -> str:
    """Generate image, return base64 PNG string."""
    pipe = _load_pipeline(model_id)

    kwargs: dict = {
        "prompt": prompt,
        "width": width,
        "height": height,
    }
    if num_inference_steps is not None:
        kwargs["num_inference_steps"] = num_inference_steps
    if guidance_scale is not None:
        kwargs["guidance_scale"] = guidance_scale

    # Defaults per model
    if "klein" in model_id and num_inference_steps is None:
        kwargs["num_inference_steps"] = 4
    elif "schnell" in model_id and num_inference_steps is None:
        kwargs["num_inference_steps"] = 4
    elif "flux" in model_id and num_inference_steps is None:
        kwargs["num_inference_steps"] = 28

    with _pipeline_lock:
        result = pipe(**kwargs)
    image: PILImage.Image = result.images[0]

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def unload(model_id: str | None = None) -> list[str]:
    """Unload model(s) to free VRAM. Returns list of unloaded models."""
    import gc

    with _pipeline_lock:
        if model_id:
            if model_id in _loaded:
                del _loaded[model_id]
                unloaded = [model_id]
            else:
                return []
        else:
            unloaded = list(_loaded.keys())
            _loaded.clear()

    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        logger.debug("torch not available — skipping CUDA cache clear")

    return unloaded
