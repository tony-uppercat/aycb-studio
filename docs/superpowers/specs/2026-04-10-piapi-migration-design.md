# PiAPI.ai Migration — Design Spec

**Date:** 2026-04-10
**Goal:** Replace MuAPI video generation backend with PiAPI.ai. Add Kling 3.0 Omni, Seedance 2.0 (with omni_reference multi-ref), Seedance 2.0 Fast. Rename muApiKey → piApiKey.

---

## Context

The Generate Video node currently uses MuAPI (`api.muapi.ai`) for Seedance 2.0 and Kling 3.0 Std/Pro. PiAPI.ai offers the same models with a unified task-based API, better documentation, and more model versions. This migration replaces the backend API client and adds Seedance 2.0 omni_reference mode for multi-reference (images + video + audio).

Advanced features (negative_prompt, cfg_scale, camera_control) are deferred to ~2026-04-17.

---

## Models

| Display Name | PiAPI `model` | PiAPI `task_type` | Qualities | Aspect Ratios | Duration | Price/sec |
|---|---|---|---|---|---|---|
| Kling 3.0 Omni | `kling` | `omni_video_generation` | 720p, 1080p | 16:9, 9:16, 1:1 | 3-15s | $0.10 (720p), $0.15 (1080p) |
| Seedance 2.0 | `seedance` | `seedance-2` | standard | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 4-15s | $0.15 |
| Seedance 2.0 Fast | `seedance` | `seedance-2-fast` | standard | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 4-15s | $0.10 |

### Kling 3.0 Omni Notes
- `version`: `"3.0"`
- `resolution`: `"720p"` or `"1080p"` (mapped from quality dropdown)
- `enable_audio`: `false` (deferred to advanced features)
- T2V: just prompt. I2V: `images: [url]` in input

### Seedance 2.0 Notes
- Prompt max 4000 chars
- `aspect_ratio` supports `"auto"` — we won't expose it (user picks explicitly)
- **Three modes** (auto-detected from connected inputs):
  - `text_to_video` — no refs connected, pure T2V
  - `first_last_frames` — 1-2 image refs, used as start/end frame (aspect_ratio auto-detected from image)
  - `omni_reference` — multiple refs (images + video + audio), up to 12 combined. Prompt uses `@image1`, `@image2`, `@video1`, `@audio1` to reference inputs.

---

## Multi-Reference Architecture

### Input Slots (Generate Video node)

Same dynamic slot pattern as Generate Image node (`useGenerateImage.ts:64-73`):

| Slot | Type | Behavior |
|---|---|---|
| `prompt-in` | prompt | Text prompt (always visible) |
| `image-0` ... `image-N` | image | Dynamic: starts with 1, grows on connect, max 12. Label: "Ref 1", "Ref 2", ... |
| `video-ref` | video | Single video reference (always visible) |
| `audio-ref` | text | Audio URL via text node (always visible). No audio node exists yet. |

### Mode Auto-Detection

```
if no refs connected        → text_to_video
if only images (1-2)        → first_last_frames (Seedance) / images (Kling)
if images (3+) or video/audio → omni_reference (Seedance only)
if Kling + images            → images array (any count)
```

### File Upload for References

Local images/videos need public URLs for PiAPI. Use PiAPI's ephemeral file upload:

```
POST https://upload.theapi.app/api/ephemeral_resource
x-api-key: <same piapi key>
Content-Type: application/json

{
  "file_name": "ref_0.png",
  "file_data": "<base64>"
}

→ { "code": 200, "data": { "url": "https://..." } }
```

- Supports: jpg, jpeg, png, webp, mp4, wav, mp3
- Max 10MB per file
- URLs expire after 24h (fine for generation)

### Backend Flow for References

```
Frontend → POST /api/generate/video (multipart: prompt + image files + video file)
Backend:
  1. For each image/video file:
     a. Read bytes → base64
     b. POST to upload.theapi.app → get URL
  2. Build PiAPI task payload with URLs
  3. POST to api.piapi.ai/api/v1/task
  4. Return task_id
```

---

## API Contract

### Authentication
- Header: `x-api-key: <piapi_key>`
- Settings key: `piApiKey` (renamed from `muApiKey`)
- Backend env: `AYCB_PIAPI_KEY` (renamed from `AYCB_MUAPI_KEY`)

### Submit Task
```
POST https://api.piapi.ai/api/v1/task
Content-Type: application/json
x-api-key: <key>

# Kling 3.0 Omni T2V
{
  "model": "kling",
  "task_type": "omni_video_generation",
  "input": {
    "prompt": "...",
    "version": "3.0",
    "resolution": "720p",
    "duration": 5,
    "aspect_ratio": "16:9",
    "enable_audio": false
  }
}

# Kling 3.0 Omni with image refs
{
  "model": "kling",
  "task_type": "omni_video_generation",
  "input": {
    "prompt": "...",
    "version": "3.0",
    "resolution": "720p",
    "duration": 5,
    "aspect_ratio": "16:9",
    "enable_audio": false,
    "images": ["https://uploaded-url-1", "https://uploaded-url-2"]
  }
}

# Seedance 2.0 T2V (no refs)
{
  "model": "seedance",
  "task_type": "seedance-2",
  "input": {
    "prompt": "...",
    "mode": "text_to_video",
    "duration": 5,
    "aspect_ratio": "16:9"
  }
}

# Seedance 2.0 omni_reference (multi-ref)
{
  "model": "seedance",
  "task_type": "seedance-2",
  "input": {
    "prompt": "A person in @image1 style walks through @image2 scene with @video1 motion",
    "mode": "omni_reference",
    "duration": 5,
    "aspect_ratio": "16:9",
    "image_urls": ["https://ref1.png", "https://ref2.png"],
    "video_urls": ["https://ref-video.mp4"],
    "audio_urls": ["https://ref-audio.mp3"]
  }
}

# Seedance 2.0 first_last_frames (1-2 images as start/end frame)
{
  "model": "seedance",
  "task_type": "seedance-2",
  "input": {
    "prompt": "...",
    "mode": "first_last_frames",
    "duration": 5,
    "image_urls": ["https://start-frame.png", "https://end-frame.png"]
  }
}
```

