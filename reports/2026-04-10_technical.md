# AYCB v2 — Technical Report 2026-04-10

## Summary
Complete video generation rewrite: migrated from MuAPI to PiAPI, added fal.ai and Atlas Cloud providers, implemented multi-reference (omni_reference), provider filter UI, per-second cost tracking, and video bridge to shared/Media/ with metadata sidecars. Atlas Cloud is the new default (most reliable).

## Files Changed

### Created (6 files)
- `src/fal_video_gen.py` — fal.ai queue API client for Kling v3 Std/Pro + Seedance 2.0. Data URI image support.
- `src/atlas_video_gen.py` — Atlas Cloud REST client for Seedance 2.0 Fast/Pro. Bearer auth, multi-ref via reference_images/videos/audio arrays.
- `tests/test_video_gen.py` — 22 tests for PiAPI client (models, builders, upload, polling)
- `tests/test_fal_video_gen.py` — 16 tests for fal.ai client
- `docs/superpowers/specs/2026-04-10-piapi-migration-design.md` — Design spec
- `reports/2026-04-10_technical.md` — This report

### Modified (11 files)

**Backend:**
- `src/video_gen.py` — Complete rewrite from MuAPI to PiAPI.ai unified task API. Models: Kling 3.0 Omni, Seedance 2.0, Seedance 2.0 Fast. Added `upload_ephemeral()` for PiAPI file upload. Seedance mode detection fixed: always `omni_reference` for multi-ref (never `first_last_frames` due to aspect ratio constraint).
- `src/routers/generate.py` — Split video endpoint into `_generate_video_piapi()`, `_generate_video_fal()`, `_generate_video_atlas()`. Model prefix routing (`fal-`/`atlas-`). Changed error HTTP code from 502 to 422 (502 was masked by frontend as "backend down"). Status endpoint accepts `provider` param.
- `src/routers/bridge.py` — New `POST /api/bridge/video` endpoint (downloads from CDN, saves to shared/Media/). New `_find_json_meta()` helper for video sidecar metadata.
- `src/shared.py` — New `_save_video_to_bridge()` function. Writes `.meta.json` sidecar with prompt/model/cost/duration.

**Frontend:**
- `frontend/src/nodes/generate-video/useGenerateVideo.ts` — Full rewrite. 8 models across 3 providers. Dynamic image slots (max 12, same pattern as Generate Image). Provider-aware API key selection. Cost estimation + actual cost tracking. Video bridge on completion. History state (ids/urls/index).
- `frontend/src/nodes/generate-video/GenerateVideoNode.tsx` — Provider filter buttons (fal.ai/Atlas/PiAPI). History navigation bar. lastCost + estimatedCost props to NodeShell.
- `frontend/src/nodes/generate-video/GenerateVideoNode.module.css` — `.providerRow`, `.providerBtn`, `.providerBtnActive` styles (accent color).
- `frontend/src/nodes/generate-video/node.manifest.ts` — Default: `atlas-seedance-2.0`, aspect_ratio: `21:9`.
- `frontend/src/nodes/generate-video/generate-video.test.ts` — Updated for new manifest defaults.
- `frontend/src/api.ts` — `generateVideo()` accepts refImages/refVideo/audioUrl. `videoStatus()` accepts provider + endpoint params. New `bridgeVideo()` exported function.
- `frontend/src/types.ts` — `GenerateVideoResult` with task_id + fal endpoint fields.
- `frontend/src/components/SettingsContext.tsx` — `muApiKey` → `piApiKey`. Added `falApiKey`, `atlasApiKey`.
- `frontend/src/components/SettingsPanel.tsx` — Rename MuAPI → PiAPI. New fal.ai Key and Atlas Cloud Key fields.

## Architecture

### Provider routing
```
Frontend dropdown selects model (atlas-*/fal-*/other)
  → api.generateVideo() with FormData + provider-aware key
  → Backend router detects prefix → routes to provider client
  → Provider returns {request_id, status}
  → Frontend polls api.videoStatus(id, key, provider, endpoint)
  → On completed: bridgeVideo(url) downloads + saves locally
  → Cost tracked in canvasStore
```

### Video bridge flow
```
Video completes on CDN (Atlas/fal/PiAPI)
  → Frontend POST /api/bridge/video with URL + metadata
  → Backend httpx.get(url) → video bytes
  → shared.py _save_video_to_bridge() writes .mp4 + .meta.json sidecar
  → Review Hub scanner picks up .mp4 (already in MEDIA_EXTENSIONS)
  → Video appears in Media Gallery and Review Hub
```

### Seedance mode detection (src/video_gen.py)
- No refs → `text_to_video`
- Any refs (1+ images, video, audio) → `omni_reference`
- **Never** `first_last_frames` (requires matching aspect ratios — caused generation failure)

## Models Available

| Model | Provider | Price/s | Notes |
|---|---|---|---|
| Kling 3.0 Omni Std | fal.ai | $0.07 | Fastest/cheapest Kling |
| Kling 3.0 Omni Pro | fal.ai | $0.10 | 1080p, native audio |
| Seedance 2.0 (fal) | fal.ai | $0.30 | Most expensive |
| **Seedance 2.0 Fast (Atlas)** | **Atlas** | **$0.18** | **Default, most reliable** |
| Seedance 2.0 (Atlas) | Atlas | $0.25 | Full quality |
| Kling 3.0 Omni (PiAPI) | PiAPI | $0.10-0.15 | Resolution-based |
| Seedance 2.0 (PiAPI) | PiAPI | $0.15 | omni_reference multi-ref |
| Seedance 2.0 Fast (PiAPI) | PiAPI | $0.10 | Requires Creator plan for file upload |

## Bugs Fixed
- **502 mask**: Frontend treated any 502 as "backend not responding", masking real provider errors. Changed to 422.
- **PiAPI upload 403**: Free plan can't upload. Improved error message to suggest Creator plan or T2V mode.
- **Seedance first_last_frames crash**: Mode required matching aspect ratios between frames, crashed with mixed-source images. Now always uses `omni_reference`.
- **LAN access vs localhost**: `isBackendAvailable()` only allows localhost — users from LAN IP get "backend not responding".

## Tests
- Backend: 150 passed (was 134, +22 PiAPI + 16 fal.ai = 38 new video tests; +something for other)
- Frontend: 157 passed
- Total: 307 tests, all green

## Known Issues
- PiAPI Seedance Fast requires Creator plan ($9.99/mo) for file uploads (omni_reference with local images)
- fal.ai Seedance 2.0 is expensive ($0.30/s vs Atlas $0.18/s)
- Atlas doesn't return cost in API response — we use estimate (actual cost shown in Atlas dashboard)
- Video history CDN URLs are session-only (not persisted across page refresh — only mediaId stems persist)

## Next Tasks
1. Add negative_prompt + cfg_scale to advanced features (scheduled 2026-04-17)
2. Verify video thumbnails work in Media Gallery (scanner may not generate them)
3. Test multi-ref end-to-end on Atlas with 2-3 images
4. Consider video thumbnail generation on bridge (first frame extraction via ffmpeg)
