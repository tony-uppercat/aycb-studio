# AYCB v2 — Technical Report 2026-04-03 (Session 5)

## Summary
Review Hub audit (12 bugs fixed), backend test suite built from scratch (10 → 98 tests), multiple runtime bugs caught by new tests.

## Commits
- `9930a92` [fix] Review Hub audit — 12 bugs fixed
- `df4a6d8` [docs] Session 5 reports — Review Hub audit fixes
- `2fbc9e6` [test] Backend test suite — 98 tests, zero warnings

## Files Created
- `tests/conftest.py` — shared tmp_db fixture, _run helper
- `tests/test_shared_utils.py` — _sanitize_filename, _safe_video_suffix, _classify_error, _estimate_cost, _require_prompt
- `tests/test_bridge_helpers.py` — _ext_to_mime, _scan_media_list, _find_png_meta, _delete_bridge_media
- `tests/test_save_to_bridge.py` — _save_to_bridge with bytes, PIL, sanitization
- `tests/test_thumbnails.py` — generate_thumbnail, get_image_dimensions
- `tests/test_router_system.py` — health, logs, clear_logs via TestClient
- `tests/test_router_review.py` — full CRUD: add, batch, update, delete, clear, carry-over
- `tests/test_router_feedback.py` — feedback CRUD, urgent, resolve, console notify
- `tests/test_sessions_clear.py` — clear_stale_sessions on startup
- `tests/test_review_hub_drawings.py` — save, upsert, get nonexistent
- `tests/test_review_hub_media_queries.py` — directory filter, sort/order, SQL injection guard, null filter, stats
- `tests/test_rh_routes.py` — 23 integration tests: media CRUD, admin pin auth, favorites, comments, drawings

## Files Modified
- `src/api.py` — on_event("startup") → lifespan context manager
- `src/review_hub/app.py` — rh_startup() extracted, called from lifespan
- `src/review_hub/queries/sessions.py` — added clear_stale_sessions()
- `src/review_hub/routes/favorites.py` — check media exists before FK insert
- `src/review_hub/routes/comments.py` — check media exists before FK insert
- `src/review_hub/routes/drawings.py` — check media exists, return envelope not raw null
- `src/routers/system.py` — local_ip in health response
- `frontend/src/components/SettingsPanel.tsx` — LAN IP in Local tab, port 3001→5101
- `frontend/src/review/components/DrawingCanvas.tsx` — unwrap drawing envelope
- `pyproject.toml` — testpaths, asyncio_mode config

## Bugs Found and Fixed
| # | Source | Issue |
|---|---|---|
| 1 | Audit | Lightbox props camelCase vs snake_case — completely broken |
| 2 | Audit | Download URL extra /media/ segment — all 404 |
| 3 | Audit | subfolders never populated |
| 4 | Audit | null/dot directories in sidebar |
| 5 | Audit | AbortController signal never passed |
| 6 | Audit | ConsolePanel fetch patch always active |
| 7 | Audit | drawingToolStore.ts dead code |
| 8 | Audit | Sidebar image fallback wrong for subdirs |
| 9 | Audit | STORAGE_KEY duplicated |
| 10 | Audit | ping_check ack vs emit |
| 11 | Live 500 | Favorites toggle on nonexistent media — FK violation |
| 12 | Live 500 | Comments add on nonexistent media — FK violation |
| 13 | Live 500 | Drawings save on nonexistent media — FK violation |
| 14 | Live null | GET /drawings returns raw null — frontend breaks |
| 15 | Deprecation | on_event("startup") warnings in test output |
| 16 | Stale | 8 phantom users from server restarts |
| 17 | Stale | Backend tab says port 3001 instead of 5101 |

## Tests
- Backend: 98 passing (14 test files)
- Frontend: 115 passing (23 test files)
- Total: 213 passing, 0 warnings

## Next Tasks
1. Restart backend to pick up all changes (lifespan, LAN IP, FK guards)
2. Browser smoke test Review Hub at /review
3. Test admin delete, drawing, comments end-to-end
