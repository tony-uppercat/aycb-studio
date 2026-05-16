# AYCB v2 — Technical Report 2026-05-16

## Summary
Two threads. (1) Switched Generate Image default model from NB2
(`gemini-3.1-flash-image-preview`) to Nano Banana Pro
(`gemini-3-pro-image-preview`). (2) Audited NB2 "perceived stupidity"
report from Antonio. Found 3 suspects introduced by commit `f186061`
(2026-05-15). Fixed B (thinking gating at 2K/4K) by handing control
back to the user; fixed A (ref pre-crop) by making it opt-in via new
toggle; left C (parts ordering) for next session.

---

## Thread 1 — Default model = Nano Banana Pro

| File | Change |
|---|---|
| `frontend/src/nodes/generate-image/node.manifest.ts` | `defaultData.selectedModel` flash → pro |
| `frontend/src/nodes/generate-image/useGenerateImage.ts:144` | fallback when `data.selectedModel` missing |
| `frontend/src/components/project/ProjectGallery.tsx:48,124` | "Image Generation" + "Image to Image" preset canvases |
| `frontend/src/nodes/generate-image/generate-image.test.ts:21` | assertion updated |

`16:9 / 1K` defaults are compatible with Pro's supported set, so no
other defaults changed.

---

## Thread 2 — NB2 audit + partial fix

### Suspects identified (commit f186061, 2026-05-15)

**A. Pre-crop ref images at output AR** —
`useGenerateImage.ts:503` calls `cropImageFileToAspectRatio` on every
ref before sending. Centered crop + canvas re-encode at 0.95 quality.
Triggered whenever `aspectRatio !== ''` (default `'16:9'`). Auto-adapt
aligns the AR on Ref 1, but refs 2-14 are not considered → cropped to
Ref 1's AR. With `inputLocked` or manual override, all refs cropped to
the locked AR regardless of source.

**B. Thinking forced to `minimal` at 2K/4K** — provider+UI gating
omitted `thinkingConfig` at 2K/4K, falling back to default `minimal`
level (rather than the previous `high`). Empirically justified by the
smoke tests in `scripts/smoke_test_flash_*.py` from 2026-05-14, but
trades thinking quality for resolution fidelity.

**C. Parts ordering asymmetry** — `geminiProvider.ts:89-95` sends
`[{text}, ...refs]`; `src/gemini.py:308-311` sends `[...refs, prompt]`.
Google's image-generation doc recommends image-first for I→I. Pre-
existing (not a recent regression). Left for next session.

**Minor** — `responseModalities: ['IMAGE','TEXT']` in the REST
provider, `['IMAGE']` (no grounding) in the SDK backend. Innocuous.

### Antonio's input
- Symptom: "ignores/follows prompt poorly" + "general quality down"
- Refs: both with-refs and text-only show degradation
- Onset: "gradual / don't know"
- Explicit request: **"permettimi di controllare thinking da UI"**

### Fix B — restored manual THK control at 2K/4K

| File | Change |
|---|---|
| `frontend/src/providers/geminiProvider.ts` | dropped `thinkingIncompatibleSize` check; sends `thinkingLevel: 'high'` whenever `options?.thinking !== false` on Flash |
| `frontend/src/nodes/generate-image/GenerateImageNode.tsx:112` | THK button no longer `disabled` at 2K/4K; tooltip warns of possible degrade |
| `frontend/src/utils/costEstimate.ts:142-150` | 1.3× multiplier re-applied at 2K/4K when `thinking=true` |
| `src/gemini.py:332-346` | dropped `thinking_incompatible_size` gating |

Tests updated:
- `frontend/src/providers/geminiProvider.test.ts` — 2K/4K tests now
  assert `thinkingConfig` is present
- `frontend/src/utils/costEstimate.test.ts` — 2K/4K tests now assert
  ×1.3 cost
- `tests/test_gemini_image.py` — `skips_thinking_config_at_*` renamed
  to `keeps_thinking_config_at_*`

### Fix A — pre-crop refs made opt-in

