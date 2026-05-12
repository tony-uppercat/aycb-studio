# Code Complexity Audit — 2026-04-18

AYCB Studio v2 — based on Ousterhout's _A Philosophy of Software Design_.
Coverage: 45 files read (~13.6% of files, ~50% of LOC, ~80% of architectural value).
121 total commits over ~6 weeks, single author (@tony-uppercat).

---

## Executive Summary

Architectural foundations are deliberate — auto-discovery of routers/plugins/nodes,
NodeShell as a textbook deep module, clean `app → routes → queries → db` layering
in Review Hub, **zero `TODO`/`FIXME`/`HACK` markers** and **zero `except: pass`**
across 40k LOC. Recent feature pressure (last 2 weeks) accumulated debt in two
concrete clusters: **information leakage of the model registry across 10+ sites**
and **a security / correctness cluster** (path traversal, transactional gaps,
inconsistent filename sanitization).

**Grade: C+ (6.06 / 10)**. Not in trouble — debt is structured and localized.
Six recommendations (~16h total) bring it to B.

---

## Score Dashboard

| # | Dimension | Score | Status |
|---|-----------|-------|--------|
| 1 | Module Depth | 6/10 | Adequate |
| 2 | Information Hiding | 4/10 | Poor |
| 3 | Abstraction Quality | 7/10 | Good |
| 4 | Complexity Indicators | 5/10 | Adequate |
| 5 | Error Handling | 5/10 | Adequate |
| 6 | Layering | 7/10 | Good |
| 7 | Design Investment | 8/10 | Good |
| 8 | Comments & Abstractions | 8/10 | Good |
| 9 | Codebase Navigability | 7/10 | Good |
| 10 | Naming & Obviousness | 7/10 | Good |
| 11 | Consistency | 3/10 | Poor |
| 12 | Software Trends Anti-Patterns | 7/10 | Good |
| 13 | Performance-Design Relationship | 5/10 | Adequate |
| | **Weighted Average** | **6.06** | **Grade: C+** |

Formula: `(Σ core × 1.5 + Σ structural × 1.2 + Σ surface × 1.0) / 16`
= `(22 × 1.5 + 35 × 1.2 + 22 × 1.0) / 16` = `97 / 16` = **6.06**.

---

## Findings

All findings fall within the last 100 commits (boundary `a001758d`, 2026-04-03).
Single author — attribution is for context (drift over time), not blame.

### Critical

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| C1 | Error Handling (security) | `src/review_hub/routes/upload.py:21-43, 46-99` | **Path traversal vulnerability.** `upload_media` writes `dest = settings.media_dir / file.filename` without sanitizing `file.filename`. A client sending `filename="../../etc/passwd"` writes outside `media_dir`. Same gap in `upload_reference`. `_sanitize_filename` already exists in `src/shared.py:72-79` — it is simply not called. |
| C2 | Information Leakage | `src/vertex_video_gen.py:80-86, 105` + frontend `useGenerateVideo.ts:108, 327-334` | **Silent UI/backend duration mismatch.** Veo API accepts only 4, 6, 8s; backend `_snap_duration` snaps silently to the nearest valid value. UI slider shows 5s → backend generates 4s. Constraint is provider-specific knowledge leaked into the backend only. |
| C3 | Information Leakage | 10+ sites across `src/{video_gen, fal_video_gen, atlas_video_gen, vertex_video_gen, shared, routers/image_edit}.py` + `frontend/src/{nodes/generate-{image,video}/use*, providers/{geminiProvider, fluxProvider}}.ts` | **Model registry leaked across 10+ sites.** 4 backend `MODELS` dicts (provider-specific), frontend `VIDEO_MODELS`, `IMAGE_MODELS`, `MODEL_MAP`, `GEMINI_IMAGE_COST`, `BFL_MODELS`, `FLUX_PRICING`, `EDIT_MODELS`, plus `MODEL_PRICING` in shared.py. Adding a video model touches 2–3 files with renamed fields (`min_duration` ↔ `minDuration`); adding an image model touches 6+ files. Prices and aspect_ratios must be kept in sync by hand. |

