# AYCB v2 — Technical Report 2026-04-03 (Session 5)

## Summary
Review Hub smoke-test audit: found and fixed 12 bugs (2 critical, 6 important, 4 minor).

## Files Modified
- `frontend/src/review/pages/ReviewGallery.tsx` — Lightbox props camelCase→snake_case, added on_refresh, typed refs
- `frontend/src/review/services/api.ts` — download URL removed extra /media/ segment, get() accepts signal
- `frontend/src/review/components/CommentThread.tsx` — AbortController signal wired to fetch
- `frontend/src/review/components/ConsolePanel.tsx` — fetch patch scoped to is_open, HMR-safe cleanup
- `frontend/src/review/components/Sidebar.tsx` — image fallback uses directory for subdirectory files
- `frontend/src/review/hooks/useGalleryData.ts` — subfolders populated from flat dir list, null/dot filtered
- `frontend/src/review/ReviewApp.tsx` — removed duplicate STORAGE_KEY, reads from userStore
- `src/review_hub/queries/media.py` — get_directories filters NULL and "." rows
- `src/review_hub/app.py` — ping_check emits pong_check event instead of returning ack

## Files Deleted
- `frontend/src/review/stores/drawingToolStore.ts` — dead code, duplicates drawingStore.ts

## Bugs Fixed
| # | Severity | Issue |
|---|---|---|
| 1 | Critical | Lightbox props camelCase vs snake_case — close/navigate/refresh all broken |
| 2 | Critical | Download URL had extra /media/ segment — all downloads 404 |
| 3 | Important | subfolders state never populated — sidebar always empty |
| 4 | Important | get_directories returned NULL/"." rows — broken sidebar entry |
| 5 | Important | AbortController created but signal never passed to fetch |
| 6 | Important | ConsolePanel fetch patch always active, HMR chain risk |
| 7 | Important | drawingToolStore.ts dead code — never imported |
| 8 | Important | Sidebar image fallback broken for subdirectory files |
| 9 | Minor | STORAGE_KEY duplicated across ReviewApp and userStore |
| 10 | Minor | ping_check returned ack instead of emitting pong_check |
| 11 | Minor | No null filter on directory list from backend |
| 12 | Minor | refs state typed as any[] |

## Tests
- Frontend: 115 passing (23 files), all green
- Backend: no test files (need to create)

## Next Tasks
1. Browser smoke test Review Hub at /review with backend + frontend running
2. Test admin delete end-to-end
3. Test drawing + comments + real-time collaboration
4. Create backend test files (currently 0 collected)
