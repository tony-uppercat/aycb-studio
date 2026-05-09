"""Tests for Atlas Cloud video generation adapter."""
from __future__ import annotations

import pytest


def test_is_motion_control_detects_v26_pro():
    from src.atlas_video_gen import _is_motion_control
    assert _is_motion_control("kwaivgi/kling-v2.6-pro/motion-control")
    assert _is_motion_control("kwaivgi/kling-v3.0-pro/motion-control")  # future-proof
    assert not _is_motion_control("kwaivgi/kling-v3.0-std/text-to-video")
    assert not _is_motion_control("kwaivgi/kling-video-o3-pro/image-to-video")


def test_models_dict_propagates_endpoint_ref2v():
    from src.atlas_video_gen import MODELS
    assert MODELS["atlas-kling-v3-pro"]["model_id_ref2v"] == \
        "kwaivgi/kling-video-o3-pro/reference-to-video"
    # Models without ref2v capability should have None.
    assert MODELS["atlas-seedance-2.0"]["model_id_ref2v"] is None
