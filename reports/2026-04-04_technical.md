# AYCB v2 — Technical Report 2026-04-04

## Summary
Full feedback rule audit + enforcement session. 35 violations fixed across 22 files using 7 parallel Opus agents. Critical drawing canvas TDZ crash found and fixed.

## Files Changed
- Modified: 23 files (11 frontend, 12 backend)
- Created: 2 report files

### Backend (12 files)
- `src/cli.py` — 2 write_text newline fixes
- `src/gemini.py` — 3 bare except fixes (added console.print logging)
- `src/local_gen.py` — 2 bare except fixes (ImportError → logger.debug)
- `src/routers/bridge.py` — 1 bare except fix (cost_usd parse → _log)
- `src/routers/feedback.py` — 3 write_text newline fixes
- `src/routers/local.py` — 2 bare except fixes (ImportError → _log)
- `src/routers/prompt.py` — 2 write_text + 2 bare except fixes (.corrupt backup pattern)
- `src/routers/review.py` — 1 write_text newline fix
- `src/routers/system.py` — 1 write_text newline fix
- `src/review_hub/routes/media.py` — 1 bare except fix (logger.debug)
- `CLAUDE.md` — 4 accuracy fixes (plugins empty, utils dir, hooks listing, storage desc)

### Frontend (11 files)
- `frontend/src/review/components/DrawingCanvas.tsx` — **TDZ crash fix** (useRef before const declaration), right-click disabled
- `frontend/src/review/styles/review.css` — 60 lines dead CSS removed, layout hardened
- `frontend/src/review/services/api.ts` — signal param added to 6 API functions
- `frontend/src/review/hooks/useGalleryData.ts` — AbortController added
- `frontend/src/review/components/Sidebar.tsx` — AbortController added
- `frontend/src/review/components/ConsolePanel.tsx` — 2 AbortController fixes
- `frontend/src/review/pages/ReviewGallery.tsx` — AbortController added
- `frontend/src/components/Header.tsx` — AbortController replaces AbortSignal.timeout
- `frontend/src/components/SettingsPanel.tsx` — AbortController added
- `frontend/src/components/ReferencesTab.tsx` — AbortController replaces cancelled flag
- `frontend/src/components/console/ReviewTab.tsx` — AbortController added to fetchItems
- `frontend/src/components/media/FullscreenMediaBrowser.tsx` — AbortController replaces dead flag

## Bugs Fixed (36)
- 11 bare except:pass violations (Python)
- 9 write_text missing newline="\n" (Python)
- 11 missing AbortController in useEffect (Frontend)
- 4 CLAUDE.md inaccuracies
- 1 DrawingCanvas TDZ crash (critical — entire UI crashed on pencil click)

## Tests
- Backend: 98 passed
- Frontend: 115 passed (23 test files)
- Total: 213, all green

## Lessons Learned
- **TDZ in useRef:** `const ref = useRef(laterVar)` before `const laterVar = useCallback(...)` crashes silently — no error boundary, entire component tree unmounts. Initialize refs with no-ops when the target function is declared later.
- **Dead CSS cascade:** Stale duplicate CSS rules (old lightbox layout) were silently cascading `align-items: center` onto the new column flex layout. Always remove dead CSS — cascade effects are invisible.

## Known Issues
- Review Hub frontend still has zero test files (backend routes covered)
- iPad drawing real-time depends on WebSocket upgrade (needs backend restart)

## Next Tasks
1. Restart backend via bat (loads all session changes)
2. Verify iPad real-time drawing after restart
3. Trashcan feature (30-day recycle bin)
