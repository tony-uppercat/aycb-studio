# Atlas Kling Motion Control + Omni Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Atlas Cloud's Kling v2.6 Pro motion-control model and Kling 3.0 Omni Std model, route multi-image requests on the existing Omni Pro entry to `reference-to-video`, and surface a `character_orientation` selector in the Generate Video node when motion-control is selected.

**Architecture:** Motion control reuses the existing Generate Video node — selecting model `atlas-kling-motion-control` switches the node into a derived `'motion-control'` mode that requires both the connected image and the connected video-ref. The Atlas adapter dispatches by endpoint substring: a new `submit_motion_control()` for the v2.6 Pro endpoint, an extended `submit_with_refs()` that auto-routes to `reference-to-video` when 2+ images are present and the model has an `endpoint_ref2v`. Registry gets one new field (`endpoint_ref2v`), two new entries, and one rename.

**Tech Stack:** Python 3.14, FastAPI, httpx (with httpx-mock for tests), React 19, TypeScript 5.9, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-05-09-atlas-kling-motion-control-and-omni-design.md`.

---

## Task 1: Registry changes — new field, 2 new entries, 1 rename

**Files:**
- Modify: `src/registry.py`
- Test: `tests/test_registry.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_registry.py` after `test_registry_llm_pricing_matches_shared_module`:

```python
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_registry.py -k "motion_control or omni_std or v3_pro_renamed" -v`
Expected: 3 FAIL — `KeyError: 'atlas-kling-motion-control'` etc.

- [ ] **Step 3: Add `endpoint_ref2v` field to Model dataclass**

In `src/registry.py`, after the existing `endpoint_i2v: str | None = None` line in the `Model` dataclass:

```python
    endpoint_ref2v: str | None = None
```

- [ ] **Step 4: Add the two new entries**

In `src/registry.py`, inside `_VIDEO_MODELS = (...)`, just before the `# Vertex / Veo` comment line (right after the `atlas-kling-v3-pro` Model entry), insert:

```python
    Model(
        id="atlas-kling-motion-control",
        name="Kling Motion Control (Atlas)",
        provider="atlas",
        capability="video",
        cost_per_sec={"720p": 0.112},
        aspect_ratios=("9:16", "16:9", "1:1"),
        qualities=("720p",),
        allowed_durations=(5, 10, 15, 30),
        tooltip="Atlas Cloud — Kling 2.6 Pro motion transfer (image + ref video)",
        endpoint_t2v="kwaivgi/kling-v2.6-pro/motion-control",
    ),
    Model(
        id="atlas-kling-omni-std",
        name="Kling 3.0 Omni Std (Atlas)",
        provider="atlas",
        capability="video",
        cost_per_sec={"720p": 0.071},
        aspect_ratios=("16:9", "9:16", "1:1"),
        qualities=("720p",),
        allowed_durations=tuple(range(3, 16)),
        tooltip="Atlas Cloud — Kling 3.0 Omni Std (O3), 3-15s",
        endpoint_t2v="kwaivgi/kling-video-o3-std/text-to-video",
        endpoint_i2v="kwaivgi/kling-video-o3-std/image-to-video",
    ),
```

- [ ] **Step 5: Modify the existing `atlas-kling-v3-pro` entry**

In `src/registry.py`, replace the existing `atlas-kling-v3-pro` Model entry with:

