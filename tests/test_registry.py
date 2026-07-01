"""Tests for src/registry.py and /api/registry/* endpoints.

The registry is a new single source of truth; the existing provider
dicts (video_gen.MODELS, veo_gen.MODELS, etc.) are kept
during rollover. These tests guard against drift between the two
during that window.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from src.api import app
    return TestClient(app)


# ── registry contents ──────────────────────────────────────────────────

def test_registry_covers_all_video_providers():
    """Every backend MODELS entry must have a registry counterpart with
    matching cost_per_sec / aspect_ratios. Drift = bug."""
    from src.registry import REGISTRY
    from src import video_gen, fal_video_gen, atlas_video_gen, veo_gen

    for source in (video_gen, fal_video_gen, atlas_video_gen, veo_gen):
        for model_id, info in source.MODELS.items():
            assert model_id in REGISTRY, f"{model_id} missing from registry"
            reg = REGISTRY[model_id]
            assert reg.cost_per_sec == info["cost_per_sec"], f"{model_id} cost drift"
            assert tuple(info["aspect_ratios"]) == reg.aspect_ratios, f"{model_id} aspect drift"


def test_registry_has_gemini_image_models_at_correct_price():
    from src.registry import REGISTRY
    m = REGISTRY["gemini-3.1-flash-image"]
    assert m.cost_per_call == 0.067
    assert m.capability == "image"
    assert m.provider == "gemini"


def test_registry_has_nano_banana_2_lite():
    """NB2 Lite is the half-price speed/cost image model (GA id)."""
    from src.registry import REGISTRY
    m = REGISTRY["gemini-3.1-flash-lite-image"]
    assert m.cost_per_call == 0.034
    assert m.capability == "image"
    assert m.provider == "gemini"


def test_registry_has_gemini_omni_flash_video():
    """Gemini Omni Flash — native Gemini video, 720p @ $0.10/s."""
    from src.registry import REGISTRY
    m = REGISTRY["gemini-omni-flash"]
    assert m.capability == "video"
    assert m.provider == "gemini"
    assert m.cost_per_sec == {"720p": 0.10}
    assert m.provider_model_id == "gemini-omni-flash-preview"


def test_registry_llm_pricing_matches_shared_module():
    from src.registry import REGISTRY
    from src.shared import MODEL_PRICING

    for mid, (inp, out) in MODEL_PRICING.items():
        if mid not in REGISTRY:
            continue  # image models live in REGISTRY under image capability
        reg = REGISTRY[mid]
        if reg.cost_per_token is None:
            continue
        assert reg.cost_per_token == (inp, out), f"{mid} pricing drift"


# ── /api/registry endpoints ─────────────────────────────────────────────

def test_list_models_returns_all(client):
    resp = client.get("/api/registry/models")
    assert resp.status_code == 200
    data = resp.json()
    ids = {m["id"] for m in data["models"]}
    # Spot-check representative entries from each capability.
    assert "gemini-3.1-flash-image" in ids
    assert "vertex-veo-3.1" in ids
    assert "claude-opus-4-6-20250620" in ids
    assert "flux-2-klein-4b" in ids


def test_list_by_capability_filters(client):
    resp = client.get("/api/registry/models/video")
    assert resp.status_code == 200
    data = resp.json()
    assert all(m["capability"] == "video" for m in data["models"])


def test_list_by_capability_rejects_unknown(client):
    resp = client.get("/api/registry/models/nope")
    assert resp.status_code == 400


def test_edit_capability_includes_gemini_alias(client):
    """Gemini image model is also used for editing; its edit appearance
    is served via an alias so callers don't need to know about the
    underlying image-model entry."""
    resp = client.get("/api/registry/models/edit")
    assert resp.status_code == 200
    ids = {m["id"] for m in resp.json()["models"]}
    assert "gemini-3.1-flash-image" in ids
    assert "imagen-3.0-capability-001" in ids


def test_dataclass_serializes_tuples_as_lists(client):
    """Tuples become JSON arrays via asdict — frontend consumers expect
    arrays, not the bespoke tuple syntax."""
    resp = client.get("/api/registry/models")
    veo = next(m for m in resp.json()["models"] if m["id"] == "vertex-veo-3.1")
    assert veo["allowed_durations"] == [4, 6, 8]
    assert isinstance(veo["aspect_ratios"], list)


# ── motion control + Omni cleanup ──────────────────────────────────────

def test_atlas_kling_motion_control_registered():
    from src.registry import REGISTRY
    m = REGISTRY["atlas-kling-motion-control"]
    assert m.provider == "atlas"
    assert m.capability == "video"
    assert m.endpoint_t2v == "kwaivgi/kling-v2.6-pro/motion-control"
    assert m.cost_per_sec == {"720p": 0.112}
    assert m.allowed_durations == (5, 10, 15, 30)


def test_atlas_kling_omni_std_registered():
    from src.registry import REGISTRY
    m = REGISTRY["atlas-kling-omni-std"]
    assert m.provider == "atlas"
    assert m.endpoint_t2v == "kwaivgi/kling-video-o3-std/text-to-video"
    assert m.endpoint_i2v == "kwaivgi/kling-video-o3-std/image-to-video"
    assert m.cost_per_sec == {"720p": 0.071}
    assert min(m.allowed_durations) == 3 and max(m.allowed_durations) == 15


def test_atlas_kling_v3_pro_renamed_and_has_ref2v():
    from src.registry import REGISTRY
    m = REGISTRY["atlas-kling-v3-pro"]
    assert m.name == "Kling 3.0 Omni Pro (Atlas)"
    assert m.endpoint_ref2v == "kwaivgi/kling-video-o3-pro/reference-to-video"
    assert min(m.allowed_durations) == 3 and max(m.allowed_durations) == 15


# ── LLM text-model lineup (2026-05-14 update) ──────────────────────────

def test_registry_has_flash_lite_ga():
    """Flash-Lite GA was released 2026-05-07; preview shuts down 2026-05-25."""
    from src.registry import REGISTRY
    m = REGISTRY["gemini-3.1-flash-lite"]
    assert m.cost_per_token == (0.25, 1.50)
    assert m.capability == "text"
    assert m.provider == "gemini"
    assert m.deprecated is False


def test_registry_drops_flash_lite_preview():
    """Preview id removed in favor of GA — saved canvases migrate via MODEL_MAP."""
    from src.registry import REGISTRY
    assert "gemini-3.1-flash-lite-preview" not in REGISTRY


def test_registry_drops_gemini_2_5_text_models():
    """gemini-2.5-flash and gemini-2.5-pro shut down 2026-10-16; removed early."""
    from src.registry import REGISTRY
    assert "gemini-2.5-flash" not in REGISTRY
    assert "gemini-2.5-pro" not in REGISTRY


def test_shared_model_pricing_has_flash_lite_ga():
    from src.shared import MODEL_PRICING
    assert MODEL_PRICING["gemini-3.1-flash-lite"] == (0.25, 1.50)


def test_shared_model_pricing_keeps_preview_alias_for_transition():
    """Saved canvases still pass the -preview id to estimateCost. Keep the
    alias entry until 2026-06-30 so the cost display doesn't fall to $0."""
    from src.shared import MODEL_PRICING
    assert MODEL_PRICING["gemini-3.1-flash-lite-preview"] == (0.25, 1.50)


def test_shared_model_pricing_drops_gemini_2_5():
    from src.shared import MODEL_PRICING
    assert "gemini-2.5-flash" not in MODEL_PRICING
    assert "gemini-2.5-pro" not in MODEL_PRICING


def test_shared_models_display_map_points_to_ga():
    from src.shared import MODELS
    assert MODELS["Gemini 3.1 Flash-Lite"] == "gemini-3.1-flash-lite"