| File | Change |
|---|---|
| `frontend/src/nodes/generate-image/useGenerateImage.ts` | new `cropRefs` state (default `false`), persisted via `data.cropRefs`; pre-crop in `runSingle` now gated on `cropRefsRef.current` |
| `frontend/src/nodes/generate-image/GenerateImageNode.tsx` | new CROP button next to THK; tooltip explains the trade-off |

`cropImageFileToAspectRatio` itself unchanged — only the call-site is
gated.

---

## Files Changed (this session)

**Generate Image default:**
- `frontend/src/nodes/generate-image/node.manifest.ts`
- `frontend/src/components/project/ProjectGallery.tsx`
- `frontend/src/nodes/generate-image/generate-image.test.ts`

**NB2 audit:**
- `frontend/src/providers/geminiProvider.ts`
- `frontend/src/providers/geminiProvider.test.ts`
- `frontend/src/nodes/generate-image/useGenerateImage.ts`
- `frontend/src/nodes/generate-image/GenerateImageNode.tsx`
- `frontend/src/utils/costEstimate.ts`
- `frontend/src/utils/costEstimate.test.ts`
- `src/gemini.py`
- `tests/test_gemini_image.py`

**Reports:**
- `reports/2026-05-16_owner.md`
- `reports/2026-05-16_technical.md`

---

## Tests

- 33/33 frontend tests pass on impacted files
  (`generate-image`, `geminiProvider`, `costEstimate`).
- 9/9 backend tests pass on `tests/test_gemini_image.py`.
- `tsc --noEmit` clean.

---

## Memory Updates

- `feedback_gemini_thinking_imagesize.md` — "How to apply" section
  updated: Antonio asked to restore manual UI control on 2026-05-16;
  the auto-gating was removed. Empirical smoke-test data preserved
  for reference. Note: re-run smoke tests before re-introducing any
  gating — Google may have fixed the API since.

---

## Open Issues / Next Tasks

1. **Suspect C (parts ordering)** — align frontend `geminiProvider.ts`
   parts with backend convention `[...refs, text]`. Doc-supported as
   the recommended layout for image-to-image. Single-file change.
2. **Smoke test rerun** — execute `scripts/smoke_test_flash_thinking_4k.py`
   + `smoke_test_flash_2k_thinking_repeat.py` live against the current
   API to see if the 2K/4K+thinking degrade is still reproducible. If
   not, the warning tooltip in the THK toggle can be softened.
3. **Empirical user check** — Antonio to try NB2 with THK on, CROP off
   on his typical flows and confirm whether the "stupidity" is gone.

---

## Working Tree (not part of this session)

Pre-existing modifications carried over from before this session,
left untouched per CLAUDE.md rule 13:
- `config/prompts/library.json`
- `frontend/src/components/media/FullscreenViewer.{tsx,module.css}`
- `frontend/src/components/media/useImageZoom.ts`
- `frontend/src/nodes/_shared/CompareSlider.tsx`
- `frontend/src/nodes/_shared/Node.module.css`
- `frontend/src/nodes/image-compare/ImageCompareNode.tsx`

Untracked, not authored this session:
- `scripts/batch_brush_refsheet.py` — see Thread 3 addendum below
- `scripts/batch_brush_refsheet_async.py` — see Thread 3 addendum below

---

## Thread 3 — CLI Batch Generation + Project Skill

Separate evening session 2026-05-15 → 2026-05-16. Built CLI workflow
for batch image generation (sync + async Batch API) starting from
"possiamo generare via CLI?" and ending with a generalized project
skill that loads automatically for future `scripts/` work.

### Empirical chain that drove the design

1. First attempt: Pro Image 2K direct on 3 PAO brush photos. 1/3 OK
   (4673×2629 ref, 12 MB), 2/3 HTTP 503 "Deadline expired" (8192×5464
   / 51 MB and 7812×4394 / 40 MB refs).
2. Added retry (5s + 15s backoff, 3 attempts) — same 2 images still
   failed 3/3 attempts each. → not transient.
3. Root cause identified: Google's server-side deadline cannot
   finish processing on huge refs in time. Refs only need visual
   identity, not full resolution.
