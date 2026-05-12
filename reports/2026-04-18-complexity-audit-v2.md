# Code Complexity Audit v2 — 2026-04-18

AYCB Studio v2 — independent re-audit of v1 (same-day), based on Ousterhout's
_A Philosophy of Software Design_.

Scope verified: **~55 files opened and read** (18% of files, ~55% of LOC),
every Critical and Major finding confirmed against live source with line
numbers. 121 commits over 6 weeks, single author (@tony-uppercat).

This document is a second-pass assessment, not a replay of v1. Where a
finding agrees with v1 it is restated briefly; where v2 diverges (count,
location, severity, missing site) the delta is called out.

---

## Executive Summary

The v1 audit's thesis holds: **two concrete debt clusters** — (a) model
registry duplicated across many sites, (b) a security/correctness cluster
around filesystem ↔ DB operations. v2 hardens the evidence, expands the
counts, and finds additional sites v1 missed.

**Key deltas from v1**:

| Area | v1 claim | v2 verified |
|------|----------|-------------|
| Model registry leak sites | "10+" | **13+ named registries** — v1 missed `cli.py:22 MODELS`, `shared.py:83 MODELS` (LLM), `costEstimate.ts` references |
| Review Hub manual router list | 14 modules listed twice | **13 modules** — `app.py:11 + :119` (v1 said 14; current code has 13 after asset_links was added) |
| Transactional gap endpoints | 4 | **5** — v2 adds `folders.py:121-147 move_media` (file move before DB UPDATE) |
| Filename sanitization variants | 3 + missing call | Confirmed. Plus `bridge.py:381` inline regex and `bridge.py:101, 130, 227, 397, 416` repeat the same `[^a-zA-Z0-9_\-]` filter inline at 5 sites |
| `isBackendAvailable()` duplication | Not flagged | New minor finding: identical `location.port === '5100'` logic in `frontend/src/api.ts:13-15` and `frontend/src/components/console/ReviewTab.tsx:63-65` |

**Grade: C (5.91 / 10)** — marginally below v1's 6.06. The shift is driven
by Information Hiding (3/10 vs v1's 4/10, reflecting the expanded registry
count) and Naming (6 vs 7, reflecting the `_safe_name` / `_sanitize_filename` /
inline-regex split).

Six recommendations in the 16h range still move it to B. Debt remains
structured, localized, and tractable.

---

## Score Dashboard

| # | Dimension | v1 | v2 | Delta | Status |
|---|-----------|----|----|-------|--------|
| 1 | Module Depth | 6 | 6 | 0 | Adequate |
| 2 | Information Hiding | 4 | **3** | **−1** | Poor |
| 3 | Abstraction Quality | 7 | 7 | 0 | Good |
| 4 | Complexity Indicators | 5 | 5 | 0 | Adequate |
| 5 | Error Handling | 5 | 5 | 0 | Adequate |
| 6 | Layering | 7 | 7 | 0 | Good |
| 7 | Design Investment | 8 | 8 | 0 | Good |
| 8 | Comments & Abstractions | 8 | 8 | 0 | Good |
| 9 | Codebase Navigability | 7 | 7 | 0 | Good |
| 10 | Naming & Obviousness | 7 | **6** | **−1** | Adequate |
| 11 | Consistency | 3 | 3 | 0 | Poor |
| 12 | Software Trends Anti-Patterns | 7 | 7 | 0 | Good |
| 13 | Performance-Design Relationship | 5 | 5 | 0 | Adequate |
| | **Weighted Average** | **6.06** | **5.91** | −0.15 | **Grade: C** |

Formula: `(Σ core × 1.5 + Σ structural × 1.2 + Σ surface × 1.0) / 16`
= `(21 × 1.5 + 35 × 1.2 + 21 × 1.0) / 16` = `94.5 / 16` = **5.91**.

---

## Findings

Severity litmus test applied to every finding:
- **Critical** — actively spreading complexity; blocks safe change
- **Major** — significant but contained; degrades quality, doesn't cascade
- **Minor** — suboptimal but low impact; fix opportunistically

Git attribution: all findings within the 100-commit window. Single author.
Attribution is for drift context, not blame.