### Response (Submit)
```json
{
  "code": 200,
  "data": {
    "task_id": "uuid-string",
    "status": "Pending"
  },
  "message": "success"
}
```

### Poll Status
```
GET https://api.piapi.ai/api/v1/task/{task_id}
x-api-key: <key>
```

### Response (Poll)
```json
{
  "code": 200,
  "data": {
    "task_id": "uuid",
    "status": "Completed",
    "output": {
      "video": "https://cdn.piapi.ai/..."
    },
    "meta": {
      "usage": { "type": "...", "frozen": 0, "consume": 0.75 }
    },
    "error": { "code": 0, "message": "" }
  }
}
```

### Status Values
| PiAPI Status | Frontend Mapping |
|---|---|
| `Completed` | `completed` → show video, stop polling |
| `Processing` | `processing` → keep polling |
| `Pending` | `pending` → keep polling |
| `Failed` | `failed` → show error, stop polling |
| `Staged` | `staged` → keep polling (queued) |

---

## File Changes

### Backend

**`src/video_gen.py`** (rewrite ~180 lines)
- `BASE_URL` → `https://api.piapi.ai/api/v1`
- `UPLOAD_URL` → `https://upload.theapi.app/api/ephemeral_resource`
- `MODELS` dict → PiAPI model configs (model, task_type, input defaults)
- New: `upload_ephemeral(api_key, filename, file_bytes)` → upload file, return URL
- `submit_text_to_video()` → build unified task payload
- `submit_with_refs()` → upload refs, build payload with URLs, detect mode
- `get_result()` → `GET /task/{task_id}`, normalize response
- `_submit()` → single `POST /task` endpoint
- Response normalization: `data.task_id` → `request_id`, `data.output.video` → `url`

**`src/routers/generate.py`** (lines 92-163)
- Env var: `AYCB_MUAPI_KEY` → `AYCB_PIAPI_KEY`
- `generate_video()`: accept `ref_images` (UploadFile list) + `ref_video` (UploadFile) + `audio_url` (str)
- Route to `submit_with_refs()` or `submit_text_to_video()` based on inputs

### Frontend

**`frontend/src/nodes/generate-video/useGenerateVideo.ts`**
- `VIDEO_MODELS` array: replace with 3 PiAPI models
- Dynamic image slots (same pattern as useGenerateImage: `connectedImageCount + 1`, max 12)
- Track `video-ref` and `audio-ref` connections
- `muApiKey` → `piApiKey`
- Cost: per-second pricing (`cost * duration`)
- `run()`: collect ref images from connected nodes, send as FormData files

**`frontend/src/nodes/generate-video/GenerateVideoNode.tsx`**
- `inputSlots`: use dynamic `imageSlots` + video-ref + audio-ref
- `muApiKey` → `piApiKey`

**`frontend/src/nodes/generate-video/node.manifest.ts`**
- Update `inputs`: only `prompt-in` (dynamic slots added by component)
- `defaultData.selectedModel`: `kling-3.0-omni`

**`frontend/src/api.ts`**
- `generateVideo()`: accept optional `refImages: File[]`, `refVideo: File`, `audioUrl: string`
- Append to FormData

**`frontend/src/types.ts`**
- `GenerateVideoResult`: add `task_id?: string`

**`frontend/src/components/SettingsContext.tsx`**
- `muApiKey` → `piApiKey`, `setMuApiKey` → `setPiApiKey`

**`frontend/src/components/SettingsPanel.tsx`**
- Label: "MuAPI Key" → "PiAPI Key"

### Tests

**`tests/test_video_gen.py`**
- Test `upload_ephemeral` builds correct request
- Test `submit_text_to_video` for each model
- Test `submit_with_refs` uploads files and builds correct payload
- Test mode auto-detection (T2V, first_last_frames, omni_reference)
- Test `get_result` normalizes PiAPI response
- Test error handling

---

## Migration Notes

- `muApiKey` in localStorage becomes orphaned. `piApiKey` starts empty. User re-enters key.
- `AYCB_MUAPI_KEY` env var replaced by `AYCB_PIAPI_KEY`.
- Existing MuAPI video URLs remain valid (CDN URLs don't change).
- In-progress MuAPI tasks at migration time won't poll correctly — page refresh clears state.

---

## Verification

1. Set PiAPI key in Settings > API Keys
2. **T2V:** Generate Video → Kling 3.0 Omni → prompt → Run → video plays
3. **T2V:** Repeat with Seedance 2.0 and Seedance 2.0 Fast
4. **Multi-ref:** Connect 2+ images to Generate Video → Seedance 2.0 → use @image1 @image2 in prompt → Run
5. **I2V (Kling):** Connect 1 image → Kling 3.0 Omni → Run
6. **Video ref:** Connect video-upload → Seedance 2.0 → @video1 in prompt → Run
7. Cost tracking: correct per-second pricing in console
8. `python -m pytest` — all pass
9. `cd frontend && npx vitest run` — all pass
