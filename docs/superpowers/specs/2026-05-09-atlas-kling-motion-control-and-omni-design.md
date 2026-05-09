# Atlas Kling — Motion Control + Omni cleanup

Date: 2026-05-09
Status: Approved (sections 1-4)
Scope: Add Kling 2.6 Pro motion-control model + Kling 3.0 Omni Std model
       on Atlas Cloud, expose multi-ref `reference-to-video` for the
       existing Omni Pro entry, fix labels.

## Context

Atlas Cloud already exposes Kling 3.0 endpoints we partially use:

| Atlas endpoint                              | Currently registered as            |
|---------------------------------------------|------------------------------------|
| `kwaivgi/kling-v3.0-std/{t2v,i2v}`          | `atlas-kling-v3-std`               |
| `kwaivgi/kling-v3.0-pro/{t2v,i2v}`          | not registered                     |
| `kwaivgi/kling-video-o3-std/{t2v,i2v}`      | not registered                     |
| `kwaivgi/kling-video-o3-pro/{t2v,i2v}`      | `atlas-kling-v3-pro` (label wrong) |
| `kwaivgi/kling-video-o3-pro/reference-to-video` | not used                       |
| `kwaivgi/kling-v2.6-pro/motion-control`     | not registered                     |

`atlas-kling-v3-pro` actually points to the O3 (Omni) Pro endpoint —
the label says "Kling 3.0 Pro" which obscures that fact. The plain
`kling-v3.0-pro` endpoint stays unregistered (Omni is strictly better).

Motion control on Atlas only exists as a separate v2.6 Pro model.
There is no v3.0 motion-control endpoint. The user's request to add
"Kling 3.0 Omni motion control" is not literally satisfiable; we add
the v2.6 Pro motion-control model instead.

## Goal

1. Register `atlas-kling-motion-control` and route generation
   requests through the dedicated motion-control payload schema
   (subject image + reference video + character_orientation).
2. Register `atlas-kling-omni-std`, the cheaper Omni tier.
3. Use `kwaivgi/kling-video-o3-pro/reference-to-video` for multi-ref
   (>= 2 images) requests on the existing `atlas-kling-v3-pro` model.
4. Rename `atlas-kling-v3-pro` display label to "Kling 3.0 Omni Pro
   (Atlas)" so users can tell it apart from plain v3.0.
5. UI: surface a `character_orientation` selector when the
   motion-control model is selected; otherwise hidden.

Non-goals: separate "motion control" node, registering plain v3.0 Pro,
generic motion-ref slot on every video provider.

## Architecture decisions

### A. Motion control as another model, not another node
Reuses the existing Generate Video node, the connected `image-0`
slot becomes the subject, the existing `video-ref` slot becomes the
motion source. No new node files, no duplicated polling/bridge/history
machinery. Motion-control mode is derived from the selected model id
(not a user toggle), so it cannot be set independently of model.

### B. Reference-to-video is auto-selected by image count
For `atlas-kling-v3-pro` (Omni Pro), the adapter inspects the number
of attached images at submit time:
- 0 images → `endpoint_t2v` (text-to-video)
- 1 image → `endpoint_i2v` (image-to-video, single keyframe)
- 2+ images → `endpoint_ref2v` (reference-to-video, multi-ref array)

Capped at 4 images for ref2v (Atlas allows 4 with video, 7 without;
we standardise on 4 — pessimistic but always valid).

### C. Image/video transport: data URIs (existing convention)
Atlas docs hint `/api/v1/model/uploadMedia` may be the canonical path
for ref2v multi-image, but the existing adapter uses base64 data URIs
in the `image` field for kling i2v and they are accepted. We try data
URIs first for ref2v as well; if Atlas rejects, follow-up adds an
upload step (out of scope for this spec).

### D. character_orientation surfaced only for motion-control
Two-value select ("image" | "video") rendered conditionally next to
the model dropdown. Persisted in node `data.characterOrientation`,
default `"image"`. Hidden for every other model.

## Data layer — `src/registry.py`

Add field to `Model` dataclass:
```python
endpoint_ref2v: str | None = None  # Multi-ref endpoint (Omni Pro)
```

