# AYCB v2 — Technical Report 2026-04-03

## Session 1-2 Summary
Phase 2 node porting complete + Review Hub v2 fully implemented.

### Created — Phase 2 Nodes (61 files)
- `frontend/src/nodes/{15 node folders}/` — each with manifest, component, test
- `frontend/src/nodes/generate-image/useGenerateImage.ts` — split from 570-line component
- `frontend/src/nodes/json-parser/useJsonParser.ts` — split from 585-line component
- `skills/aycb-workflow/SKILL.md`, `skills/aycb-node-creator/SKILL.md`

### Created — Review Hub Backend (22 files)
- `src/review_hub/schema.sql` — 7 tables, FK cascade, indexes
- `src/review_hub/db.py` — aiosqlite connection + init
- `src/review_hub/queries/{media,comments,favorites,drawings,references,feedback,sessions}.py`
- `src/review_hub/routes/{media,comments,favorites,drawings,references,upload,download,folders,feedback,logs}.py`
- `src/review_hub/app.py` — Socket.io server + mount_review_hub()
- `src/review_hub/scanner.py` — 5s polling + thumbnail generation
- `src/review_hub/thumbnails.py` — Pillow 300px JPEG
- `src/review_hub/sidecar.py` — .review.json writer
- `tests/test_review_hub_{db,queries,scanner}.py`

### Created — Review Hub Frontend (34 files)
- `frontend/src/review/ReviewApp.tsx` — shell + nav + socket
- `frontend/src/review/pages/ReviewGallery.tsx`
- `frontend/src/review/components/{MediaGrid,MediaCard,FilterBar,Sidebar,DirectorySidebar,StatsBar,BulkBar}.tsx` — gallery
- `frontend/src/review/components/{Lightbox,LightboxToolbar,LightboxFooter}.tsx` — lightbox
- `frontend/src/review/components/{DrawingCanvas,DrawingToolbar,AnnotationCanvas,CommentThread}.tsx` — drawing + comments
- `frontend/src/review/components/{ContextMenu,MoveDialog,DeleteConfirmModal,NameModal,Toast,ConsolePanel,ConnectionStatus}.tsx` — dialogs + shell
- `frontend/src/review/hooks/{useDrawing,useGalleryData}.ts`
- `frontend/src/review/utils/drawingUtils.ts`
- `frontend/src/review/stores/{socketStore,userStore,drawingToolStore,drawingStore,toastStore}.ts`
- `frontend/src/review/services/{api,socket}.ts`
- `frontend/src/review/styles/review.css`

### Modified (Sessions 1-2)
- `frontend/src/App.tsx` — pathname routing for /review
- `frontend/vite.config.ts` — proxies for /socket.io, /media, /references, /thumbnails
- `pyproject.toml` — added python-socketio, aiosqlite
- `frontend/package.json` — added socket.io-client, fabric
- `src/api.py` — mount_review_hub() call
- `src/shared.py` — lazy cv2/numpy import
- `src/routers/{analyze,effects,llm,generate}.py` — lazy imports
- `CLAUDE.md` — session start section + skill references

### Dependencies Added
- `python-socketio[asyncio]>=5.10,<6.0`, `aiosqlite>=0.20,<1.0`
- `socket.io-client@^4.8.0`, `fabric@^6.5.0`

---

## Session 3 Summary
Fixed shared directory misalignment, rebuilt restart mechanism, centralized path config.

### Modified (Session 3)
- `config/settings.py` — `shared_media_path` → `shared_root` with derived properties (`media_dir`, `references_dir`, `thumbnails_dir`, `db_path`)
- `src/routers/system.py` — restart via `_reload_trigger.py` touch instead of subprocess spawn
- `src/routers/settings.py` — new: GET/PUT `/api/settings/paths`, POST `/api/settings/open-folder`
- `src/{api,shared,routers/bridge,routers/analyze}.py` — use `settings.media_dir` etc.
- `src/review_hub/{app,scanner,thumbnails}.py` — use settings properties instead of `Path(__file__)`
- `src/review_hub/routes/{media,folders,upload}.py` — use settings properties
- `frontend/src/components/SettingsPanel.tsx` — new Paths tab (edit, status dot, Open in Explorer)
- `tests/test_review_hub_scanner.py` — patches `settings.shared_root`
- `.gitignore` — added `_reload_trigger.py`, `_restart.bat`
- `.gitattributes` — LF normalization, CRLF for .bat
- `CLAUDE.md` — restart checklist, shared root docs, `--reload` requirement
- `Desktop/AYCB Studio.bat` — added `--reload` flag

## Tests
- Frontend: 115 passing (23 files), TSC clean
- Backend: 10 passing (3 files)

## Known Issues
- numpy DLL blocked by Windows Application Control — lazy imports work around it
- Review Hub not browser smoke-tested yet
- DrawingCanvas text tool not implemented

## Architecture Decisions
- Review Hub as self-contained package (`src/review_hub/`), not auto-discovered routers
- `shared_root` outside repo (`Documents/shared/`) — single source of truth via `config/settings.py`
- Restart via file touch — leverages uvicorn `--reload` file watcher, zero CMD windows
- All path derivation via `@property` on Settings class

## Current Position
- Phase 1: COMPLETE (scaffold + 5 core nodes)
- Phase 2: COMPLETE (15 remaining nodes + splits)
- Review Hub: CODE COMPLETE, needs smoke test

## Next Session Tasks
1. Browser smoke test Review Hub at /review
2. Test drawing + comments + real-time collaboration
3. Test generate → scanner → gallery integration flow
4. Polish visual issues found during testing