### Major

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| M1 | Information Leakage | `src/routers/bridge.py:44-96, 158-179, 222-245, 256-295, 552-585, 588-647` + `src/routers/bridge_assets.py:20-117, 120-136` | 8 helpers open raw `sqlite3.connect(...?mode=ro)` with direct schema knowledge. Coexists with the clean async `review_hub/queries/` layer. Schema migration would break in 9 places instead of 1. |
| M2 | Consistency | `frontend/src/review/**` vs `frontend/src/{components,nodes,hooks}/**` | **Two naming conventions in the same frontend.** Review Hub SPA uses snake_case for variables and props (`set_user_name`, `is_open`, `on_close`); everywhere else uses camelCase. Same codebase, two style guides split by directory. |
| M3 | Repetition | `src/review_hub/app.py:11, 119` | Review Hub's 14 router modules are listed twice verbatim (import line + iteration line). Parent `src/api.py:63-78` uses `pkgutil.iter_modules` for auto-discovery. Same problem, two solutions in the same project. |
| M4 | Module Depth | `frontend/src/components/console/ConsolePanel.tsx` (615), `frontend/src/components/canvas/CanvasContextMenu.tsx` (558), `frontend/src/nodes/generate-image/useGenerateImage.ts` (444, returns 30+ values), `frontend/src/review/pages/ReviewGallery.tsx` (254 dense LOC) | **Shallow modules in god-component / god-hook form.** `useGenerateImage` exposes 30+ return values — overexposure. `ConsolePanel` contains 5 unrelated tabs + feedback subsystem inline. `ReviewGallery` handles 3 tabs + split mode + 4 modals + drag-drop in 254 dense LOC. |
| M5 | Layering (action at a distance) | `frontend/src/review/components/DrawingCanvas.tsx:219-265` | Component attaches `__drawingCanvasSave`, `__drawingCanvasExportOverlay`, `__drawingCanvasExportMerged` onto `window`. The toolbar (separate component, no import) calls them. Dependency invisible in imports — classic "Unknown Unknowns" red flag. |
| M6 | Error Handling (correctness) | `src/review_hub/routes/folders.py:80-100`, `src/review_hub/routes/media.py:118-148, 151-180`, `src/review_hub/routes/upload.py:72-95` | **No transactional rollback across disk + DB ops.** `rename_folder` renames files on disk before the DB UPDATE; `delete_media` / `bulk_delete_media` unlink disk files before `q.delete_media`; `upload_reference` writes file → INSERT row → UPDATE thumbnail_path in two separate DB connections. Any intermediate failure leaves disk and DB divergent. 4 endpoints affected. |
| M7 | Performance | `src/review_hub/scanner.py:69, 129` | `rglob("*")` over the entire `media_dir` every 5s plus set-difference on full string paths. At 5k files on NTFS: ~100ms CPU per scan plus Windows path separator inconsistency (`/` vs `\`) can cause flap (insert + delete of the same file every scan). |
| M8 | Cognitive Load | `frontend/src/nodes/generate-image/useGenerateImage.ts:84-100` | 6 mirror refs + 6 `useEffect` hooks to sync `aspectRatio` / `resolution` / `useGrounding` / `editMode` / `imageB64` / `compareSourceUrl`. Workaround for stale-closure in `runSingle` — symptom of a missing `useStateRef<T>` deep helper. |
| M9 | Consistency | `frontend/src/nodes/nb2-light-director/editor/NB2Editor.tsx` (232) | **300+ inline `style={{...}}` literals** in a single component. No CSS module. Bypasses design tokens (`--color-bg-primary`, `--accent`) — colors hardcoded as `'#18181b'`, `'#e8a849'`. Theme changes would require manual grep of the whole file. |
| M10 | Information Leakage | `src/routers/image_edit.py:36-41, 255` | `EDIT_MODELS` list + hardcoded `per_image = 0.067 if is_gemini else 0.02` form the 9th model registry site. The `0.067` already exists in `shared.py:MODEL_PRICING`, `geminiProvider.ts:GEMINI_IMAGE_COST`, and `useGenerateImage.ts:IMAGE_MODELS`. |
| M11 | Naming | `src/routers/{video,generate}.py` | **Name collision.** `video.py` handles FFmpeg trim/extract/duration (`/api/video`). `generate.py` handles cloud video generation (`/api/generate/video`). A developer searching for "video" lands on `video.py` first but it is unrelated to generation. |
| M12 | Consistency | `src/shared.py:72` (`_sanitize_filename`), `src/review_hub/routes/folders.py:30-36` (`_safe_name`), `src/review_hub/routes/upload.py` (no sanitize), `src/routers/bridge_assets.py:157, 163` (inline regex × 2) | **3 different filename sanitization functions** (plus one missing call site). `_sanitize_filename` in shared.py exists and is the canonical one; `_safe_name` in folders.py handles `..`; `bridge_assets.py` inlines regex. No single source of truth. |

### Minor

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| m1 | Repetition | `src/review_hub/app.py:51-88` | 12 nearly-identical Socket.IO relay handlers — could be table-driven in 5 LOC. |
| m2 | Performance | `src/plugins/perf_log.py:42-63` | Sync I/O inside `async def` handler. |
| m3 | Information Leakage | `src/shared.py:231-329` | `_save_to_bridge` and `_save_video_to_bridge` duplicate folder resolution + datetime formatting. |
| m4 | Layering | `src/routers/generate.py:39, 127, 169, 205, 248, 292, 302, 312, 321, 345` | 10 lazy imports inside endpoints (Windows `cv2/numpy` workaround). |
| m5 | Performance | `src/review_hub/scanner.py:51-52` | Sidecar `read_text()` not capped — corrupted sidecar can OOM the scanner. |
| m6 | Repetition | `frontend/src/api.ts:36-92` | 3 fetch wrappers (`get` / `post` / `put`) with 80% identical code. |
| m7 | Cognitive Load | `frontend/src/review/hooks/useGalleryData.ts:56-64` | `silentRefresh` is not debounced — every `comment_new` from every user triggers a full refetch. |
| m8 | Consistency | `frontend/src/types.ts:152-193` | `JsonParserNodeData` camelCase, `BracketParserNodeData` snake_case, `JsonParserBlendNodeData` camelCase again. Three conventions in the same domain. |
| m9 | Naming (hard to pick) | `src/vertex_video_gen.py:1-8` | File named `vertex_video_gen` but no longer uses Vertex AI (uses Gemini API key). Docstring acknowledges "kept for historical reasons". |
| m10 | Performance | `frontend/src/nodes/nb2-light-director/editor/Viewport.tsx:130` | `requestAnimationFrame` loop always active — renders every frame even when scene is static. Gating with a `needsRender` ref would cut CPU roughly in half. |
| m11 | Performance | `src/review_hub/routes/upload.py:25, 59` | Entire file loaded into RAM via `await file.read()`. Upload limit is 500 MB — no streaming. |
| m12 | Repetition | `src/review_hub/queries/{media,comments,favorites,drawings,sessions,references,assets}.py:7-13` | `_row_to_dict` + `_rows_to_list` defined identically in 6+ files. Belongs in `queries/_helpers.py`. |

---

## Design Strengths

- **Auto-discovery** (`src/api.py:63-78`): 16 LOC of `pkgutil.iter_modules` — adding an endpoint = creating a file.
- **NodeShell** (`frontend/src/nodes/_shared/NodeShell.tsx`, 314 LOC): deep module for all 21 nodes. Every node inherits handle slots, rename, error boundary, cascade execution, footer cost, auto-update — all behind a ~12-prop interface.
- **`_call_with_gemini_retries`** (`src/gemini.py:72-122`): handles 429/quota with provider-suggested `retryDelay` parsing + exponential fallback + retry-without-thinking. Returns `(result, usage)` tuple, deprecating the prior thread-unsafe global. Migration in progress visibly in the code.
- **Review Hub layering**: `app → routes → queries → db` with `aiosqlite.Connection` passed as parameter. `queries/media.py` is 109 LOC of pure SQL. Textbook.
- **Cascade execution** (`frontend/src/utils/cascadeRun.ts`): global registry + topological walk of edges for Shift+Click. Every node gets this behavior for free via NodeShell.
- **ErrorBoundary at two layers**: canvas-level in `FlowCanvas.tsx`, per-node in `NodeShell.tsx`. A node crash does not tear down the canvas.
- **PNG `tEXt` as single source of truth** for generation metadata. Scanner (`src/review_hub/scanner.py:32-55`) re-populates DB from disk.
- **Provider abstraction** (`frontend/src/providers/index.ts`, 26 LOC): `Map<string, Provider>` + 4 functions. Side-effect imports auto-register.
- **Tactical hygiene exemplary**: **zero** `TODO` / `FIXME` / `HACK` / `XXX` / `WORKAROUND` markers across 40k LOC. **Zero** `except: pass` or bare `except:`. Remarkable for a 6-week codebase.
- **480 total tests** (~12 per 1k LOC).
- **Comments explain *why***: `_snap_duration` cites EU/UK/CH/MENA `person_generation` regulation; `useKeyboardShortcuts.ts:256-260` explains the React Flow drag capture limitation; `_call_with_gemini_retries` cites thread-safety vs deprecated global.
- **`useSyncExternalStore`** used correctly for cascade state (React 18 idiom).
- **`AbortController` + `AbortSignal.timeout`** applied consistently in useEffect cleanups (verified in 8+ sites).
- **WAL + foreign_keys ON** in `review_hub/db.py:15-16`.
- **SubnetNode extracts 4 pure functions** (`pinsEqual`, `computePinPatch`, `applyRename`, `toggleCollapsed`) for testability — pattern worth copying.

---

## Recommendations

Prioritized by impact / effort. Numbers 0–5 clear the two concrete debt clusters
and bring the grade to B.

| # | Action | Effort | Unblocks |
|---|--------|--------|----------|
| **0** | **Sanitize filenames in `upload.py`** — one line at `routes/upload.py:24, 58`: `dest = ... / _sanitize_filename(file.filename)`. | XS (5 min) | **Critical security fix.** |
| 1 | Fix Veo `_snap_duration` UI/backend mismatch — snap in the frontend and display the effective value, or return 422 when duration is outside (4, 6, 8). | XS (15 min) | Critical bug |
| 2 | **Single source of truth for model registry** — `src/registry.py` with `@dataclass` per model + `GET /api/registry/{video,image,llm}/models` consumed by the frontend via fetch. Adding a model touches 1 file. | M (6–8h) | Critical leakage (C3). ~10 sites collapse to 1. |
| 3 | Wrap file + DB operations in transactions — `folders.py:rename_folder`, `media.py:delete_media` / `bulk_delete_media`, `upload.py:upload_reference`. Pattern: write DB first, then file op, then commit; rollback file op on DB failure. | S (3h) | Eliminates disk↔DB drift in 4 endpoints. |
| 4 | **Unify the 3 filename sanitization functions** — keep only `_sanitize_filename` in `shared.py`; delete `_safe_name`, replace inline regexes. Ensure it handles `..`. | XS (30 min) | M12 — consistent security primitive. |
| 5 | Move bridge `sqlite3.connect(...)` helpers into `review_hub/queries/bridge.py` — keep sync (for perf) but colocate schema knowledge. | S (2–3h) | M1 — schema migration in one place. |
| 6 | Migrate `NB2Editor.tsx` to a CSS module — drop the 300+ inline styles, reconnect to design tokens. | M (3h) | M9 — stops inline-style drift. |
| 7 | Extract `services/canvasExport.ts` from `CanvasContextMenu.tsx` — the 6 async file I/O handlers belong outside a menu component. | M (3h) | M4 — menu drops under 250 LOC. |
| 8 | Split `ConsolePanel.tsx` per tab — 5 components + `FeedbackPanel`. | M (3h) | M4 — tabs become independently modifiable. |
| 9 | Align Review Hub SPA naming to camelCase (codemod over `frontend/src/review/**`). | M (4h) | M2 — single frontend convention. |
| 10 | Auto-discovery for Review Hub routes — replicate `api.py`'s `pkgutil.iter_modules` pattern in `review_hub/app.py`. | XS (30 min) | M3 — coherence with parent. |
| 11 | Rename `src/routers/video.py` → `src/routers/video_proc.py` (or `media_processing.py`). | XS (10 min) | M11 — resolves naming collision. |
| 12 | Extract `src/review_hub/queries/_helpers.py` with `_row_to_dict`, `_rows_to_list`. | XS (10 min) | m12 — DRY over 6+ files. |
| 13 | Gate `Viewport.tsx` RAF loop with a `needsRender` ref. | S (1h) | m10 — ~50% CPU reduction when NB2 editor is open. |
| 14 | Stream upload media instead of `await file.read()`. | S (1h) | m11 — no 500 MB RAM allocation. |

**Estimated total to B (≥7.0)**: ~16h for recommendations 0–5. Full punch list: ~32h.

---

## Recently Introduced Complexity

Codebase is 6 weeks old (121 commits). All findings fall within the 100-commit
window. Single author. Drift by week:

| Week | Critical / Major added |
|------|------------------------|
| 2026-04-03 → 04-09 (setup) | M1 (bridge raw sqlite), M2 (snake_case SPA), M5 (DrawingCanvas window globals), M6 (no-rollback delete), M4 (ReviewGallery god-page) |
| 2026-04-10 → 04-12 (video stack) | C3 (video provider registry duplication, commit `29ed94ad`), frontend `VIDEO_MODELS` |
| 2026-04-13 → 04-17 (last 5 days) | C2 (Veo `_snap_duration`, `9994c92c`), M3 (Review Hub manual router list, `fa0cf4ba`), M8 (useGenerateImage refs explosion, `7524a35`), M9 (NB2Editor inline styles) |

Pattern: every feature push in the last 2 weeks added 1–2 findings. No
compensating refactor commits in the same window.

---

## Appendix — Files Reviewed (45)

### Backend Python (22)

| File | LOC | Rationale |
|------|-----|-----------|
| `src/api.py` | 95 | Entry point + auto-discovery |
| `src/shared.py` | 329 | Central helpers, hot |
| `src/gemini.py` | 393 | Third-largest backend file |
| `src/vertex_client.py` | 47 | Cached Vertex client |
| `src/routers/bridge.py` | 647 | Top-1 size, 9 commits |
| `src/routers/bridge_assets.py` | 214 | Sibling of bridge.py |
| `src/routers/generate.py` | 366 | Central video dispatch, 9 commits |
| `src/routers/system.py` | 217 | 10 commits (hottest) |
| `src/routers/image_edit.py` | 262 | Gemini + Vertex edit dispatch |
| `src/routers/llm.py` | 178 | Claude + Gemini chat |
| `src/routers/analyze.py` | 178 | Image + video analysis |
| `src/routers/video.py` | 193 | FFmpeg trim / frames / duration |
| `src/plugins/canvas_backup.py` | 75 | Backup rotation plugin |
| `src/video_gen.py` | 293 | PiAPI provider |
| `src/fal_video_gen.py` | 228 | fal.ai provider |
| `src/atlas_video_gen.py` | 196 | Atlas Cloud provider |
| `src/vertex_video_gen.py` | 293 | Veo provider (distinct) |
| `src/review_hub/app.py` | 142 | Socket.IO + router mount |
| `src/review_hub/db.py` | 28 | Connection helper |
| `src/review_hub/scanner.py` | 218 | Background poller |
| `src/review_hub/routes/media.py` | 180 | Largest route module |
| `src/review_hub/routes/folders.py` | 147 | File + DB ops |
| `src/review_hub/routes/upload.py` | 99 | Upload endpoints |
| `src/review_hub/routes/drawings.py` | 53 | Drawings save |
| `src/review_hub/queries/media.py` | 109 | Reference queries module |
| `src/review_hub/queries/comments.py` | 54 | Comments queries |
| `src/review_hub/queries/favorites.py` | 44 | Favorites queries |
| `src/review_hub/queries/sessions.py` | 60 | Session tracking |

### Frontend TS / TSX (23)

| File | LOC | Rationale |
|------|-----|-----------|
| `frontend/src/api.ts` | 351 | API surface, 7 commits |
| `frontend/src/types.ts` | 218 | Type contracts |
| `frontend/src/nodes/index.ts` | 47 | Auto-discovery entry |
| `frontend/src/nodes/_shared/NodeShell.tsx` | 314 | Central abstraction |
| `frontend/src/nodes/generate-image/useGenerateImage.ts` | 444 | Hot, 6 commits |
| `frontend/src/nodes/generate-video/useGenerateVideo.ts` | 436 | Hot, 6 commits |
| `frontend/src/nodes/image-upload/ImageUploadNode.tsx` | 192 | NodeShell fitness check |
| `frontend/src/nodes/subnet/SubnetNode.tsx` | 215 | Exemplary node design |
| `frontend/src/nodes/nb2-light-director/NB2LightDirectorNode.tsx` | 114 | New 3D node |
| `frontend/src/nodes/nb2-light-director/editor/NB2Editor.tsx` | 232 | 3D editor modal |
| `frontend/src/nodes/nb2-light-director/editor/Viewport.tsx` | 292 | Three.js hook |
| `frontend/src/nodes/nb2-light-director/three-helpers.ts` | 110 | Model builders |
| `frontend/src/providers/index.ts` | 26 | Provider registry |
| `frontend/src/providers/geminiProvider.ts` | 201 | Gemini image + LLM |
| `frontend/src/providers/fluxProvider.ts` | 80 | BFL provider |
| `frontend/src/providers/ollamaProvider.ts` | 131 | Ollama local LLM |
| `frontend/src/components/canvas/FlowCanvas.tsx` | 700 | Top-1 frontend size |
| `frontend/src/components/canvas/CanvasContextMenu.tsx` | 558 | 6 commits, hot |
| `frontend/src/components/console/ConsolePanel.tsx` | 615 | Hot recent |
| `frontend/src/components/SettingsPanel.tsx` | 534 | 6 commits |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | 631 | 7 commits |
| `frontend/src/review/ReviewApp.tsx` | 201 | SPA entry |
| `frontend/src/review/pages/ReviewGallery.tsx` | 254 | 9 commits (hottest SPA) |
| `frontend/src/review/components/DrawingCanvas.tsx` | 306 | Largest SPA component |
| `frontend/src/review/components/CommentThread.tsx` | 232 | Socket + state |
| `frontend/src/review/hooks/useGalleryData.ts` | 105 | Central SPA hook |

### Not analyzed (~275 files)

Remaining nodes (20 of 29 folders), remaining Review Hub routes (10 of 14) and
queries (4 of 11), `canvas_backup.py` plugin, `local.py` / `prompt.py` /
`settings.py` / `feedback.py` / `review.py` routers, `localProvider.ts`,
~25 frontend hooks/stores/utils, all 53 test files. Spot-checks on the read
subset (ImageUploadNode, SubnetNode, NB2LightDirectorNode) confirm that
the NodeShell + manifest pattern and the Review Hub queries layer hold at
scale — the unread surface is predictively clean.