```python
    Model(
        id="atlas-kling-v3-pro",
        name="Kling 3.0 Omni Pro (Atlas)",
        provider="atlas",
        capability="video",
        cost_per_sec={"720p": 0.095},
        aspect_ratios=("16:9", "9:16", "1:1"),
        qualities=("720p",),
        allowed_durations=tuple(range(3, 16)),
        tooltip="Atlas Cloud — Kling 3.0 Omni Pro (O3), 3-15s, multi-ref + lip-sync",
        endpoint_t2v="kwaivgi/kling-video-o3-pro/text-to-video",
        endpoint_i2v="kwaivgi/kling-video-o3-pro/image-to-video",
        endpoint_ref2v="kwaivgi/kling-video-o3-pro/reference-to-video",
    ),
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `python -m pytest tests/test_registry.py -v`
Expected: all PASS (3 new + existing).

- [ ] **Step 7: Commit**

```bash
git add src/registry.py tests/test_registry.py
git commit -m "[feat] registry — add Atlas Kling motion-control + Omni Std, rename Pro"
```

---

## Task 2: Atlas adapter — `_is_motion_control` helper + propagate `endpoint_ref2v`

**Files:**
- Modify: `src/atlas_video_gen.py:25-44, 80-86`
- Test: `tests/test_atlas_video_gen.py` (new)

- [ ] **Step 1: Write failing tests**

Create `tests/test_atlas_video_gen.py`:

```python
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_atlas_video_gen.py -v`
Expected: FAIL — `_is_motion_control` not defined or `KeyError: 'model_id_ref2v'`.

- [ ] **Step 3: Add `_is_motion_control` helper**

In `src/atlas_video_gen.py`, immediately after the existing `def _is_kling(...)` function (around line 86):

```python
def _is_motion_control(model_endpoint: str) -> bool:
    """Atlas Kling 2.6 Pro motion-control model — separate payload schema
    requiring both `image` (subject) and `video` (motion source)."""
    return "motion-control" in model_endpoint.lower()