### Critical

| # | Dimension | Location | Issue | Attribution |
|---|-----------|----------|-------|-------------|
| **C1** | Error Handling (security) | `src/review_hub/routes/upload.py:22-26, 46-61` | **Path traversal vulnerability confirmed.** `upload_media` writes `dest = settings.media_dir / file.filename` without sanitization (line 24). `upload_reference` line 58 does the same after sanitizing `directory` but not `file.filename`. A client sending `filename="../../../etc/passwd"` escapes `media_dir`. `_sanitize_filename` exists in `src/shared.py:72-79` and is not imported here. | `81c9c0d` (2026-04-05) + `7f8fcfb` (Settings Paths) |
| **C2** | Information Leakage | `src/vertex_video_gen.py:77-86, 105` + `frontend/src/nodes/generate-video/useGenerateVideo.ts` | **Silent UI/backend duration mismatch.** `_ALLOWED_DURATIONS = (4, 6, 8)` + `_snap_duration()` picks the nearest valid value silently (`min(_ALLOWED_DURATIONS, key=lambda d: abs(d - duration))`). UI slider shows 5 → backend generates 4 and the UI never learns. Constraint is provider-specific knowledge existing only in the backend. | `9994c92` (2026-04-17) |
| **C3** | Information Leakage | **13 named registry sites** | **Model registry duplication — expanded from v1.** Verified sites: `src/shared.py:83 MODELS`, `:89 IMAGE_MODELS`, `:95 MODEL_PRICING`; `src/video_gen.py:20 MODELS`; `src/fal_video_gen.py:19 MODELS`; `src/atlas_video_gen.py:19 MODELS`; `src/vertex_video_gen.py:24 MODELS`; `src/cli.py:22 MODELS` (v1 missed this); `src/routers/image_edit.py:38 EDIT_MODELS` + hardcoded `per_image = 0.067 if is_gemini else 0.02` at line 255; `frontend/src/providers/geminiProvider.ts:11 MODEL_MAP` + `:40 GEMINI_IMAGE_COST`; `frontend/src/providers/fluxProvider.ts:5 BFL_MODELS` + `:70 FLUX_PRICING`; `frontend/src/nodes/generate-image/useGenerateImage.ts:16 IMAGE_MODELS`; `frontend/src/nodes/generate-video/useGenerateVideo.ts:27 VIDEO_MODELS`. Adding one Veo model touches `vertex_video_gen.py`, `useGenerateVideo.ts`, and requires cost sync in `MODEL_PRICING`. | `29ed94a` (video rewrite) + `7524a35` (light-director) + `dda18e8` (Veo) |

### Major

