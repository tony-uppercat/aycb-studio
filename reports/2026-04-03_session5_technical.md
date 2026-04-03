# AYCB v2 — Technical Report 2026-04-03 (Session 5)

## Summary
Review Hub audit (12 frontend bugs), backend test suite (10 → 98), FK guards on all write routes, silent failure cleanup, CLAUDE.md contradiction fixes, Socket.IO transport fix for LAN/iPad.

## Commits
- `9930a92` [fix] Review Hub audit — 12 frontend bugs
- `2fbc9e6` [test] Backend test suite — 98 tests, zero deprecation warnings
- `5f3f4b9` [docs] Session 5 reports
- (uncommitted) Silent failure cleanup, Socket.IO transport, CLAUDE.md fixes

## Bugs Fixed (17 total)

### Critical (from audit)
1. Lightbox props camelCase vs snake_case — close/navigate/refresh all broken
2. Download URL extra `/media/` segment — all downloads 404

### Important (from audit)
3. subfolders state never populated — sidebar always empty
4. null/dot directories in sidebar — broken row
5. AbortController signal never passed to fetch in CommentThread
6. ConsolePanel fetch patch always active + HMR chain risk
7. drawingToolStore.ts dead code (deleted)
8. Sidebar image fallback broken for subdirectory files

### Found by tests (not audit)
9. POST /favorites/toggle 500 on nonexistent media (FK violation)
10. POST /comments 500 on nonexistent media (FK violation)
11. POST /drawings 500 on nonexistent media (FK violation)
12. GET /drawings returns raw `null` instead of `{"drawing": null}`
13. 8 phantom users from server restarts (stale sessions)

### Infrastructure
14. `on_event("startup")` deprecation warnings — migrated to lifespan
15. pytest not auto-discovering tests — added testpaths config
16. Backend tab UI said "port 3001" instead of 5101
17. All `except: pass` replaced with `_log()` calls

### LAN/iPad
18. Socket.IO transport order `['websocket', 'polling']` → `['polling', 'websocket']` — polling-first avoids ECONNRESET through Vite proxy
19. LAN IP shown in Settings > Local tab via `/api/health`

## CLAUDE.md Contradictions Fixed
1. "Review Hub planned for Phase 2" — removed (already ported)
2. Architecture diagram — added Review Hub, Socket.IO, /api/rh/*
3. Directory structure — added src/review_hub/, frontend/src/review/, tests/
4. Rule 3 — added Review Hub routes path alongside plugins
5. `--amber` variable — renamed to `--accent` (it's pink, not amber)
6. "Commit after each task" — aligned with feedback memory (on request)
7. Testing command — `cd . && pytest` → `python -m pytest`
8. Added `_DB_PATH` inconsistency note
9. Added Rule 12: never `except: pass`

## Silent Failure Cleanup
Every `except: pass` in scanner.py, bridge.py, feedback.py, review.py, drawings.py, feedback routes now logs via `_log()`. Corrupt JSON files get backed up to `.json.corrupt` instead of silently returning empty.

## Test Suite
- Backend: 98 tests across 14 files
  - conftest.py (shared fixtures)
  - test_rh_routes.py (23 integration tests — admin pin, FK guards, CRUD)
  - test_shared_utils.py (13 pure function tests)
  - test_bridge_helpers.py (11 tests — scan, meta, delete)
  - test_router_review.py (9 CRUD tests)
  - test_router_feedback.py (7 tests)
  - test_save_to_bridge.py (5 tests)
  - test_review_hub_media_queries.py (5 tests — sort, filter, SQL injection)
  - test_review_hub_drawings.py (3 tests — save, upsert, empty)
  - test_thumbnails.py (3 tests)
  - test_sessions_clear.py (2 tests)
  - test_router_system.py (3 tests)
  - test_review_hub_db.py (2 existing)
  - test_review_hub_queries.py (8 existing + 1 new FK test)
  - test_review_hub_scanner.py (1 existing)
- Frontend: 115 tests across 23 files
- Total: 213 tests, 0 warnings

## Next Tasks
1. Restart backend to pick up all session changes
2. Browser smoke test Review Hub at /review (desktop + iPad)
3. Test real-time updates across devices (Socket.IO polling transport)
4. Migrate `db.py` `_DB_PATH` to use `settings.db_path`