```

- [ ] **Step 4: Propagate `endpoint_ref2v` into MODELS dict**

In `src/atlas_video_gen.py`, modify `_build_models_dict` (around lines 25-41) to add `model_id_ref2v`:

```python
def _build_models_dict() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for m in REGISTRY.values():
        if m.provider != "atlas":
            continue
        out[m.id] = {
            "name": m.name,
            "model_id": m.endpoint_t2v,
            "model_id_i2v": m.endpoint_i2v,
            "model_id_ref2v": m.endpoint_ref2v,
            "aspect_ratios": list(m.aspect_ratios),
            "qualities": list(m.qualities),
            "min_duration": min(m.allowed_durations) if m.allowed_durations else 4,
            "max_duration": max(m.allowed_durations) if m.allowed_durations else 15,
            "default_duration": m.default_duration,
            "cost_per_sec": m.cost_per_sec or {},
        }
    return out
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `python -m pytest tests/test_atlas_video_gen.py -v`
Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/atlas_video_gen.py tests/test_atlas_video_gen.py
git commit -m "[feat] atlas — _is_motion_control helper + ref2v endpoint propagation"
```

---

## Task 3: Atlas adapter — `submit_motion_control` function

**Files:**
- Modify: `src/atlas_video_gen.py` (add new function after `submit_with_refs`)
- Test: `tests/test_atlas_video_gen.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_atlas_video_gen.py`:

```python
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
```

If `pytest-httpx` is not installed, install it:
```bash
pip install pytest-httpx
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_atlas_video_gen.py::test_motion_control_payload_uses_image_video_orientation -v`
Expected: FAIL — `submit_motion_control` not defined.

- [ ] **Step 3: Add `submit_motion_control` to `src/atlas_video_gen.py`**

After the existing `submit_with_refs` function, add:

```python
async def submit_motion_control(
    api_key: str, model_id: str, prompt: str,
    subject_image_bytes: tuple[str, bytes],
    motion_video_bytes: tuple[str, bytes],
    character_orientation: str = "image",
    duration: int = 5,
    negative_prompt: str = "",
    keep_original_sound: bool = False,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Submit a Kling 2.6 Pro motion-control request.

    Schema is intentionally minimal — Atlas's motion-control endpoint
    rejects every Seedance/Kling-i2v key (ratio, resolution, image_url,
    generate_audio, seed). Only `image`, `video`, `character_orientation`,
    `prompt`, `duration`, and the two optional fields below are accepted.
    """
    info = get_model_info(model_id)
    endpoint = info["model_id"]
    if not _is_motion_control(endpoint):
        raise AtlasVideoGenError(
            f"{model_id} is not a motion-control model (endpoint={endpoint})"
        )
    if character_orientation not in ("image", "video"):
        raise AtlasVideoGenError(
            f"character_orientation must be 'image' or 'video', got {character_orientation!r}"
        )

    img_name, img_data = subject_image_bytes
    vid_name, vid_data = motion_video_bytes
    img_ext = "." + img_name.rsplit(".", 1)[-1] if "." in img_name else ".png"
    vid_ext = "." + vid_name.rsplit(".", 1)[-1] if "." in vid_name else ".mp4"

    payload: dict[str, Any] = {
        "model": endpoint,
        "image": _to_data_uri(img_data, img_ext),
        "video": _to_data_uri(vid_data, vid_ext),
        "character_orientation": character_orientation,
        "prompt": prompt,
        "duration": duration,
        "keep_original_sound": keep_original_sound,
    }
    if negative_prompt:
        payload["negative_prompt"] = negative_prompt
    return await _submit(api_key, info["name"], payload)
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python -m pytest tests/test_atlas_video_gen.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/atlas_video_gen.py tests/test_atlas_video_gen.py
git commit -m "[feat] atlas — submit_motion_control() for Kling 2.6 Pro motion transfer"
```

---

## Task 4: Atlas adapter — `submit_with_refs` motion-control dispatch

**Files:**
- Modify: `src/atlas_video_gen.py` (extend `submit_with_refs`)
- Test: `tests/test_atlas_video_gen.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_atlas_video_gen.py`:

```python
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_atlas_video_gen.py::test_submit_with_refs_dispatches_to_motion_control -v`
Expected: FAIL — current submit_with_refs would log "video reference ignored" and call the wrong endpoint.

- [ ] **Step 3: Modify `submit_with_refs` to dispatch motion-control first**

In `src/atlas_video_gen.py`, near the top of `submit_with_refs` (just after the `info = get_model_info(model_id)` line), add:

```python
    # Motion-control dispatch — separate payload schema, requires both inputs.
    endpoint_t2v = info["model_id"] or ""
    if _is_motion_control(endpoint_t2v):
        if not ref_image_bytes or not ref_video_bytes:
            raise AtlasVideoGenError(
                "motion control requires both an image (subject) and a video (motion source)"
            )
        return await submit_motion_control(
            api_key=api_key,
            model_id=model_id,
            prompt=prompt,
            subject_image_bytes=ref_image_bytes[0],
            motion_video_bytes=ref_video_bytes,
            character_orientation=_kwargs.get("character_orientation", "image"),
            duration=duration,
            negative_prompt=_kwargs.get("negative_prompt", ""),
            keep_original_sound=_kwargs.get("keep_original_sound", False),
        )
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python -m pytest tests/test_atlas_video_gen.py -v`
Expected: all PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/atlas_video_gen.py tests/test_atlas_video_gen.py
git commit -m "[feat] atlas — submit_with_refs dispatches motion-control models"
```

---

## Task 5: Atlas adapter — `submit_with_refs` ref2v branch (Omni Pro multi-image)

**Files:**
- Modify: `src/atlas_video_gen.py` (extend `submit_with_refs`)
- Test: `tests/test_atlas_video_gen.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_atlas_video_gen.py`:

```python
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
    # ref2v uses single-image keys NOT.
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_atlas_video_gen.py::test_omni_pro_uses_ref2v_endpoint_with_2plus_images -v`
Expected: FAIL — current submit_with_refs only uses i2v endpoint, ignores extra images.

- [ ] **Step 3: Insert ref2v branch into `submit_with_refs`**

In `src/atlas_video_gen.py`, inside `submit_with_refs`, locate the existing block:

```python
    name, data = ref_image_bytes[0]
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ".png"
    image_data_uri = _to_data_uri(data, ext)
    endpoint = info["model_id_i2v"]
```

Replace it with the ref2v branch + the existing single-image branch:

```python
    # Multi-ref dispatch — Omni Pro reference-to-video.
    endpoint_ref2v = info.get("model_id_ref2v")
    if len(ref_image_bytes) >= 2 and endpoint_ref2v:
        capped = ref_image_bytes[:4]
        images_uris: list[str] = []
        for name, data in capped:
            ext = "." + name.rsplit(".", 1)[-1] if "." in name else ".png"
            images_uris.append(_to_data_uri(data, ext))
        if ref_video_bytes:
            logger.warning(
                "Atlas %s reference-to-video does not accept video refs; ignored",
                info["name"],
            )
        if audio_url:
            logger.warning("Atlas %s does not support audio refs; ignored", info["name"])
        payload: dict[str, Any] = {
            "model": endpoint_ref2v,
            "prompt": prompt,
            "images": images_uris,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
        }
        if seed is not None and seed >= 0:
            payload["seed"] = seed
        return await _submit(api_key, info["name"], payload)

    # Single-image dispatch (existing kling-vs-seedance branching).
    if len(ref_image_bytes) > 1:
        logger.warning(
            "Atlas I2V uses only the first image as start keyframe; %d extra ignored",
            len(ref_image_bytes) - 1,
        )
    if ref_video_bytes:
        logger.warning("Atlas %s does not support video references; ignored", info["name"])
    if audio_url:
        logger.warning("Atlas %s does not support audio references; ignored", info["name"])

    name, data = ref_image_bytes[0]
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ".png"
    image_data_uri = _to_data_uri(data, ext)
    endpoint = info["model_id_i2v"]
```

(The Kling-vs-Seedance payload construction below stays unchanged.)

- [ ] **Step 4: Run tests, verify they pass**

Run: `python -m pytest tests/test_atlas_video_gen.py -v`
Expected: all PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/atlas_video_gen.py tests/test_atlas_video_gen.py
git commit -m "[feat] atlas — ref2v branch for Omni Pro multi-image (>=2 refs)"
```

---

## Task 6: Router — `character_orientation` and `negative_prompt` form fields

**Files:**
- Modify: `src/routers/generate.py`

- [ ] **Step 1: Read the current `/api/generate/video` signature**

Open `src/routers/generate.py` and locate the `generate_video` endpoint (around line 92).

- [ ] **Step 2: Add the two new form fields and thread to `_generate_video_atlas`**

Modify `generate_video` (around line 93) to accept the new fields:

```python
@router.post("/video")
async def generate_video(
    prompt: str = Form(...),
    model: str = Form("kling-3.0-omni"),
    aspect_ratio: str = Form("16:9"),
    duration: int = Form(5),
    quality: str = Form("720p"),
    api_key: str = Form(""),
    audio_url: str = Form(""),
    seed: int = Form(-1),
    character_orientation: str = Form("image"),
    negative_prompt: str = Form(""),
    ref_images: list[UploadFile] | None = File(default=None),
    ref_video: UploadFile | None = File(default=None),
):
    """Submit a video generation request via PiAPI, fal.ai, Atlas Cloud, or Vertex AI."""
    if model.startswith("vertex-"):
        return await _generate_video_vertex(
            prompt, model, api_key, aspect_ratio, duration, quality, ref_images, seed,
        )
    if model.startswith("fal-"):
        return await _generate_video_fal(prompt, model, api_key, aspect_ratio, duration, ref_images, seed)
    if model.startswith("atlas-"):
        return await _generate_video_atlas(
            prompt, model, api_key, aspect_ratio, duration, audio_url,
            ref_images, ref_video, seed,
            character_orientation=character_orientation,
            negative_prompt=negative_prompt,
        )
    return await _generate_video_piapi(
        prompt, model, api_key, aspect_ratio, duration, quality, audio_url, ref_images, ref_video, seed,
    )
```

- [ ] **Step 3: Modify `_generate_video_atlas` signature to accept the kwargs**

Replace the function signature and the `atlas_refs(...)` call:

```python
async def _generate_video_atlas(
    prompt: str, model: str, api_key: str, aspect_ratio: str,
    duration: int, audio_url: str,
    ref_images: list[UploadFile] | None, ref_video: UploadFile | None,
    seed: int = -1,
    *,
    character_orientation: str = "image",
    negative_prompt: str = "",
):
    from src.atlas_video_gen import AtlasVideoGenError, submit_text_to_video as atlas_t2v, submit_with_refs as atlas_refs

    key = api_key or os.environ.get("AYCB_ATLAS_KEY", "")
    if not key:
        raise HTTPException(400, "Atlas Cloud key required. Set AYCB_ATLAS_KEY or pass api_key.")
    try:
        has_refs = (ref_images and len(ref_images) > 0) or ref_video or audio_url
        if has_refs:
            image_bytes: list[tuple[str, bytes]] = []
            if ref_images:
                for i, f in enumerate(ref_images[:9]):
                    data = await f.read()
                    ext = Path(f.filename or "ref.png").suffix or ".png"
                    image_bytes.append((f"ref_{i}{ext}", data))
            video_bytes: tuple[str, bytes] | None = None
            if ref_video:
                data = await ref_video.read()
                ext = Path(ref_video.filename or "ref.mp4").suffix or ".mp4"
                video_bytes = (f"ref_video{ext}", data)
            result = await atlas_refs(
                api_key=key, model_id=model, prompt=prompt,
                ref_image_bytes=image_bytes or None, ref_video_bytes=video_bytes,
                audio_url=audio_url, aspect_ratio=aspect_ratio, duration=duration,
                seed=seed,
                character_orientation=character_orientation,
                negative_prompt=negative_prompt,
            )
        else:
            result = await atlas_t2v(
                api_key=key, model_id=model, prompt=prompt,
                aspect_ratio=aspect_ratio, duration=duration,
                seed=seed,
            )
        _log(f"Video submitted (Atlas) — model={model}, request_id={result.get('request_id')}")
        return result
    except AtlasVideoGenError as e:
        raise HTTPException(422, str(e))
```

- [ ] **Step 4: Smoke-test the router**

Run: `python -m pytest tests/test_atlas_video_gen.py tests/test_registry.py -v`
Expected: all PASS — no router-specific test broken.

If a `tests/test_video_gen.py` or `tests/test_atlas_router.py` exists that exercises this endpoint, run that too:

Run: `python -m pytest tests/ -k "atlas or video" -v`
Expected: all PASS or at most pre-existing failures unrelated to this change.

- [ ] **Step 5: Commit**

```bash
git add src/routers/generate.py
git commit -m "[feat] router — accept character_orientation + negative_prompt for Atlas"
```

---

## Task 7: Frontend `api.ts` — extend `generateVideo` signature

**Files:**
- Modify: `frontend/src/api.ts:299-320`

- [ ] **Step 1: Open `frontend/src/api.ts` and locate `generateVideo`**

The current method is around lines 299-320.

- [ ] **Step 2: Extend the options type and append form fields**

Replace the `generateVideo` method with:

```typescript
  /** Submit a video generation request via PiAPI / fal.ai / Atlas / Veo. Returns {request_id}. */
  generateVideo(
    prompt: string,
    apiKey: string,
    options: {
      model?: string
      aspectRatio?: string
      duration?: number
      quality?: string
      audioUrl?: string
      seed?: number
      characterOrientation?: 'image' | 'video'
      negativePrompt?: string
    },
    refImages?: File[],
    refVideo?: File,
  ): Promise<import('./types').GenerateVideoResult> {
    if (!isBackendAvailable()) throw new Error('Video generation requires the local backend.')
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('api_key', apiKey)
    fd.append('model', options.model ?? 'kling-3.0-omni')
    fd.append('aspect_ratio', options.aspectRatio ?? '16:9')
    fd.append('duration', String(options.duration ?? 5))
    fd.append('quality', options.quality ?? '720p')
    if (options.audioUrl) fd.append('audio_url', options.audioUrl)
    fd.append('seed', String(options.seed ?? -1))
    if (options.characterOrientation) fd.append('character_orientation', options.characterOrientation)
    if (options.negativePrompt) fd.append('negative_prompt', options.negativePrompt)
    refImages?.forEach(f => fd.append('ref_images', f))
    if (refVideo) fd.append('ref_video', refVideo)
    return post('/generate/video', fd)
  },
```

- [ ] **Step 3: Run tsc to verify the type extension is sound**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "[feat] api — extend generateVideo with characterOrientation + negativePrompt"
```

---

## Task 8: Frontend `useGenerateVideo` — state, mode, validation, fallback

**Files:**
- Modify: `frontend/src/nodes/generate-video/useGenerateVideo.ts`

- [ ] **Step 1: Add `characterOrientation` state and ref**

Find the state block around lines 162-174 in `useGenerateVideo.ts` (after the existing `seed` state). Add directly after the `modeOverride` state:

```typescript
  const [characterOrientation, setCharacterOrientation] = useState<'image' | 'video'>(() => {
    const v = (data as Record<string, unknown>).characterOrientation
    return v === 'video' ? 'video' : 'image'
  })
```

In the refs block (around lines 198-201, after `localPromptRef`), add:

```typescript
  const characterOrientationRef = useRef(characterOrientation)
  useEffect(() => { characterOrientationRef.current = characterOrientation }, [characterOrientation])
```

- [ ] **Step 2: Add `isMotionControl` derived value and extend `autoMode`**

Find the existing `isFal` / `isAtlas` block around lines 205-209. Add:

```typescript
  const isMotionControl = selectedModel === 'atlas-kling-motion-control'
```

Find the existing `autoMode` declaration around lines 252-257 and replace with:

```typescript
  const hasRefs = connectedImageCount > 0 || hasVideoRef || hasAudioRef
  const autoMode: 't2v' | 'i2v' | 'multi-ref' | 'motion-control' =
    isMotionControl ? 'motion-control'
    : !hasRefs ? 't2v'
    : (connectedImageCount <= 2 && !hasVideoRef && !hasAudioRef) ? 'i2v'
    : 'multi-ref'
  const mode = isMotionControl ? 'motion-control' : (modeOverride ?? autoMode)
```

Update the `setMode` callback at the end of the hook (around lines 462-465) to keep its existing 3-value type:

```typescript
  const setMode = useCallback((m: 't2v' | 'i2v' | 'multi-ref') => {
    if (isMotionControl) return
    setModeOverride(m)
    updateNodeData(id, { modeOverride: m })
  }, [id, isMotionControl, updateNodeData])
```

- [ ] **Step 3: Add motion-control validation in `run()`**

Find the existing `if (!activeApiKey)` block around lines 401-407 in `run()`. Right before it, add:

```typescript
    if (isMotionControl) {
      if (connectedImageCount === 0) {
        setError('Motion control requires a connected image (subject)')
        return
      }
      if (!hasVideoRef) {
        setError('Motion control requires a connected video reference (motion source)')
        return
      }
    }
```

- [ ] **Step 4: Pull video for motion-control mode and pass `characterOrientation` to API**

Find the references block around lines 415-432 in `run()`:

```typescript
      const curMode = modeRef.current
      let refImages: File[] = []
      if (curMode === 'i2v') {
        refImages = (await pullAllMedia(id, 'image-', getNodes, getEdges)).slice(0, 2)
      } else if (curMode === 'multi-ref') {
        refImages = await pullAllMedia(id, 'image-', getNodes, getEdges)
      }

      let refVideo: File | undefined
      if (hasVideoRef && curMode === 'multi-ref') {
        const { file } = await pullMedia(id, 'video-ref', getNodes, getEdges)
        if (file) refVideo = file
      }
```

Replace with:

```typescript
      const curMode = modeRef.current
      let refImages: File[] = []
      if (curMode === 'i2v') {
        refImages = (await pullAllMedia(id, 'image-', getNodes, getEdges)).slice(0, 2)
      } else if (curMode === 'multi-ref') {
        refImages = await pullAllMedia(id, 'image-', getNodes, getEdges)
      } else if (curMode === 'motion-control') {
        refImages = (await pullAllMedia(id, 'image-', getNodes, getEdges)).slice(0, 1)
      }

      let refVideo: File | undefined
      if (hasVideoRef && (curMode === 'multi-ref' || curMode === 'motion-control')) {
        const { file } = await pullMedia(id, 'video-ref', getNodes, getEdges)
        if (file) refVideo = file
      }
```

Find the `api.generateVideo(...)` call around lines 435-440 and replace the options object:

```typescript
      const result = await api.generateVideo(
        prompt, activeApiKey,
        {
          model: selectedModel,
          aspectRatio,
          duration,
          quality,
          audioUrl,
          seed,
          characterOrientation: isMotionControl ? characterOrientationRef.current : undefined,
        },
        refImages.length > 0 ? refImages : undefined,
        refVideo,
      )
```

Add `isMotionControl` to the `run` callback's dependency array (last line of the `run` useCallback, around line 459-460):

```typescript
  }, [id, activePrompt, activeApiKey, isFal, isAtlas, isVertex, isMotionControl, activeProvider,
      selectedModel, aspectRatio, duration, quality, seed,
      hasVideoRef, hasAudioRef, getNodes, getEdges, updateNodeData, startPolling, connectedImageCount])
```

- [ ] **Step 5: Update fallback array `VIDEO_MODELS_FALLBACK`**

In the same file, near the top (around lines 33-112), modify the existing `atlas-kling-v3-pro` entry's `name` and `tooltip`:

```typescript
  {
    id: 'atlas-kling-v3-pro', name: 'Kling 3.0 Omni Pro', provider: 'atlas',
    tooltip: 'Atlas Cloud — Kling 3.0 Omni Pro (O3), 3-15s, multi-ref + lip-sync', price: '$0.095/s',
    cost: 0.095, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['720p'], minDuration: 3, maxDuration: 15,
  },
```

Insert two new entries right after `atlas-kling-v3-pro`:

```typescript
  // Atlas Cloud — Kling 3.0 Omni Std (O3 Std)
  {
    id: 'atlas-kling-omni-std', name: 'Kling 3.0 Omni Std', provider: 'atlas',
    tooltip: 'Atlas Cloud — Kling 3.0 Omni Std (O3), 3-15s', price: '$0.071/s',
    cost: 0.071, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['720p'], minDuration: 3, maxDuration: 15,
  },
  // Atlas Cloud — Kling 2.6 Pro Motion Control (image + ref video)
  {
    id: 'atlas-kling-motion-control', name: 'Kling Motion Control', provider: 'atlas',
    tooltip: 'Atlas Cloud — Kling 2.6 Pro motion transfer (image + ref video)', price: '$0.112/s',
    cost: 0.112, ratios: ['9:16', '16:9', '1:1'],
    qualities: ['720p'], minDuration: 5, maxDuration: 30,
  },
```

- [ ] **Step 6: Return new values from the hook**

Find the `return { ... }` at the end of `useGenerateVideo` (around lines 473-492) and add:

```typescript
    characterOrientation, setCharacterOrientation,
    isMotionControl,
```

(insert these between `seed, setSeed,` and `loading, error, status, ...`).

- [ ] **Step 7: Run tsc + existing vitest to confirm nothing else breaks**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

Run: `cd frontend && npx vitest run --reporter=basic`
Expected: existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/nodes/generate-video/useGenerateVideo.ts
git commit -m "[feat] generate-video hook — motion control mode + character_orientation"
```

---

## Task 9: Frontend `GenerateVideoNode` UI — conditional motion-control elements

**Files:**
- Modify: `frontend/src/nodes/generate-video/GenerateVideoNode.tsx`

- [ ] **Step 1: Pull new values from the hook**

In `GenerateVideoNode.tsx`, find the destructured `vid` block (around lines 33-51) and add `characterOrientation`, `setCharacterOrientation`, `isMotionControl`:

```typescript
  const {
    localPrompt, setLocalPrompt,
    selectedModel, setSelectedModel,
    aspectRatio, setAspectRatio,
    duration, setDuration,
    quality, setQuality,
    seed, setSeed,
    characterOrientation, setCharacterOrientation,
    isMotionControl,
    loading, error, status, videoUrl, requestId,
    pollElapsed,
    modelInfo,
    imageSlots,
    hasPromptEdge,
    activePrompt, mode, setMode,
    run,
    activeApiKey,
    lastCost,
    estimatedCost,
    historyIds, historyIndex, navigateHistory,
  } = vid
```

- [ ] **Step 2: Hide extra image slots when motion-control selected**

Find the `inputSlots` prop on `<NodeShell>` (around lines 64-69) and replace with:

```tsx
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        ...(isMotionControl
          ? [{ id: 'image-0', label: 'Subject', type: 'image' as const }]
          : imageSlots),
        { id: 'video-ref', label: isMotionControl ? 'Motion (required)' : 'Video Ref', type: 'video' as const },
        { id: 'audio-ref', label: 'Audio URL', type: 'text' as const },
      ]}
```

- [ ] **Step 3: Render the character_orientation select when motion-control**

Find the existing model `<select>` block (around lines 99-112). Right after its closing `</select>`, add the conditional:

```tsx
        {isMotionControl && (
          <div className={nodeStyles.controlsRow}>
            <div className={nodeStyles.controlGroup}>
              <span className={nodeStyles.controlLabel}>Frame</span>
              <select
                className={nodeStyles.selectSmall}
                value={characterOrientation}
                onChange={e => {
                  const v = e.target.value as 'image' | 'video'
                  setCharacterOrientation(v)
                  updateNodeData(id, { characterOrientation: v })
                }}
              >
                <option value="image">Subject</option>
                <option value="video">Motion video</option>
              </select>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Hide the T2V/I2V/Multi-Ref mode toggle when motion-control**

Find the existing mode toggle block (around lines 136-151). Wrap it:

```tsx
        {!isMotionControl && (
          <div className={nodeStyles.controlsRow}>
            <div className={nodeStyles.modeToggle}>
              <button className={`${nodeStyles.modeBtn} ${mode === 't2v' ? nodeStyles.modeBtnActive : ''}`}
                onClick={() => setMode('t2v')}>T2V</button>
              <button className={`${nodeStyles.modeBtn} ${mode === 'i2v' ? nodeStyles.modeBtnActive : ''}`}
                onClick={() => setMode('i2v')}>I2V</button>
              <button className={`${nodeStyles.modeBtn} ${mode === 'multi-ref' ? nodeStyles.modeBtnActive : ''}`}
                onClick={() => setMode('multi-ref')}>Multi-Ref</button>
            </div>
          </div>
        )}
```

- [ ] **Step 5: Run tsc**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Smoke-test in the browser**

Manual check:
1. Start backend + frontend.
2. Drop a Generate Video node, switch provider to Atlas.
3. Select "Kling Motion Control" — verify "Frame" select appears, mode toggle disappears, slot labels change to "Subject" and "Motion (required)".
4. Switch to any other Atlas model — verify the orientation select disappears and labels revert.

If visual checks fail, fix and recommit.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/nodes/generate-video/GenerateVideoNode.tsx
git commit -m "[feat] generate-video UI — motion control conditional elements"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `python -m pytest`
Expected: all PASS (existing 98 + ~8 new = ~106).

- [ ] **Step 2: Run all frontend type checks + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: clean tsc, all vitest tests pass.

- [ ] **Step 3: Smoke a real generation**

Manual checks (require live Atlas key):

1. **Motion control** — connect an Image Upload node (subject) and a Video Upload node to a Generate Video node, select `Kling Motion Control`, choose `Frame: Subject`, set duration 5s, run. Confirm a generated video lands in Review Hub with bridged metadata.
2. **Omni Std** — switch to `Kling 3.0 Omni Std`, run a T2V from prompt only.
3. **Omni Pro multi-ref** — connect 3 image inputs to Generate Video on `Kling 3.0 Omni Pro`, run. Check backend logs (`shared/data/browser-perf.jsonl` is unrelated; check the AYCB Backend CMD window) for `Video submitted (Atlas) — model=atlas-kling-v3-pro` and confirm the request_id resolves to a multi-ref generation.

- [ ] **Step 4: Final commit (if any small fixes from smoke tests)**

If smoke tests revealed issues, fix and commit with `[fix]` prefix.

If everything works, no commit needed — the prior commits already cover the feature.

---

## Self-review notes

- **Spec coverage:** Tasks 1-9 implement every section of the spec (registry, adapter, router, api.ts, hook, UI, tests). Task 10 verifies. Everything maps.
- **Type consistency:** `endpoint_ref2v` is the field name in the dataclass; `model_id_ref2v` is its key in the adapter MODELS dict (mirrors existing `endpoint_t2v` → `model_id` rename precedent). `characterOrientation` is the camelCase TS form, `character_orientation` is the snake_case API form — consistent throughout.
- **No placeholders:** Every step shows the literal code or shell command. No "implement appropriately" / "handle errors" / "TBD".
- **TDD:** Tasks 1-5 follow strict test-first. Tasks 6-9 (router, frontend hook, UI) are integration glue and rely on the existing tests + tsc + manual smoke for verification — writing meaningful unit tests for the React UI changes would require setting up RTL, which is out of scope and not the existing pattern.
- **Frequent commits:** 9 separate commits across the 10 tasks, each isolating one logical change.
