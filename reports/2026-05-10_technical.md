# AYCB v2 — Technical Report 2026-05-10

## Summary
Two threads this session: (1) shipped a fix to the OpenAI image
provider that silently downgraded `4K` selection to `1K` plus a new
`FHD` preset for `gpt-image-2`. (2) Brainstormed, spec'd, and planned
a "per-ID JSON mode" for the Generate Image node — implementation
not yet started. Session pauses at the execution-mode choice for that
plan.

---

## Bug Fixed

### `4K` silently generated `1K` images on gpt-image-2 — `openaiProvider.ts:30`

**Root cause:** `computeSize()` had a hardcoded ternary
`resolution === '2K' ? 2.4 : 1.05`. Anything not equal to `'2K'`
(including `'4K'`) fell through to the 1.05 MP target. The user
selected 4K expecting ~8 MP at quality `high`, but the API received a
~1 MP size with quality `high` — paying high-quality cost for a small
image. The `quality` knob and the `size` parameter had drifted out of
sync.

**Fix:** Replaced the ternary with an explicit if-chain mapping each
bucket to its real target — 1K=1.05 MP, FHD=2.1 MP (with 16:9 special
case below), 2K=2.4 MP, 4K=8.0 MP. The 3840 max-edge clamp already
present handles the 4K upper bound on gpt-image-2's allowed pixel
range.

---

## Feature Added

### `FHD` resolution preset for `gpt-image-2`

`gpt-image-2` requires both edges to be multiples of 16. 1080 is not
(67.5 × 16), so 1920×1080 cannot be passed directly. The preset maps
to:
- AR 16:9 → `1920x1088`
- AR 9:16 → `1088x1920`
- Other ARs → fall through to ~2.1 MP target at the chosen AR.

The 8-pixel difference from exact FHD is documented in the doc
comment so callers know to crop if pixel-exact is required. The
preset is OpenAI-only — Gemini's `imageSize` field accepts only
`1K`/`2K`/`4K` discrete buckets. The dropdown filters `FHD` to
`provider === 'openai'` and a `useEffect` resets the resolution to
Auto if the model switches away from OpenAI while FHD was selected.

Cost estimate: `FHD` set to $0.18 (slightly under 2K because of fewer
pixels). `4K` bumped from $0.211 → $0.50 to reflect the real 4K
output token cost post-fix (was wildly understated when the bucket
silently rendered at 1K).

---

## Decisions (no code change)

- **Higgsfield Soul integration:** skipped. Standalone provider, not
  covered by existing OpenAI/Recraft/Gemini/Flux APIs. Cheapest path
  would be via WaveSpeed gateway ($0.025–0.030/image) but adds a new
  provider file + new API key field. User chose to defer.
- **Recraft V3/V2 legacy models:** skipped. No "Soul" / "V5" exists
  upstream — Recraft API still on V4 in 2026. V3/V2 fall back to
  cheaper but lower-quality variants; not worth the dropdown noise.
- **1K dimensions across common ARs:** confirmed status quo is
  correct. `computeSize()` already targets ~1.05 MP for every AR,
  with rounding variance ≤ 0.01 MP. User selected this option after
  seeing the dimension table for all three "what does same size
  mean" interpretations.

---

## Spec'd & Planned (not yet implemented)

### Per-ID JSON mode for Generate Image

**Spec:** `docs/superpowers/specs/2026-05-10-genimage-per-id-design.md`
(commit `bfe4622`).

**Plan:** `docs/superpowers/plans/2026-05-10-genimage-per-id.md`
(commit `cdb413d`). 11 tasks, TDD-style.

**Approach in one paragraph:** New JSON toggle button on the AR/Res
row, sibling of EDIT. When active, the node parses `prompt-in` as a
JSON array of strings and produces one image per element on dynamic
output pins (`image-out` for "Last", `image-0`/`image-1`/... for
each entry). Generations run in parallel batches of max 4. Pure
helpers (parsing, label formatting, batch-loop executor) live in a
new `frontend/src/nodes/generate-image/jsonMode.ts` so they're
testable without rendering. The hook gains `jsonMode` state + a
`runJsonMode` wrapper that calls `executeJsonMode` and writes the
results into the existing `outputMediaIds` map. Mutual exclusion with
EDIT mode. ×N batch toggle hidden when JSON is on.

---

## Files Changed (committed this session)

| File | Change | Commit |
|---|---|---|
| `frontend/src/providers/openaiProvider.ts` | Fix 4K bucket fallthrough; add FHD branch (1920×1088 / 1088×1920); update doc comment | f7dd117 |
| `frontend/src/nodes/generate-image/useGenerateImage.ts` | `RESOLUTIONS` adds FHD; `useEffect` resets FHD when switching off OpenAI | f7dd117 |
| `frontend/src/nodes/generate-image/GenerateImageNode.tsx` | Filter FHD option to OpenAI provider only | f7dd117 |
| `frontend/src/utils/costEstimate.ts` | Add `FHD: 0.18`; bump `4K: 0.211 → 0.50` | f7dd117 |
| `docs/superpowers/specs/2026-05-10-genimage-per-id-design.md` | New | bfe4622 |
| `docs/superpowers/plans/2026-05-10-genimage-per-id.md` | New | cdb413d |

---

## Branch state

`dev` is 4 commits ahead of `origin/dev`:
- `cdb413d` plan
- `bfe4622` spec
- `f7dd117` 4K bug + FHD
- `64a484b` (from earlier — switch infinite loop + Backups tab)

Working tree (uncommitted, **not part of this session's work**):
- `M .claude/settings.local.json`
- `M config/prompts/library.json`
- `?? .claude/scheduled_tasks.lock`

These are unrelated; left alone per CLAUDE.md rule 13 ("modify only
files specified or directly required").

---

## Tests
- 350/350 frontend tests pass.
- `tsc --noEmit` clean.
- Backend not touched.

---

## Resume Point

Session paused **after** writing the implementation plan for the
per-ID JSON mode and **before** starting Task 1. Next session needs
to pick the execution approach:

- **Subagent-Driven (recommended):** invoke
  `superpowers:subagent-driven-development` to dispatch one fresh
  subagent per plan task. Fast iteration with isolated context.
- **Inline Execution:** invoke `superpowers:executing-plans` to walk
  the tasks in-session with batch checkpoints.

Either way, Task 1 is the entry point: create
`frontend/src/nodes/generate-image/jsonMode.ts` with
`parseJsonPrompts` and `shortLabel` helpers, plus a sibling
`jsonMode.test.ts` with the failing tests already defined in the plan.