4. Switched to NB2 Flash 1K + pre-downscale to 1536px JPEG q=92.
   3/3 success in 14-31s, ~$0.083/img.
5. Antonio requested Batch API for 50% cost — sent the
   ai.google.dev/gemini-api/docs/batch-api spec. Implemented as a
   second script using `google.genai` SDK (`client.batches.*`,
   `client.files.*`), JSONL file upload (doc-recommended for
   images), polling at 10s, crash recovery via persisted
   `.batch_job.json`.

### Files Created

| File | Purpose |
|---|---|
| `scripts/batch_brush_refsheet.py` | Sync batch via REST direct (urllib). Flash 1K, 16:9. Retry on 5xx/429, pre-downscale refs to 1536px JPEG q=92, skip-if-exists, tee_stdout log file, cost table. ~325 lines (within 300+30% margin per Antonio's clarification). |
| `scripts/batch_brush_refsheet_async.py` | Async batch via Gemini Batch API SDK. Pro Image 2K, 16:9. JSONL upload, poll every 10s, resume via `.batch_job.json`, 50% discount in cost table. ~290 lines. |
| `skills/aycb-cli-generation/SKILL.md` | Project skill codifying every pattern proven this session (refs prep, REST-vs-SDK, retry, log, cost, batch API, crash recovery, mistakes table). |

### Files Modified

| File | Change |
|---|---|
| `CLAUDE.md` | Added trigger line under Session Start: *"When creating or modifying CLI scripts in `scripts/` (image/video generation, smoke tests, Batch API), read `skills/aycb-cli-generation/SKILL.md`"*. |

### Memory Updates (`~/.claude/projects/.../memory/`)

| File | Type | Why |
|---|---|---|
| `feedback_downscale_large_refs.md` | feedback (new) | Pre-downscale refs >2K/5MB to ~1536px JPEG before sending — Pro Image 503s on 8K/40MB+ inputs. Empirically observed on this session. |
| `reference_cli_generation_skill.md` | reference (new) | Pointer mirroring CLAUDE.md's trigger — ensures the skill loads even when conversation mentions CLI without yet touching `scripts/`. |
| `MEMORY.md` | index | Indexed both new memories under Feedback / Reference sections. |

### Tests

- `python -m py_compile` clean on both new scripts.
- Sync script empirically validated: 3/3 OK on first NB2 1K run
  after downscale fix.
- Async script not yet run live — awaiting Antonio's go-ahead.
- No unit tests added (one-shot CLI scripts, low value).

### Cost summary (this thread)

| Run | Cost USD |
|---|---|
| Pro 2K attempt 1 (1/3 OK, 2/3 503) | ~$0.30 |
| Pro 2K retry (0/2 OK, all 503) | $0 (failed requests aren't billed) |
| Flash 1K + downscaled refs (3/3 OK) | ~$0.25 |
| Flash 1K re-run after `v1/` move (3/3 OK) | ~$0.25 |
| **Total session out-of-pocket** | **~$0.80** |

### Output Artifacts (outside repo)

In `C:\Users\upper\Uppercat Dropbox\Antonio Cottone\2026\06_PAO\00_incoming\Product Videos\01- Brushes\00_batch\00_outuput\`:
- `v1/` — first NB2 1K batch (3 PNGs, archived by Antonio)
- `IMG_0524.png`, `IMG_0539.png`, `IMG_0542.png` — second NB2 1K batch
- `batch_20260515_194816.log` — run log with cost table

### Open Items / Next Tasks

1. **First live Pro 2K Batch API run** when Antonio wants. Pro 2K
   should now succeed even on huge refs because (a) downscale is
   applied, and (b) batch API has no per-request deadline.
2. **Skill iteration** if real use surfaces gaps. Currently 936 words
   (over the 500-word target for "other skills" but content-dense
   reference, not always-loaded).
3. **Backlog deferred** from broader project (untouched): pre-existing
   working-tree mods in image-compare / fullscreen viewer; `config/
   prompts/library.json` change.
