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


@pytest.mark.asyncio
async def test_motion_control_payload_uses_image_video_orientation(httpx_mock):
    from src.atlas_video_gen import submit_motion_control
    httpx_mock.add_response(
        url="https://api.atlascloud.ai/api/v1/model/generateVideo",
        json={"data": {"id": "task-123"}},
        status_code=200,
    )
    result = await submit_motion_control(
        api_key="k",
        model_id="atlas-kling-motion-control",
        prompt="cinematic walk",
        subject_image_bytes=("subject.png", b"\x89PNG..."),
        motion_video_bytes=("motion.mp4", b"\x00\x00\x00..."),
        character_orientation="image",
        duration=10,
        keep_original_sound=False,
    )
    assert result == {"request_id": "task-123", "status": "pending"}
    req = httpx_mock.get_request()
    body = req.read().decode()
    import json as _json
    payload = _json.loads(body)
    assert payload["model"] == "kwaivgi/kling-v2.6-pro/motion-control"
    assert payload["character_orientation"] == "image"
    assert payload["duration"] == 10
    assert payload["keep_original_sound"] is False
    assert payload["image"].startswith("data:image/png;base64,")
    assert payload["video"].startswith("data:video/mp4;base64,")
    # Must NOT contain Seedance/Kling i2v keys.
    assert "image_url" not in payload
    assert "ratio" not in payload
    assert "aspect_ratio" not in payload
    assert "resolution" not in payload
    assert "generate_audio" not in payload
    assert "seed" not in payload


@pytest.mark.asyncio
async def test_motion_control_rejects_invalid_orientation():
    from src.atlas_video_gen import AtlasVideoGenError, submit_motion_control
    with pytest.raises(AtlasVideoGenError, match="character_orientation"):
        await submit_motion_control(
            api_key="k",
            model_id="atlas-kling-motion-control",
            prompt="x",
            subject_image_bytes=("s.png", b"."),
            motion_video_bytes=("m.mp4", b"."),
            character_orientation="left",
            duration=5,
        )


@pytest.mark.asyncio
async def test_motion_control_includes_negative_prompt_when_provided(httpx_mock):
    from src.atlas_video_gen import submit_motion_control
    httpx_mock.add_response(
        url="https://api.atlascloud.ai/api/v1/model/generateVideo",
        json={"data": {"id": "task-456"}},
    )
    await submit_motion_control(
        api_key="k", model_id="atlas-kling-motion-control",
        prompt="walk", subject_image_bytes=("s.png", b"."),
        motion_video_bytes=("m.mp4", b"."),
        character_orientation="video", duration=5,
        negative_prompt="blur, low quality",
    )
    import json as _json
    payload = _json.loads(httpx_mock.get_request().read().decode())
    assert payload["negative_prompt"] == "blur, low quality"