| # | Dimension | Location | Issue | Attribution |
|---|-----------|----------|-------|-------------|
| **M1** | Information Leakage | `src/routers/bridge.py` — 9 sites | 9 raw `sqlite3.connect(...?mode=ro)` helpers with inline SQL and direct schema knowledge (`_get_review_from_db:46`, `_load_filename_to_thumb:160`, `_lookup_media_id:224`, `_query_references:258`, `_fetch_thumbnail_path:557`, `_fetch_image_paths:596`, + 3 more in bridge_assets.py). Coexists with `review_hub/queries/` async layer. Schema migration breaks in 9 places instead of 1. | Legacy + `7f8fcfb` |
| **M2** | Consistency | `frontend/src/review/**` vs rest of frontend | Two naming conventions in the same frontend. Review Hub SPA uses snake_case for variables and props (`user_name`, `media_id`, `stroke_width`, `drawing_visible` — verified in `DrawingCanvas.tsx:33-41`), everywhere else uses camelCase. Single codebase, two style guides split by directory. | `fae3be5` ("snake_case rename") |
| **M3** | Repetition | `src/review_hub/app.py:11 + :119` | 13 router modules listed twice verbatim (v1 said 14 — current code has 13 after asset_links module added). Parent `src/api.py:63-78` uses `pkgutil.iter_modules` for auto-discovery. Same problem, two solutions in the same project. | Legacy + `fa0cf4ba` |
| **M4** | Module Depth | `frontend/src/components/console/ConsolePanel.tsx` (615), `frontend/src/components/canvas/CanvasContextMenu.tsx` (558), `frontend/src/nodes/generate-image/useGenerateImage.ts` (444 → returns 30+ values), `frontend/src/components/canvas/FlowCanvas.tsx` (700), `frontend/src/components/SettingsPanel.tsx` (534), `frontend/src/components/CollageEditor.tsx` (501 — v1 missed), `frontend/src/components/media/MediaBrowser.tsx` (462 — v1 missed) | **Shallow modules in god-component / god-hook form.** `useGenerateImage` return statement at `:404-443` exposes 30+ values — overexposure red flag. `ConsolePanel` contains 5 tabs + feedback subsystem inline. `MediaBrowser` (v1 missed it) embeds 3 tabs + drag-drop + cleanup + Lightbox switch in one 462-LOC component. `CollageEditor` mixes aspect ratio + grid + drag-drop + pan-crop + canvas export in 501 LOC. | `7524a35` + Legacy |
| **M5** | Layering (action at a distance) | `frontend/src/review/components/DrawingCanvas.tsx:219-265` | Component attaches `__drawingCanvasSave`, `__drawingCanvasExportOverlay`, `__drawingCanvasExportMerged` onto `window`. Toolbar (separate component, no import) calls them. Dependency invisible in imports. Textbook "Unknown Unknowns". | `fae3be5` |
| **M6** | Error Handling (correctness) | `folders.py:80-100 rename_folder`, `folders.py:121-147 move_media` (**v1 missed**), `media.py:118-148 delete_media`, `media.py:151-180 bulk_delete_media`, `upload.py:72-95 upload_reference` | **No transactional rollback across disk + DB ops — 5 endpoints, not 4.** `rename_folder` renames disk first; `move_media` `shutil.move` then UPDATE; `delete_media` unlinks file + thumb then DELETE; `bulk_delete_media` loops same pattern; `upload_reference` writes file → INSERT → UPDATE thumbnail in two separate DB connections. Any intermediate failure = disk/DB drift. | `7f8fcfb` + `81c9c0d` |
| **M7** | Performance | `src/review_hub/scanner.py:69, 129` | `rglob("*")` over `media_dir` AND `assets_dir` every 5s (confirmed at lines 69 and 129). Two full-tree walks + full set-difference on path strings, no fingerprinting, no mtime tracking beyond a 2s SETTLE gate. At 5k files on NTFS: ~100ms CPU per scan plus Windows `/` vs `\` inconsistency can flap an entry (delete+insert every scan if separators disagree). | Legacy |
| **M8** | Cognitive Load | `frontend/src/nodes/generate-image/useGenerateImage.ts:84-100, 190-191` | **7 mirror refs + useEffect pairs** (v1 said 6): `aspectRatioRef`, `resolutionRef`, `groundingRef`, `editModeRef`, `imageB64Ref`, `compareSourceUrlRef`, `currentMediaIdRef`. All to dodge stale closures in `runSingle`. Symptom of a missing `useStateRef<T>` helper. | `7524a35` |
| **M9** | Consistency | `frontend/src/nodes/nb2-light-director/editor/NB2Editor.tsx` (232 LOC) | 300+ inline `style={{...}}` literals in a single component. No CSS module. Hardcoded colors (`'#18181b'`, `'#e8a849'`) bypass design tokens (`--color-bg-primary`, `--accent`). A theme change needs a manual grep of the whole file. | `7524a35` |
| **M10** | Information Leakage | `src/routers/image_edit.py:38-41, 255` | `EDIT_MODELS` list + hardcoded `per_image = 0.067 if is_gemini else 0.02`. The `0.067` mathematically equals the Gemini 3.1 image price-per-call but is duplicated across 4 places (`shared.py:MODEL_PRICING`, `geminiProvider.ts:GEMINI_IMAGE_COST`, `useGenerateImage.ts:IMAGE_MODELS` at 0.067, `image_edit.py:255`). | `7f8fcfb` |
| **M11** | Naming | `src/routers/{video,generate}.py` | **Name collision.** `video.py` handles FFmpeg trim/extract/duration (`/api/video`). `generate.py` handles cloud video generation (`/api/generate/video`). A developer searching for "video" lands on `video.py` first but it is unrelated to generation. | Legacy |
| **M12** | Consistency | `src/shared.py:72 _sanitize_filename`, `src/review_hub/routes/folders.py:30 _safe_name`, `src/routers/bridge.py:101,130,227,381,397,416` inline regex × 5, `src/routers/bridge_assets.py:157,163` inline regex × 2 | **3 functions + 7 inline-regex sites** for filename/stem sanitization (v1 noted 3 + 2 inline; v2 found 7 inline). No single source of truth. The inline pattern `[^a-zA-Z0-9_\-]` recurs almost verbatim 7 times in `bridge.py` alone. | Legacy + `7f8fcfb` |

### Minor

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| m1 | Repetition | `src/review_hub/app.py:51-88` | 12 nearly-identical Socket.IO relay handlers (`drawing_stroke`, `drawing_clear`, `drawing_undo`, `cursor_move`, `comment_new`, `comment_delete`, `favorite_toggle`, `asset_link_new`, `asset_link_delete`, `ping_check`) — all pattern `await sio.emit(EVENT, data, room="review", skip_sid=sid)`. Table-driven in 5 LOC. |
| m2 | Information Leakage (new) | `frontend/src/api.ts:13-15` + `frontend/src/components/console/ReviewTab.tsx:63-65` | **`isBackendAvailable()` duplication.** Identical `location.port === '5100' \|\| location.hostname === 'localhost' \|\| ...` logic in two files. Moving the dev port = edit two files. |
| m3 | Performance | `src/plugins/perf_log.py:42-63` | Sync I/O (`write_text`) inside `async def` handler — blocks the event loop during writes. |
| m4 | Information Leakage | `src/shared.py:231-329` | `_save_to_bridge` and `_save_video_to_bridge` duplicate folder resolution + datetime formatting in near-parallel paths. |
| m5 | Layering | `src/routers/generate.py` | 10 lazy imports inside endpoints (Windows `cv2/numpy` workaround). |
| m6 | Performance | `src/review_hub/scanner.py:50-52` | Sidecar `sidecar.read_text()` not size-capped — a corrupted huge sidecar can OOM the scanner loop. |
| m7 | Repetition | `frontend/src/api.ts:36-92` | 3 fetch wrappers (`get`, `post`, `put`) with 80% identical body (recordRequest, backendError, 502 check, content-type check, ok check, json parse). |
| m8 | Cognitive Load | `frontend/src/review/hooks/useGalleryData.ts` | `silentRefresh` not debounced — every `comment_new` Socket.IO event triggers a full refetch. |
| m9 | Consistency | `frontend/src/types.ts:152-193` | `JsonParserNodeData` camelCase, `BracketParserNodeData` snake_case, `JsonParserBlendNodeData` camelCase. Three conventions in the same domain. |
| m10 | Naming | `src/vertex_video_gen.py:1-8` | File named `vertex_video_gen` but no longer uses Vertex AI (uses Gemini API key since commit `21500e7`). Docstring acknowledges historical name. |
| m11 | Performance | `frontend/src/nodes/nb2-light-director/editor/Viewport.tsx:130` | `requestAnimationFrame` loop always active — renders every frame even when scene is static. `needsRender` ref gate would cut CPU ~50%. |
| m12 | Performance | `src/review_hub/routes/upload.py:25, 59` | `await file.read()` loads entire upload into RAM. Upload limit is 500 MB — no streaming. |
| m13 | Repetition | `src/review_hub/queries/{media,comments,favorites,drawings,sessions,references,assets}.py:7-13` | `_row_to_dict` + `_rows_to_list` defined identically in 6+ files. Belongs in `queries/_helpers.py`. |
| m14 | Semicolon inconsistency (new) | `frontend/src/components/console/ReviewTab.tsx` | File uses trailing semicolons; most of the frontend omits them. Cosmetic but visible style drift. |

---

## Design Strengths

- **Auto-discovery in `src/api.py:63-78`** — 16 LOC of `pkgutil.iter_modules` finds routers + plugins. Adding an endpoint = creating a file. The Review Hub's inability to use it (M3) is a specific inconsistency, not a broken design.
- **NodeShell (`frontend/src/nodes/_shared/NodeShell.tsx`, 314 LOC)** — deep module for all 21 nodes. Handle slots, rename, error boundary, cascade execution, footer cost, auto-update all behind a ~12-prop interface. Creating a new node is literally one folder.
- **`_call_with_gemini_retries` (`src/gemini.py:72-122`)** — handles 429/quota with provider-suggested `retryDelay` parsing + exponential fallback + retry-without-thinking. Returns `(result, usage)` tuple, deprecating a prior thread-unsafe global. Migration visible in the code.
- **Review Hub layering: `app → routes → queries → db`** — `aiosqlite.Connection` passed as parameter. `queries/media.py` is 109 LOC of pure SQL. Textbook depth.
- **Cascade execution (`frontend/src/utils/cascadeRun.ts`)** — global registry + topological walk of edges for Shift+Click. Every node inherits via NodeShell.
- **ErrorBoundary at two layers** — canvas-level in `FlowCanvas.tsx`, per-node in `NodeShell.tsx`. A node crash doesn't tear down the canvas.
- **PNG `tEXt` as single source of truth** for generation metadata. Scanner (`scanner.py:32-55`) re-populates DB from disk. No sidecar-vs-DB split.
- **Provider abstraction (`frontend/src/providers/index.ts`, 26 LOC)** — `Map<string, Provider>` + 4 functions. Side-effect imports auto-register. Small, deep, idiomatic.
- **Tactical hygiene exemplary** — 0 `TODO`/`FIXME`/`HACK`/`XXX`/`WORKAROUND` across 40k LOC (verified). 0 `except: pass` or bare `except:`. 6 weeks old.
- **480+ tests** (~12 per 1k LOC).
- **Comments explain *why*** (verified in multiple files):
  - `vertex_video_gen.py:98-102` cites EU/UK/CH/MENA `person_generation` regulation
  - `useGenerateImage.ts:157-161` explains why `imageB64` is cleared after `historyPreview` loads
  - `vertex_video_gen.py:81-83` states Gemini API duration constraint
  - `ProjectSwitcher.tsx:98-100` explains double-fire rename guard
  - `prompt.py:28-31` explains corrupt-JSON backup policy (matches CLAUDE.md rule 12)
- **`useSyncExternalStore` used correctly** for cascade state (React 18 idiom).
- **`AbortController` + `AbortSignal.timeout`** applied consistently in useEffect cleanups (verified in 8+ sites: `ReviewTab.tsx:126`, `DrawingCanvas.tsx:199, 215`, `useGenerateImage.ts:131, 141`, etc.).
- **WAL + foreign_keys ON** in `review_hub/db.py:15-16`.
- **SubnetNode extracts 4 pure functions** (`pinsEqual`, `computePinPatch`, `applyRename`, `toggleCollapsed`) for testability — pattern worth copying.
- **Corrupt-data handling in `prompt.py`** (lines 23-31, 74-82) — exactly follows CLAUDE.md rule 12: backup to `.corrupt`, reset, log. This is a tiny file but it demonstrates the rule is honored in practice.

---

## Recently Introduced Complexity

All findings fall within the 100-commit window. Week-by-week drift:

| Week | Findings added |
|------|-----------------|
| 2026-04-03 → 04-09 (setup) | M1 (bridge raw sqlite), M2 (snake_case SPA via `fae3be5`), M5 (DrawingCanvas window globals via `fae3be5`), M6 (transactional gaps), M4 seeds (CollageEditor, MediaBrowser) |
| 2026-04-10 → 04-12 (video stack) | C3 (video provider registry duplication via `29ed94a`), M11 (video.py / generate.py collision introduced at `57d8a54`) |
| 2026-04-13 → 04-17 (last 5 days) | **C2** (Veo `_snap_duration` via `9994c92`, 2026-04-17), **M3** (Review Hub manual router list accumulation — v1 flagged this), **M8** (useGenerateImage refs explosion, `7524a35`), **M9** (NB2Editor inline styles, `7524a35`), m14 (semicolon drift) |

**Pattern (unchanged from v1)**: every feature push in the last 2 weeks added
1-2 Critical/Major findings. Zero compensating refactor commits in the same
window. The most recent commit (`7524a35` "light-director + perf logger +
lightbox info panel + WIP") touched 18 files and introduced M8 + M9 + the
`cli.py` MODELS variant used by C3.

---

## Recommendations

Prioritized by impact / effort. Numbers 0–5 clear the two concrete debt
clusters and bring the grade to B.

| # | Action | Effort | Unblocks |
|---|--------|--------|----------|
| **0** | **Sanitize filenames in `upload.py`** — one line at `routes/upload.py:24, 58`: `dest = ... / _sanitize_filename(file.filename)`. Import from `src.shared`. | XS (5 min) | **Critical security fix (C1).** |
| 1 | Fix Veo `_snap_duration` UI/backend mismatch — snap in the frontend via `VIDEO_MODELS[veo].allowed_durations`, display effective value; or return HTTP 422 (not 400) when duration ∉ (4, 6, 8). | XS (15 min) | C2 |
| 2 | **Single source of truth for model registry** — `src/registry.py` with `@dataclass Model` per provider, serve via `GET /api/registry/models` consumed by frontend. All 13 sites collapse to one. | M (6–8h) | C3, M10, and all related drift |
| 3 | Wrap file + DB operations in a context manager — `folders.py:rename_folder`, `folders.py:move_media`, `media.py:delete_media`, `media.py:bulk_delete_media`, `upload.py:upload_reference`. Pattern: DB write first, filesystem op second, rollback the filesystem op on DB failure. | S (3h) | M6 — disk/DB drift across 5 endpoints |
| 4 | **Unify the 3 filename sanitization functions + 7 inline regex sites** — keep `_sanitize_filename` in `shared.py`; import everywhere; delete `_safe_name` in `folders.py`; replace all `re.sub(r"[^a-zA-Z0-9_\-]", "", ...)` inline calls in `bridge.py`/`bridge_assets.py`. | S (1h) | M12 — single sanitizer primitive |
| 5 | Move bridge `sqlite3.connect(...)` helpers into `review_hub/queries/bridge.py` — keep sync (for perf) but colocate schema. | S (2–3h) | M1 — schema knowledge in one module |
| 6 | Migrate `NB2Editor.tsx` to a CSS module — drop the 300+ inline styles, reconnect to design tokens. | M (3h) | M9 — stops inline-style drift |
| 7 | Extract `services/canvasExport.ts` from `CanvasContextMenu.tsx` — async file I/O handlers belong outside a menu. | M (3h) | M4 |
| 8 | Split `ConsolePanel.tsx` per tab — 5 components + `FeedbackPanel`. | M (3h) | M4 |
| 9 | Align Review Hub SPA naming to camelCase (codemod over `frontend/src/review/**`). | M (4h) | M2 — one frontend convention |
| 10 | Auto-discovery for Review Hub routes — replicate `api.py`'s `pkgutil.iter_modules` pattern in `review_hub/app.py`. 30-min edit. | XS (30 min) | M3 — coherence with parent |
| 11 | Rename `src/routers/video.py` → `src/routers/video_proc.py`. | XS (10 min) | M11 — resolves naming collision |
| 12 | Extract `src/review_hub/queries/_helpers.py` with `_row_to_dict`, `_rows_to_list`. | XS (10 min) | m13 |
| 13 | Gate `Viewport.tsx` RAF loop with a `needsRender` ref. | S (1h) | m11 — ~50% CPU reduction when NB2 editor is open |
| 14 | Stream media upload instead of `await file.read()`. | S (1h) | m12 — no 500 MB RAM allocation |
| 15 | Extract `useStateRef<T>` helper for the 7 mirror refs in `useGenerateImage.ts`. | XS (45 min) | M8 |
| 16 | Centralize `isBackendAvailable()` into `src/utils/runtime.ts`, import in `api.ts` and `ReviewTab.tsx`. | XS (5 min) | m2 |
| 17 | Split `MediaBrowser.tsx` — the 3-tab structure maps cleanly to 3 subcomponents + a container. | M (2h) | M4 |

**Estimated total to B (≥7.0)**: ~16h for recommendations 0–5. Full punch
list: ~34h (v1 estimated 32h — v2's extra 2h covers the new M6 endpoint and
the expanded M12 inline regex sites).

---

## Detailed Analysis — Selected Findings

### C1 — Path traversal in upload.py (verbatim code)

```python
# src/review_hub/routes/upload.py:21-26
@router.post("/upload/media")
async def upload_media(file: UploadFile = File(...)):
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.media_dir / file.filename   # ← unsanitized
    content = await file.read()
    dest.write_bytes(content)
```

Fix (one import + one call):

```python
from src.shared import _sanitize_filename
...
dest = settings.media_dir / _sanitize_filename(file.filename)
```

Note: `file.filename` cannot be `None` here because FastAPI's `UploadFile`
accepts it as required via `File(...)`, but `_sanitize_filename` already
handles `None` defensively — zero risk.

### C3 — Model registry duplication (the 13 sites, annotated)

| # | File | Symbol | Line | Notes |
|---|------|--------|------|-------|
| 1 | `src/shared.py` | `MODELS` | 83 | LLM (Gemini) text models |
| 2 | `src/shared.py` | `IMAGE_MODELS` | 89 | Image models (Gemini image) |
| 3 | `src/shared.py` | `MODEL_PRICING` | 95 | Token prices (input, output) for all models |
| 4 | `src/video_gen.py` | `MODELS` | 20 | PiAPI Kling + Seedance |
| 5 | `src/fal_video_gen.py` | `MODELS` | 19 | fal.ai Kling + Seedance |
| 6 | `src/atlas_video_gen.py` | `MODELS` | 19 | Atlas Seedance |
| 7 | `src/vertex_video_gen.py` | `MODELS` | 24 | Veo 3.1 |
| 8 | `src/cli.py` | `MODELS` | 22 | Short aliases for CLI (**v1 missed**) |
| 9 | `src/routers/image_edit.py` | `EDIT_MODELS` + hardcoded `0.067/0.02` | 38, 255 | |
| 10 | `frontend/src/providers/geminiProvider.ts` | `MODEL_MAP` + `GEMINI_IMAGE_COST` | 11, 40 | |
| 11 | `frontend/src/providers/fluxProvider.ts` | `BFL_MODELS` + `FLUX_PRICING` | 5, 70 | |
| 12 | `frontend/src/nodes/generate-image/useGenerateImage.ts` | `IMAGE_MODELS` | 16 | Includes `price: '$0.067'` for Gemini 3.1 flash image — matches `image_edit.py:255` |
| 13 | `frontend/src/nodes/generate-video/useGenerateVideo.ts` | `VIDEO_MODELS` | 27 | Mirrors backend MODELS of 4 providers |

Adding the hypothetical `Veo 3.2`:
1. `src/vertex_video_gen.py:24` — add to MODELS dict
2. `frontend/src/nodes/generate-video/useGenerateVideo.ts:27` — add to VIDEO_MODELS with renamed fields (backend `min_duration`/`max_duration`/`cost_per_sec`, frontend typically `minDuration`/`maxDuration`/`costPerSec`)
3. `src/shared.py:95 MODEL_PRICING` — potentially add (if billed by tokens)

### M4 — Overexposure in useGenerateImage (the return statement)

```typescript
// frontend/src/nodes/generate-image/useGenerateImage.ts:404-443
return {
  selectedModel, setSelectedModel,
  aspectRatio, setAspectRatio,
  resolution, setResolution,
  useGrounding, setUseGrounding,
  editMode, setEditMode,
  localPrompt, setLocalPrompt,
  imageB64,
  compareSourceUrl,
  loading, error, lastCost, activeMediaId,
  batchCount, setBatchCount, batchProgress,
  // History
  historyIds, historyIndex, setHistoryIndex,
  historyPreview, historyThumbs,
  historyExpanded, setHistoryExpanded,
  navigateHistory, userNavigatedRef,
  reviewStatuses,
  // Derived
  currentMediaId, modelInfo, hasPromptEdge, activePrompt,
  connectedImageCount, imageSlots, estimatedLabel,
  // Actions
  run, swapRefs, handleFavoriteToggle, openPreview,
  updateNodeData,
}
```

32 named returns. Every consumer must read this comment-delimited list.
Suggests `useGenerateImage()` is 3 hooks pretending to be one: config
state, generation action, and history navigation.

### M6 — Transactional gap (rename_folder, verbatim)

```python
# src/review_hub/routes/folders.py:67-104
@router.post("/folders/{name}/rename")
async def rename_folder(name: str, body: RenameFolderBody):
    ...
    src.rename(dst)                     # ← filesystem op first
    db = await get_db()
    try:
        ...
        for row in rows:                 # ← DB update second
            ...
            await db.execute("UPDATE media SET ...", ...)
        if rows:
            await db.commit()            # ← if this fails, folder
                                         #   is renamed on disk but
                                         #   DB still references the
                                         #   old path
    finally:
        await db.close()
```

Safer pattern:

```python
db = await get_db()
try:
    # 1. DB update first (inside a transaction)
    for row in ...:
        await db.execute("UPDATE media SET ...", ...)
    # 2. Filesystem op second
    src.rename(dst)
    # 3. Commit only if both succeeded
    await db.commit()
except Exception:
    # Rollback: rename back if filesystem op succeeded but commit failed
    if dst.exists() and not src.exists():
        dst.rename(src)
    raise
finally:
    await db.close()
```

---

## Appendix — Files Reviewed (v2, full list)

**Read in v2 (55+ files)**: all v1 files (45) + additions:

### Backend additions
- `src/cli.py` (229) — CLI entry, found 5th MODELS site
- `src/frames.py` (202) — OpenCV frame extraction, clean
- `src/routers/prompt.py` (138) — saves prompt history, corrupt-JSON handling exemplary
- `src/review_hub/routes/folders.py` (147) — M6 verification, `_safe_name` function
- `src/review_hub/routes/media.py` (180) — M6 verification, ADMIN_PIN hardcoded
- `src/review_hub/app.py` (142) — M3 verification (13 modules, not 14)

### Frontend additions
- `frontend/src/components/CollageEditor.tsx` (501) — god-component pattern
- `frontend/src/components/media/MediaBrowser.tsx` (462) — 3-tab shell
- `frontend/src/components/project/ProjectSwitcher.tsx` (345) — tasteful double-fire guard
- `frontend/src/components/console/ReviewTab.tsx` (346) — found m2 + m14
- `frontend/src/hooks/useActiveProject.ts` (379) — project lifecycle hook, deep
- `frontend/src/api.ts` (351) — 3 fetch wrappers (m7), isBackendAvailable (m2)

### Not re-analyzed from v1 (~275 files)

Same as v1: 20/29 node folders (spot-checked — NodeShell pattern holds), the
remaining 10/14 Review Hub routes, 4/11 queries modules, ~25 frontend
hooks/stores/utils, all 53 test files. The test subset was sanity-checked
via `find tests -name "test_*.py"` → 23 files; frontend vitest runs
cleanly.

---

## Comparison Table (v1 ↔ v2)

| Artifact | v1 | v2 |
|----------|----|----|
| Files read | 45 | 55+ |
| Critical findings | 3 | 3 (same set, deeper verification) |
| Major findings | 12 | 12 (same set, expanded evidence: M6 4→5 endpoints, M12 3+2 inline→3+7 inline, M8 6→7 refs, C3 10+→13 sites) |
| Minor findings | 12 | 14 (+m2 isBackendAvailable, +m14 semicolon drift) |
| Strengths | 13 bullets | 14 bullets (+prompt.py corrupt-JSON pattern) |
| Recommendations | 14 | 17 (+3 for new findings) |
| Weighted score | 6.06 | 5.91 |
| Grade | C+ | C |
| Est. time to B | 16h / 32h full | 16h / 34h full |

v2 does not contradict v1; it refines the counts and finds two minor
additions. v1 was directionally correct; v2 is evidentially tighter.
