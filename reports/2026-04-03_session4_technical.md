# AYCB v2 — Technical Report 2026-04-03 (Session 4)

## Summary
Review Hub cleanup: sidecar removal, bridge endpoint fixes, admin auth, dead code purge.

## Files Deleted
- `src/review_hub/sidecar.py` — never-called write_sidecar()
- `frontend/src/review/components/AnnotationCanvas.tsx` — superseded by DrawingCanvas
- `frontend/src/review/components/FolderManager.tsx` — superseded by DirectorySidebar
- `frontend/src/review/components/UserNameModal.tsx` — superseded by NameModal
- `frontend/src/review/hooks/useDrawing.ts` — superseded by inline DrawingCanvas logic

## Files Modified
- `config/settings.py` — dotenv.set_key, removed GEMINISHOT compat, removed _env_with_fallback
- `src/routers/settings.py` — dotenv.set_key, removed hand-rolled _read_env/_write_env
- `src/routers/bridge.py` — review endpoint queries DB, favorite calls DB directly, dedup _save_to_bridge, removed sidecar residue, removed batch review-status endpoint
- `src/shared.py` — removed FavoriteToggle model
- `src/review_hub/routes/media.py` — admin pin auth on single+bulk delete, source file deletion
- `src/review_hub/routes/drawings.py` — socket emit drawing_save
- `src/review_hub/routes/feedback.py` — socket emit feedback_new
- `src/review_hub/routes/download.py` — BytesIO close via StreamingResponse background
- `src/review_hub/queries/favorites.py` — removed dead get_status()
- `src/api.py` — router log summary (12 lines → 1)
- `src/routers/generate.py` — stale "sidecar" comment
- `frontend/src/review/stores/userStore.ts` — pin-based admin auth, snake_case rename
- `frontend/src/review/services/api.ts` — X-Admin-Pin header, removed 7 dead methods
- `frontend/src/review/components/NameModal.tsx` — pin prompt for admin
- `frontend/src/review/components/Lightbox.tsx` — consolidated favorite callbacks, error details in toast
- `frontend/src/review/components/ConsolePanel.tsx` — fetch bind(window) fix
- `frontend/src/review/pages/ReviewGallery.tsx` — snake_case, error details
- `frontend/src/review/styles/review.css` — pin modal styles
- `frontend/src/review/ReviewApp.tsx` — snake_case rename
- `frontend/src/review/components/{CommentThread,DrawingCanvas,Sidebar}.tsx` — snake_case rename
- `pyproject.toml` — pytest-asyncio>=1.3, pytest>=8.0 bounds
- `Desktop/AYCB Studio.bat` — kill old instances, Windows Terminal tabs

## Tests
- Backend: 10 passing
- Frontend: 115 passing (23 files), TSC clean

## Known Issues
- AYCB Studio.bat Windows Terminal launch needs testing
- Review Hub not smoke-tested in browser yet
- Admin delete untested end-to-end (backend was down during session)

## Architecture Decisions
- Single source of truth: PNG tEXt for generation metadata, Review Hub DB for review data
- Admin auth via pin header (X-Admin-Pin) instead of username-based check
- Pin constant centralized: ADMIN_PIN in userStore.ts and media.py
- Socket emits outside try/finally to avoid swallowing return values

## Next Tasks
1. Smoke test Review Hub at /review
2. Test admin delete end-to-end
3. Test drawing + comments + real-time
4. Polish visual issues found during testing
