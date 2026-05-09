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
async def test_submit_text_to_video_rejects_motion_control_model():
    from src.atlas_video_gen import AtlasVideoGenError, submit_text_to_video
    with pytest.raises(AtlasVideoGenError, match="motion control"):
        await submit_text_to_video(
            api_key="k",
            model_id="atlas-kling-motion-control",
            prompt="walk",
        )


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


@pytest.mark.asyncio
async def test_submit_with_refs_dispatches_to_motion_control(httpx_mock):
    from src.atlas_video_gen import submit_with_refs
    httpx_mock.add_response(
        url="https://api.atlascloud.ai/api/v1/model/generateVideo",
        json={"data": {"id": "task-mc"}},
    )
    result = await submit_with_refs(
        api_key="k",
        model_id="atlas-kling-motion-control",
        prompt="walk",
        ref_image_bytes=[("s.png", b".")],
        ref_video_bytes=("m.mp4", b"."),
        character_orientation="video",
        duration=10,
    )
    assert result["request_id"] == "task-mc"
    import json as _json
    payload = _json.loads(httpx_mock.get_request().read().decode())
    assert payload["model"] == "kwaivgi/kling-v2.6-pro/motion-control"
    assert payload["character_orientation"] == "video"


@pytest.mark.asyncio
async def test_submit_with_refs_motion_control_requires_image_and_video():
    from src.atlas_video_gen import AtlasVideoGenError, submit_with_refs
    with pytest.raises(AtlasVideoGenError, match="motion control"):
        await submit_with_refs(
            api_key="k",
            model_id="atlas-kling-motion-control",
            prompt="walk",
            ref_image_bytes=[("s.png", b".")],  # no video
        )
    with pytest.raises(AtlasVideoGenError, match="motion control"):
        await submit_with_refs(
            api_key="k",
            model_id="atlas-kling-motion-control",
            prompt="walk",
            ref_image_bytes=None,
            ref_video_bytes=("m.mp4", b"."),  # no image
        )


@pytest.mark.asyncio
async def test_omni_pro_uses_ref2v_endpoint_with_2plus_images(httpx_mock):
    from src.atlas_video_gen import submit_with_refs
    httpx_mock.add_response(
        url="https://api.atlascloud.ai/api/v1/model/generateVideo",
        json={"data": {"id": "task-r2v"}},
    )
    await submit_with_refs(
        api_key="k",
        model_id="atlas-kling-v3-pro",
        prompt="multi-ref scene",
        ref_image_bytes=[("a.png", b"."), ("b.png", b"."), ("c.png", b".")],
        aspect_ratio="16:9",
        duration=8,
    )
    import json as _json
    payload = _json.loads(httpx_mock.get_request().read().decode())
    assert payload["model"] == "kwaivgi/kling-video-o3-pro/reference-to-video"
    assert isinstance(payload["images"], list)
    assert len(payload["images"]) == 3
    assert all(uri.startswith("data:image/") for uri in payload["images"])
    assert payload["aspect_ratio"] == "16:9"
    assert payload["duration"] == 8
    # ref2v uses multi-image key, NOT single-image keys.
    assert "image" not in payload
    assert "image_url" not in payload


@pytest.mark.asyncio
async def test_omni_pro_uses_i2v_endpoint_with_1_image(httpx_mock):
    from src.atlas_video_gen import submit_with_refs
    httpx_mock.add_response(
        url="https://api.atlascloud.ai/api/v1/model/generateVideo",
        json={"data": {"id": "task-i2v"}},
    )
    await submit_with_refs(
        api_key="k",
        model_id="atlas-kling-v3-pro",
        prompt="single-ref scene",
        ref_image_bytes=[("only.png", b".")],
        aspect_ratio="9:16",
        duration=5,
    )
    import json as _json
    payload = _json.loads(httpx_mock.get_request().read().decode())
    assert payload["model"] == "kwaivgi/kling-video-o3-pro/image-to-video"
    assert "image" in payload
    assert "images" not in payload


@pytest.mark.asyncio
async def test_omni_pro_ref2v_caps_at_4_images(httpx_mock):
    from src.atlas_video_gen import submit_with_refs
    httpx_mock.add_response(
        url="https://api.atlascloud.ai/api/v1/model/generateVideo",
        json={"data": {"id": "task-cap"}},
    )
    refs = [(f"r{i}.png", b".") for i in range(7)]
    await submit_with_refs(
        api_key="k", model_id="atlas-kling-v3-pro",
        prompt="x", ref_image_bytes=refs, duration=5,
    )
    import json as _json
    payload = _json.loads(httpx_mock.get_request().read().decode())
    assert len(payload["images"]) == 4
