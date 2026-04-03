# Review Hub Cleanup & Sidecar Removal

## Problem

The Review Hub has accumulated dead code, broken endpoints, and a redundant sidecar system. Three data paths exist for review status but only one works (the DB). The bridge proxies to a dead Express server on localhost:3002.

## Principle

One source of truth per data type:

| Data | Source of Truth |
|---|---|
| Generation metadata (prompt, model, cost) | PNG tEXt chunks |
| Review status (approved/rejected) | Review Hub SQLite DB |
| Favorites | Review Hub SQLite DB |
| Comments, drawings | Review Hub SQLite DB |

## Changes

### 1. Delete Dead Files

| File | Reason |
|---|---|
| `src/review_hub/sidecar.py` | `write_sidecar()` defined, never called |
| `frontend/src/review/components/AnnotationCanvas.tsx` | Never imported |
| `frontend/src/review/components/FolderManager.tsx` | Duplicates DirectorySidebar |
| `frontend/src/review/components/UserNameModal.tsx` | Duplicates NameModal |
| `frontend/src/review/hooks/useDrawing.ts` | DrawingCanvas uses inline logic |

### 2. Fix Broken Bridge Endpoints

**POST /api/bridge/favorite** (bridge.py)
- Current: proxies to `http://localhost:3002/api/favorites/toggle` (dead)
- Fix: call `queries.favorites.toggle_favorite()` directly via DB
- Remove: `httpx` import, `FavoriteToggle` model from shared.py

**GET /api/bridge/review/{stem}** (bridge.py)
- Current: reads `.review.json` files that are never written -> always returns `not_reviewed`
- Fix: query Review Hub DB by filename stem, return favorites + comments count
- Same response shape, frontend unchanged

**GET /api/bridge/review-status** (batch) (bridge.py)
- Current: batch-reads `.review.json` files, no frontend callers
- Action: delete entirely (dead endpoint)

### 3. Deduplicate _save_to_bridge()

- Defined in both `bridge.py:35-99` and `shared.py:246-299`
- Keep `shared.py` version (flexible key loop)
- `bridge.py` imports from `shared.py`
- Delete local copy

### 4. Add Missing Socket.io Emits

Backend never emits `drawing_save` and `feedback_new` but frontend listens.

- `src/review_hub/routes/drawings.py` POST handler: emit `drawing_save` after save
- `src/review_hub/routes/feedback.py` POST handler: emit `feedback_new` after insert

### 5. Clean Sidecar Residue from bridge.py

- Delete `_find_review_json()` helper
- `_delete_bridge_media()`: remove `.review.json` unlink
- `_scan_media_list()`: remove `.review.json` filter from file skip list
- Keep `_lookup_media_id()` (needed for favorite fix)

### 6. Remove Dead Code from Existing Files

- `src/review_hub/queries/favorites.py`: remove `get_status()` (never called)
- `src/shared.py`: remove `FavoriteToggle` model
- `frontend/src/review/services/api.ts`: remove 7 unused methods (`getMedia`, `getStats`, `getSubfolders`, `renameFolder`, `uploadMedia`, `streamUrl`, `listFolders`)

## Files Touched

| File | Action |
|---|---|
| `src/review_hub/sidecar.py` | DELETE |
| `src/review_hub/queries/favorites.py` | Remove `get_status()` |
| `src/review_hub/routes/drawings.py` | Add socket emit |
| `src/review_hub/routes/feedback.py` | Add socket emit |
| `src/routers/bridge.py` | Fix 2 endpoints, delete 1, deduplica, clean sidecar |
| `src/shared.py` | Remove `FavoriteToggle` |
| `frontend/src/review/services/api.ts` | Remove 7 dead methods |
| `frontend/src/review/hooks/useDrawing.ts` | DELETE |
| `frontend/src/review/components/AnnotationCanvas.tsx` | DELETE |
| `frontend/src/review/components/FolderManager.tsx` | DELETE |
| `frontend/src/review/components/UserNameModal.tsx` | DELETE |

## Non-Goals

- No frontend UI changes
- No new features
- No Review Hub smoke test (separate task)

## Constraints

- Same response shapes on all fixed endpoints (frontend unchanged)
- All DB access via existing `queries/` functions or minimal additions
- Tests must pass after each step
