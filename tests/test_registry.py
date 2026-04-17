"""Tests for src/registry.py and /api/registry/* endpoints.

The registry is a new single source of truth; the existing provider
dicts (video_gen.MODELS, vertex_video_gen.MODELS, etc.) are kept
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
    from src import video_gen, fal_video_gen, atlas_video_gen, vertex_video_gen

    for source in (video_gen, fal_video_gen, atlas_video_gen, vertex_video_gen):
        for model_id, info in source.MODELS.items():
            assert model_id in REGISTRY, f"{model_id} missing from registry"
            reg = REGISTRY[model_id]
            assert reg.cost_per_sec == info["cost_per_sec"], f"{model_id} cost drift"
            assert tuple(info["aspect_ratios"]) == reg.aspect_ratios, f"{model_id} aspect drift"


def test_registry_has_gemini_image_models_at_correct_price():
    from src.registry import REGISTRY
    m = REGISTRY["gemini-3.1-flash-image-preview"]
    assert m.cost_per_call == 0.067
    assert m.capability == "image"
    assert m.provider == "gemini"


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
    assert "gemini-3.1-flash-image-preview" in ids
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
    assert "gemini-3.1-flash-image-preview" in ids
    assert "imagen-3.0-capability-001" in ids


def test_dataclass_serializes_tuples_as_lists(client):
    """Tuples become JSON arrays via asdict — frontend consumers expect
    arrays, not the bespoke tuple syntax."""
    resp = client.get("/api/registry/models")
    veo = next(m for m in resp.json()["models"] if m["id"] == "vertex-veo-3.1")
    assert veo["allowed_durations"] == [4, 6, 8]
    assert isinstance(veo["aspect_ratios"], list)