New video entries:
```python
Model(
    id="atlas-kling-motion-control",
    name="Kling Motion Control (Atlas)",
    provider="atlas", capability="video",
    cost_per_sec={"720p": 0.112},
    aspect_ratios=("9:16", "16:9", "1:1"),
    qualities=("720p",),
    allowed_durations=(5, 10, 15, 30),
    tooltip="Atlas — Kling 2.6 Pro motion transfer (image + ref video)",
    endpoint_t2v="kwaivgi/kling-v2.6-pro/motion-control",
),
Model(
    id="atlas-kling-omni-std",
    name="Kling 3.0 Omni Std (Atlas)",
    provider="atlas", capability="video",
    cost_per_sec={"720p": 0.071},
    aspect_ratios=("16:9", "9:16", "1:1"),
    qualities=("720p",),
    allowed_durations=tuple(range(3, 16)),
    tooltip="Atlas — Kling 3.0 Omni Std (O3), 3-15s",
    endpoint_t2v="kwaivgi/kling-video-o3-std/text-to-video",
    endpoint_i2v="kwaivgi/kling-video-o3-std/image-to-video",
),
```

Modified existing:
- `atlas-kling-v3-pro`:
  - `name` → `"Kling 3.0 Omni Pro (Atlas)"`
  - `tooltip` → `"Atlas — Kling 3.0 Omni Pro (O3), 3-15s, multi-ref + lip-sync"`
  - `allowed_durations` → `tuple(range(3, 16))`
  - add `endpoint_ref2v="kwaivgi/kling-video-o3-pro/reference-to-video"`
  - id stays `atlas-kling-v3-pro` (preserves saved canvases)

## Backend adapter — `src/atlas_video_gen.py`

`_build_models_dict` propagates `endpoint_ref2v` into the dict as
`model_id_ref2v`.

New helper:
```python
def _is_motion_control(endpoint: str) -> bool:
    return "motion-control" in endpoint.lower()
```

New function `submit_motion_control(api_key, model_id, prompt,
subject_image_bytes, motion_video_bytes, character_orientation,
duration, negative_prompt, keep_original_sound)`:
- Validates `character_orientation in ("image", "video")` →
  `AtlasVideoGenError` if not.
- Builds payload `{model, image, video, character_orientation,
  prompt, duration, keep_original_sound, [negative_prompt]}`.
- No `seed`, `aspect_ratio`, `resolution`, `ratio`, or
  `generate_audio` (rejected by motion-control endpoint).

Extend `submit_with_refs`:
- Front of function: if model endpoint is motion-control, require
  both `ref_image_bytes` and `ref_video_bytes`, then dispatch to
  `submit_motion_control`.
- After: if `ref_image_bytes` has 2+ entries AND
  `info["model_id_ref2v"]` is set, build ref2v payload using field
  name `images` (array of data URIs, max 4) and POST to ref2v
  endpoint. Skip the seedance/kling i2v branch entirely.
- Existing 1-image i2v branch unchanged.

Existing `submit_text_to_video` unchanged. Existing `_to_data_uri`,
`_submit`, `get_result`, `wait_for_completion` unchanged.

## Router — `src/routers/generate.py`

`/api/generate/video` adds two form fields:
```python
character_orientation: str = Form("image"),
negative_prompt: str = Form(""),
```

`_generate_video_atlas` accepts the two new params and threads them
into `atlas_refs` via keyword args (the adapter ignores them for non-
motion-control models — they go through `**kwargs`).

## Frontend

### `frontend/src/api.ts`
`generateVideo` extends its options object with optional
`characterOrientation?: 'image' | 'video'` and `negativePrompt?:
string`. Both, when present, get appended to FormData with
snake_case keys.

### `frontend/src/nodes/generate-video/useGenerateVideo.ts`
- New state: `characterOrientation` (`'image' | 'video'`, default
  `'image'`).
- New derived: `isMotionControl = selectedModel ===
  'atlas-kling-motion-control'`.
- `autoMode` extended:
  ```ts
  const autoMode = isMotionControl ? 'motion-control'
    : !hasRefs ? 't2v'
    : (connectedImageCount <= 2 && !hasVideoRef && !hasAudioRef) ? 'i2v'
    : 'multi-ref'
  ```
  Type union `mode` becomes `'t2v' | 'i2v' | 'multi-ref' |
  'motion-control'`. `setMode` does NOT accept `'motion-control'`
  (it is model-derived, not user-overrideable).
