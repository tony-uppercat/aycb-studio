# Design — Google models refresh (NB2 Lite + Omni video + GA-id migration + pricing)

**Date:** 2026-07-01 · **Branch:** dev-full · **Status:** approved, in build

## Goal
1. Add **Nano Banana 2 Lite** image model.
2. Add **Gemini Omni Flash** video model + a working backend provider.
3. **Migrate** existing NB2 / NB Pro image ids from `-preview` to GA, with reverse
   aliases so saved canvases still resolve. Update pricing tables.

## Canonical facts (Google official pricing page, 2026-07-01)

### New models
| model | canonical id | provider_model_id | pricing |
|---|---|---|---|
| Nano Banana 2 Lite (image) | `gemini-3.1-flash-lite-image` | — | per-img 0.5K 0.023 · 1K 0.034 · 2K 0.051 · 4K 0.076 (= ½ of NB2, matches official $0.0336/1K); token `[0.25, 30.00]`; batch-capable (½) |
| Gemini Omni Flash (video) | `gemini-omni-flash` (app) | `gemini-omni-flash-preview` | `cost_per_sec {720p: 0.10}`; 720p only; 16:9 / 9:16; 3–10s; T2V + I2V |

### GA-id migration (canonical rename + reverse alias)
- `gemini-3.1-flash-image-preview` → `gemini-3.1-flash-image`
- `gemini-3-pro-image-preview`     → `gemini-3-pro-image`
- (batch-only precursor) `gemini-3.1-flash-lite-image-preview` → `gemini-3.1-flash-lite-image`

Reverse aliases (`preview → GA`) added to `resolveModel` MODEL_MAP (frontend
`geminiProvider.ts`) and backend `shared.py` so pre-migration saved model ids
resolve to the GA id before any pricing/gate lookup. Existing display-name
aliases retargeted to GA ids.

### Prices unchanged (already correct), keyed by GA id
- `gemini-3.1-flash-image`: per-img `{0.5K 0.045, 1K 0.067, 2K 0.101, 4K 0.151, '' 0.067}`, token `[0.50, 60.00]`
- `gemini-3-pro-image`: per-img `{1K 0.134, 2K 0.134, 4K 0.240, '' 0.134}`, token `[2.00, 120.00]`

## Omni video provider (`src/gemini_omni_gen.py`, new)
Gemini-native — **not** Vertex/Veo. Uses the Interactions API
(`POST /v1beta/interactions`), per-second billing, blocking render.

- **Raw REST via httpx** (not the SDK `interactions` method — SDK-version risk;
  raw REST is the codebase's proven pattern for new Gemini surfaces).
  Body: `{model, input, response_format:{type:"video", aspect_ratio, delivery:"uri"}, generation_config:{video_config:{task}}}`.
  Result: inline base64 (`output_video.data` / `steps[].content[].data`) or a
  file `uri` (delivery:"uri", >4MB) → poll file `state==ACTIVE` → download.
- **Fit the submit/poll job flow:** `interactions.create` blocks until the clip
  renders (~tens of s). `submit_*` spawns a background `asyncio` task keyed by a
  generated `request_id` and returns immediately (`pending`); `get_result`
  returns `processing` until the task stores `completed`+url (video saved to
  `shared/Media` + bridged) or `failed`. Module-level `_JOBS` dict (lost on
  `--reload` restart — acceptable for a 30–120s render; `ponytail:` noted).
- Same public interface as `veo_gen`: `submit_text_to_video`, `submit_with_refs`,
  `get_result`, `wait_for_completion`, `MODELS` derived from registry
  (`provider=="gemini" and capability=="video"`).
- Router wiring: `/api/generate/video` new branch `model.startswith("gemini-omni")`;
  `/video/status` new `provider == "gemini"` branch. Frontend maps
  `gemini-omni-*` → provider `gemini` for status polling.

## Files (file-disjoint edit groups)
- **A1 backend registry:** `src/registry.py`, `src/shared.py`, `tests/test_registry.py`
- **A2 fe image pricing:** `utils/costEstimate.ts`, `providers/geminiShared.ts` (+ their `.test.ts`)
- **A3 fe image UI/provider:** `providers/geminiProvider.ts`, `nodes/generate-image/GenerateImageNode.tsx`, `nodes/generate-image/useGenerateImage.ts` (+ `geminiProvider.test.ts`, `generate-image.test.ts`)
- **A4 batch:** `providers/geminiBatchPath.ts`, `nodes/generate-image-batch/GenerateImageBatchNode.tsx` + `node.manifest.ts`, `src/batch_gen/provider.py`, `src/batch_gen/models.py` (+ tests)
- **A5 Omni backend:** NEW `src/gemini_omni_gen.py`, `src/routers/generate.py`, NEW `tests/test_gemini_omni_gen.py`
- **A6 fe video:** `nodes/generate-video/useGenerateVideo.ts`, `nodes/generate-video/GenerateVideoNode.tsx` (+ `generate-video.test.ts`)
- **A7 aliases:** `nodes/quickAliases.ts` (+ `quickAliases.test.ts`)
- **Verify phase:** run `pytest`, `tsc --noEmit`, `vitest run`; fix drift
  (`useModelRegistry.test.ts` fixtures, any missed key).

## UI-gate robustness
Small id-gates in `GenerateImageNode` (0.5K allow, hide-1K, THK) match the GA id
**and** accept the old `-preview` id, so pre-migration saved nodes don't lose
their gating. THK stays gated to flash-image only (Lite is a speed model, no
explicit thinking).

## Verification honesty
Omni's Interactions API and GA-id resolution **cannot be live-tested from here**.
Code follows the documented shape + full unit tests (mocked REST), but a
**smoke test with the real key** is required before claiming Omni generates /
GA ids resolve live. NB2 Lite 2K/4K max-res is unconfirmed by Google (only 1K
published) — all tiers priced/enabled per decision, with a `ponytail:` note that
2K/4K may error until smoke-tested.
