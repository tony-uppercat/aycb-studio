"""Single source of truth for all model metadata.

Replaces the 13 duplicated registry sites flagged in v2 audit finding C3.
Backend providers (video_gen, fal_video_gen, atlas_video_gen,
vertex_video_gen, image_edit, shared) and the frontend (through the
/api/registry endpoint) all read from this one place.

Migration is incremental — during the rollover the provider modules keep
their own MODELS dicts and this file is kept consistent with them. Each
provider will drop its local dict in a follow-up PR (Phase 2 PR 7-9).
The `test_registry.py` suite guards against silent drift during that
window.

Pricing conventions:
- cost_per_call: flat USD per invocation (Gemini image, Flux image)
- cost_per_token: (input_per_1M, output_per_1M) in USD (chat models)
- cost_per_sec: {quality: USD_per_second} (video models)
Exactly one pricing field is populated per model; None for local/free.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal

Provider = Literal[
    "gemini",
    "claude",
    "imagen",
    "flux",
    "local",
    "ollama",
    "piapi",
    "fal",
    "atlas",
    "vertex",
]

Capability = Literal["text", "image", "edit", "video"]


@dataclass(frozen=True)
class Model:
    id: str
    name: str
    provider: Provider
    capability: Capability
    # Exactly one of these is populated; the rest are None.
    cost_per_call: float | None = None
    cost_per_token: tuple[float, float] | None = None
    cost_per_sec: dict[str, float] | None = None
    # Capabilities — empty tuple if unused for this model.
    aspect_ratios: tuple[str, ...] = ()
    allowed_durations: tuple[int, ...] = ()
    qualities: tuple[str, ...] = ()
    max_ref_images: int = 0
    deprecated: bool = False
    # Provider-specific endpoint hints — opaque to callers outside the
    # matching provider module. Kept in the registry so the provider
    # module can look up its own URL without needing a parallel dict.
    endpoint_t2v: str | None = None
    endpoint_i2v: str | None = None
    provider_model_id: str | None = None  # e.g. the Gemini-API model id
    task_type: str | None = None  # PiAPI task_type


# ── Text / LLM ──────────────────────────────────────────────────────────

_TEXT_MODELS: tuple[Model, ...] = (
    Model(
        id="gemini-3.1-pro-preview",
        name="Gemini 3.1 Pro",
        provider="gemini",
        capability="text",
        cost_per_token=(2.00, 12.00),
    ),
    Model(
        id="gemini-3.1-flash-lite-preview",
        name="Gemini 3.1 Flash-Lite",
        provider="gemini",
        capability="text",
        cost_per_token=(0.25, 1.50),
    ),
    Model(
        id="gemini-3-flash-preview",
        name="Gemini 3 Flash",
        provider="gemini",
        capability="text",
        cost_per_token=(0.50, 3.00),
    ),
    Model(
        id="gemini-2.5-flash",
        name="Gemini 2.5 Flash",
        provider="gemini",
        capability="text",
        cost_per_token=(0.30, 2.50),
        deprecated=True,
    ),
    Model(
        id="gemini-2.5-pro",
        name="Gemini 2.5 Pro",
        provider="gemini",
        capability="text",
        cost_per_token=(1.25, 10.00),
        deprecated=True,
    ),
    Model(
        id="claude-sonnet-4-6-20250620",
        name="Claude Sonnet 4.6",
        provider="claude",
        capability="text",
        cost_per_token=(3.00, 15.00),
    ),
    Model(
        id="claude-opus-4-6-20250620",
        name="Claude Opus 4.6",
        provider="claude",
        capability="text",
        cost_per_token=(15.00, 75.00),
    ),
    Model(
        id="claude-haiku-4-5-20251001",
        name="Claude Haiku 4.5",
        provider="claude",
        capability="text",
        cost_per_token=(0.80, 4.00),
    ),
)


# ── Image generation ────────────────────────────────────────────────────

_IMAGE_MODELS: tuple[Model, ...] = (
    Model(
        id="gemini-3.1-flash-image-preview",
        name="Nano Banana 2",
        provider="gemini",
        capability="image",
        cost_per_call=0.067,
        aspect_ratios=("1:1", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4",
                       "16:9", "9:16", "21:9", "4:1", "1:4", "8:1", "1:8"),
        qualities=("1K", "2K", "4K"),
    ),
    Model(
        id="gemini-3-pro-image-preview",
        name="Nano Banana Pro",
        provider="gemini",
        capability="image",
        cost_per_call=0.134,
        aspect_ratios=("1:1", "4:3", "3:4", "16:9", "9:16", "21:9"),
        qualities=("1K", "2K", "4K"),
    ),
    Model(
        id="flux-2-klein-4b",
        name="Flux 2 Klein 4B",
        provider="flux",
        capability="image",
        cost_per_call=0.014,
    ),
    Model(
        id="flux-2-klein-9b",
        name="Flux 2 Klein 9B",
        provider="flux",
        capability="image",
        cost_per_call=0.015,
    ),
    Model(
        id="local/flux-2-klein-4b",
        name="Flux 2 Klein 4B (Local)",
        provider="local",
        capability="image",
    ),
    Model(
        id="local/flux-2-klein-9b",
        name="Flux 2 Klein 9B (Local)",
        provider="local",
        capability="image",
    ),
)


# ── Image edit ──────────────────────────────────────────────────────────

_EDIT_MODELS: tuple[Model, ...] = (
    Model(
        id="imagen-3.0-capability-001",
        name="Imagen 3 (Vertex AI)",
        provider="imagen",
        capability="edit",
        cost_per_call=0.02,
    ),
)


# ── Video generation ────────────────────────────────────────────────────

_VIDEO_MODELS: tuple[Model, ...] = (
    # PiAPI
    Model(
        id="kling-3.0-omni",
        name="Kling 3.0 Omni",
        provider="piapi",
        capability="video",
        cost_per_sec={"720p": 0.10, "1080p": 0.15},
        aspect_ratios=("16:9", "9:16", "1:1"),
        qualities=("720p", "1080p"),
        allowed_durations=tuple(range(3, 16)),
        provider_model_id="kling",
        task_type="omni_video_generation",
    ),
    Model(
        id="seedance-2.0",
        name="Seedance 2.0",
        provider="piapi",
        capability="video",
        cost_per_sec={"standard": 0.15},
        aspect_ratios=("21:9", "16:9", "4:3", "1:1", "3:4", "9:16"),
        qualities=("standard",),
        allowed_durations=tuple(range(4, 16)),
        provider_model_id="seedance",
        task_type="seedance-2",
    ),
    Model(
        id="seedance-2.0-fast",
        name="Seedance 2.0 Fast",
        provider="piapi",
        capability="video",
        cost_per_sec={"standard": 0.10},
        aspect_ratios=("21:9", "16:9", "4:3", "1:1", "3:4", "9:16"),
        qualities=("standard",),
        allowed_durations=tuple(range(4, 16)),
        provider_model_id="seedance",
        task_type="seedance-2-fast",
    ),
    # fal.ai
    Model(
        id="fal-kling-v3-std",
        name="Kling 3.0 Omni Std (fal)",
        provider="fal",
        capability="video",
        cost_per_sec={"720p": 0.07},
        aspect_ratios=("16:9", "9:16", "1:1"),
        qualities=("720p",),
        allowed_durations=tuple(range(3, 16)),
        endpoint_t2v="fal-ai/kling-video/v3/standard/text-to-video",
        endpoint_i2v="fal-ai/kling-video/v3/standard/image-to-video",
    ),
    Model(
        id="fal-kling-v3-pro",
        name="Kling 3.0 Omni Pro (fal)",
        provider="fal",
        capability="video",
        cost_per_sec={"1080p": 0.10},
        aspect_ratios=("16:9", "9:16", "1:1"),
        qualities=("1080p",),
        allowed_durations=tuple(range(3, 16)),
        endpoint_t2v="fal-ai/kling-video/v3/pro/text-to-video",
        endpoint_i2v="fal-ai/kling-video/v3/pro/image-to-video",
    ),
    Model(
        id="fal-seedance-2.0",
        name="Seedance 2.0 (fal)",
        provider="fal",
        capability="video",
        cost_per_sec={"720p": 0.30},
        aspect_ratios=("21:9", "16:9", "4:3", "1:1", "3:4", "9:16"),
        qualities=("720p",),
        allowed_durations=tuple(range(4, 16)),
        endpoint_t2v="bytedance/seedance-2.0/text-to-video",
        endpoint_i2v="bytedance/seedance-2.0/image-to-video",
    ),
    # Atlas Cloud
    Model(
        id="atlas-seedance-2.0-fast",
        name="Seedance 2.0 Fast (Atlas)",
        provider="atlas",
        capability="video",
        cost_per_sec={"720p": 0.18},
        aspect_ratios=("21:9", "16:9", "4:3", "1:1", "3:4", "9:16"),
        qualities=("720p",),
        allowed_durations=tuple(range(4, 16)),
        endpoint_t2v="bytedance/seedance-2.0-fast/text-to-video",
        endpoint_i2v="bytedance/seedance-2.0-fast/image-to-video",
    ),
    Model(
        id="atlas-seedance-2.0",
        name="Seedance 2.0 (Atlas)",
        provider="atlas",
        capability="video",
        cost_per_sec={"720p": 0.25},
        aspect_ratios=("21:9", "16:9", "4:3", "1:1", "3:4", "9:16"),
        qualities=("720p",),
        allowed_durations=tuple(range(4, 16)),
        endpoint_t2v="bytedance/seedance-2.0/text-to-video",
        endpoint_i2v="bytedance/seedance-2.0/image-to-video",
    ),
    # Vertex / Veo
    Model(
        id="vertex-veo-3.1",
        name="Veo 3.1",
        provider="vertex",
        capability="video",
        cost_per_sec={"720p": 0.40, "1080p": 0.40},
        aspect_ratios=("16:9", "9:16"),
        qualities=("720p", "1080p"),
        allowed_durations=(4, 6, 8),
        max_ref_images=3,
        provider_model_id="veo-3.1-generate-preview",
    ),
    Model(
        id="vertex-veo-3.1-fast",
        name="Veo 3.1 Fast",
        provider="vertex",
        capability="video",
        cost_per_sec={"720p": 0.15},
        aspect_ratios=("16:9", "9:16"),
        qualities=("720p",),
        allowed_durations=(4, 6, 8),
        max_ref_images=3,
        provider_model_id="veo-3.1-fast-generate-preview",
    ),
)


# The Gemini image model also works for editing; it appears under both
# image and edit capabilities. We keep a single canonical entry under
# "image" and expose an alias for edit callers rather than duplicating.
_EDIT_ALIASES: tuple[str, ...] = ("gemini-3.1-flash-image-preview",)


REGISTRY: dict[str, Model] = {
    m.id: m for m in (*_TEXT_MODELS, *_IMAGE_MODELS, *_EDIT_MODELS, *_VIDEO_MODELS)
}


def get(model_id: str) -> Model | None:
    return REGISTRY.get(model_id)


def by_capability(cap: Capability) -> list[Model]:
    matches = [m for m in REGISTRY.values() if m.capability == cap]
    if cap == "edit":
        matches.extend(REGISTRY[mid] for mid in _EDIT_ALIASES if mid in REGISTRY)
    return matches


def by_provider(prov: Provider) -> list[Model]:
    return [m for m in REGISTRY.values() if m.provider == prov]


def to_dict(model: Model) -> dict:
    """Serialize to JSON-safe dict for the /api/registry endpoint."""
    d = asdict(model)
    # tuples become lists naturally via asdict; nothing else to fix.
    return d
