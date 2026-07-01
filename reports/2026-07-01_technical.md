# AYCB v2 — Technical Report 2026-07-01

Branch `dev-full`, checkpoint commit **`e8fd44d`** ("[feat] google models…").
Suites green at commit: **pytest 360 · vitest 556 · tsc --noEmit clean**.
Design/spec: `docs/superpowers/specs/2026-07-01-google-models-refresh-design.md`.

## Scope
Add Nano Banana 2 Lite (image) + Gemini Omni Flash (video), migrate NB2/NB Pro
image ids `-preview → GA`, refresh pricing. Built via a 7-agent ultracode
workflow (file-disjoint edits + verify-and-fix pass), then hand-fixed against
live-API + official-docs findings.

## New models (canonical)
- **`gemini-3.1-flash-lite-image`** — NB2 Lite. **1K-only** (0.5K/2K/4K rejected
  live 2026-07-01), per-img $0.034 (=½ NB2), token `[0.25, 30.00]`, batch-capable
  (submit accepted live). ARs = 10 (docs; no 4:1/1:4/8:1/1:8). Aliases `nb2lite`/`nblite`.
- **`gemini-omni-flash`** (provider_model_id `gemini-omni-flash-preview`) — video,
  `cost_per_sec {720p:0.10}`, 720p, 3–10s, 16:9/9:16, `max_ref_images=5`. Alias `omni`.

## GA-id migration
`gemini-3.1-flash-image-preview → gemini-3.1-flash-image`,
`gemini-3-pro-image-preview → gemini-3-pro-image`. Reverse aliases (`preview→GA`)
in `geminiProvider.ts` MODEL_MAP, `shared.py` IMAGE_MODELS, and a local
normalizer in `costEstimate.ts`. All pricing tables re-keyed to GA. Edit node
(`useImageEdit.ts`) + template seeds (`ProjectGallery.tsx`) intentionally left on
preview ids (resolve via alias; no regression).

## Files (today's work)
- New: `src/gemini_omni_gen.py`, `src/gemini_omni_helpers.py`,
  `tests/test_gemini_omni_gen.py`, `scripts/smoke_test_ga_image_ids.py`,
  `scripts/smoke_test_omni_flash_video.py`, the spec doc.
- Backend: `src/registry.py`, `src/shared.py`, `src/routers/generate.py`
  (gemini video dispatch + status), `src/plugins/batch_gen.py`,
  `src/batch_gen/{provider,models}.py`, `tests/test_registry.py`,
  `tests/test_batch_gen_*.py`.
- Frontend: `utils/costEstimate.ts`, `providers/{geminiShared,geminiProvider,geminiBatchPath}.ts`,
  `nodes/generate-image/{GenerateImageNode.tsx,useGenerateImage.ts}`,
  `nodes/generate-image-batch/GenerateImageBatchNode.tsx`,
  `nodes/generate-video/{GenerateVideoNode.tsx,useGenerateVideo.ts}`,
  `nodes/quickAliases.ts` + matching `.test.ts` files.

## Async/batch pricing (audited, all −50% correct)
Estimate label (`useGenerateImage.ts:474` ×0.5), `geminiBatchPath` discount,
`batch_gen/provider.py` BATCH_DISCOUNT, and the batch-node display all apply
−50%. Bug found+fixed: batch-node showed Lite at $0.034 (full) → now $0.017;
batch node now gates Lite to 1K.

## Live verification done (real key)
- Lite resolutions: 0.5K/2K/4K → HTTP 400, **1K → OK 1024×1024**.
- Lite `batchGenerateContent` submit → **accepted** (batch works).
- Model ids/resolutions cross-checked vs official image-generation docs.

## Known Issues / NOT verified
1. **Gemini Omni video — not run against live API.** Body/response shape follows
   docs; two `ponytail:`-flagged guesses in `gemini_omni_gen.py`
   (`duration_seconds` placement; seed not forwarded). `max_ref_images=5` is
   blog-sourced (official model card gives no number).
2. `_JOBS` in `gemini_omni_gen.py` is in-memory → lost on `--reload` restart
   (acceptable for a 30–120s render).
3. `test_batch_gen_store.py::test_atomic_write_no_partial_on_crash` is **flaky**
   on Windows (passes isolated 3/3; green in full run). Pre-existing, not touched.
4. Commit bundles prior uncommitted branch WIP (async queue 2026-06-14/16, LLM
   Claude-CLI skills, quota fix 2026-06-23) — entangled, unsplittable at file level.

## Next Tasks
1. `python scripts/smoke_test_omni_flash_video.py` — confirm Omni renders; fix
   `_build_body`/`_extract_video` if real field names differ.
2. `python scripts/smoke_test_ga_image_ids.py` — optional, confirm GA ids + that
   preview twins still resolve.
3. After 2026-06-30 alias-cleanup window ([[project_llm_alias_cleanup]]): the
   image `-preview → GA` reverse aliases can eventually be pruned once no saved
   canvas references them.