- `run()` validation: when `isMotionControl`, refuse to submit if
  `connectedImageCount === 0` or `!hasVideoRef`.
- `run()` references: pull video for `'multi-ref' | 'motion-control'`.
  Pull only first image for `'motion-control'`.
- API call: pass `characterOrientation` only when motion-control.
- Fallback array `VIDEO_MODELS_FALLBACK`: add the two new entries,
  rename existing pro label to "Kling 3.0 Omni Pro".

### `frontend/src/nodes/generate-video/GenerateVideoNode.tsx`
- When `isMotionControl`:
  - Render small select "Frame: Image / Video" → maps to
    `character_orientation`.
  - Image slot label "Subject", video-ref label "Motion (required)".
  - Hide additional image slots beyond `image-0`.
  - Disable Run button until both slots are connected.

### Node manifest
No change to `node.manifest.ts`. Slots `image-0` and `video-ref`
already exist; behavior is conditional on selected model only.

## Tests

### `tests/test_atlas_video_gen.py` (new file)
- `test_motion_control_payload_uses_image_video_orientation` — POST
  body contains exactly `{model, image, video, character_orientation,
  prompt, duration, keep_original_sound, [negative_prompt]}`.
- `test_motion_control_requires_both_image_and_video` — missing
  either raises `AtlasVideoGenError` before any HTTP call.
- `test_motion_control_rejects_invalid_orientation` — value other
  than `"image"`/`"video"` raises.
- `test_omni_pro_uses_ref2v_endpoint_with_2plus_images` — 3 images
  on `atlas-kling-v3-pro` → POST hits ref2v endpoint, body has
  `images: [...]` array.
- `test_omni_pro_uses_i2v_endpoint_with_1_image` — single image →
  i2v endpoint, body has `image: <uri>` (singular).
- `test_omni_std_t2v_uses_kling_payload` — Omni Std T2V uses
  Kling-style payload (no Seedance keys).

### `tests/test_registry.py` (extend)
- Assert `atlas-kling-motion-control` registered with right
  endpoint, cost.
- Assert `atlas-kling-omni-std` registered with right endpoints.
- Assert `atlas-kling-v3-pro.endpoint_ref2v` is set.
- Assert renamed `atlas-kling-v3-pro.name` is "Kling 3.0 Omni Pro
  (Atlas)".

### Frontend test extension
`frontend/src/nodes/generate-video/generate-video.test.ts` adds:
- character_orientation select hidden for non-motion-control models.
- character_orientation select visible for motion-control model.
- Run blocked when motion-control selected without both inputs.

All tests use `httpx_mock` (backend) or jsdom mocks (frontend). No
real Atlas calls.

## Risks / open items

- **Data URI vs uploadMedia for ref2v**: design uses data URIs.
  If Atlas rejects, follow-up spec adds upload step. Detection: a
  400 from the ref2v endpoint with payload size in error message.
- **Duration enum vs slider**: motion-control accepts only
  5/10/15/30s, but the node duration input is a clamp-only number.
  Pre-existing UX limitation — not fixed here. User typing 7s for
  motion-control will get a 422 from the API.
- **Pricing accuracy**: Omni Std individual-page wording suggests
  "$0.071 per generation" (flat). We encode as `cost_per_sec=0.071`.
  If flat-fee, our cost estimate is off by `duration` factor; verify
  with a real generation.

## Files touched

| File                                                              | Change |
|-------------------------------------------------------------------|--------|
| `src/registry.py`                                                 | new field, 2 new entries, edit 1 |
| `src/atlas_video_gen.py`                                          | new helper, new fn, extend submit_with_refs |
| `src/routers/generate.py`                                         | 2 new Form fields, thread into atlas adapter |
| `frontend/src/api.ts`                                             | extend generateVideo options |
| `frontend/src/nodes/generate-video/useGenerateVideo.ts`           | new state, mode extension, validation, fallback array |
| `frontend/src/nodes/generate-video/GenerateVideoNode.tsx`         | conditional UI for motion-control |
| `tests/test_atlas_video_gen.py`                                   | new |
| `tests/test_registry.py`                                          | extend |
| `frontend/src/nodes/generate-video/generate-video.test.ts`        | extend |
