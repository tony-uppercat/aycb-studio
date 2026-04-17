# AYCB Studio v2

Node-based AI image/video generation studio.
Single-process architecture: React+Vite frontend (:5100) proxied to Python FastAPI backend (:5101).

**Root:** `C:\Users\upper\Documents\00_aycb_v2`
**Source v0 (read logic only, never copy):** `C:\Users\upper\Uppercat Dropbox\Antonio Cottone\00_aycb\aycb`
**Reference v1 (structure patterns only):** `C:\Users\upper\Documents\00_aycb_v1`

---

## Session Start

At the start of EVERY session:
1. Read `skills/aycb-workflow/SKILL.md` — session lifecycle (open, execute, compact, close).
2. Read the latest `reports/*_technical.md` — current state and next tasks.
3. Invoke all applicable superpowers skills BEFORE any action (brainstorming before features, debugging before fixes, writing-plans before multi-step work). No exceptions — even if the task seems simple.
4. Orient: 3-4 lines max.

When creating/porting nodes, read `skills/aycb-node-creator/SKILL.md`.

---

## Rules (Non-Negotiable)

1. Max 300 lines per file. Plan the split at 250.
2. New node = new folder in `frontend/src/nodes/` with `node.manifest.ts`. Touch zero other files.
3. New backend endpoint = new file in `src/plugins/` (AYCB) or `src/review_hub/routes/` (Review Hub). Auto-discovered. Touch zero other files.
4. All data fields: `snake_case`. API payloads, TypeScript interfaces. No camelCase for data properties.
5. No emoji in UI. Lucide icons (16px, stroke 1.5) + plain text. Title Case for labels.
6. `AbortController` on every frontend fetch in useEffect cleanup. Review Hub `get()` accepts signal; `post()`/`del()` do not yet.
7. Sanitize all user text input before storage.
8. Run tests after every change. Fix failures before reporting done.
9. Interfaces before implementations. Check `types.ts` before creating services.
10. One task = one thing. Never mix node creation + bug fix + refactor in one task.
11. When in doubt, add a new file. Never extend an existing one past 250 lines.
12. Never `except: pass`. Always log the error. Corrupt data files: backup to `.corrupt` and reset.
13. Modify ONLY the files specified or directly required. Never add useEffect, hooks, refactors, or "improvements" not requested. Never modify .env as a side effect. If something else needs changing, ask first.
14. After 2 failed fix attempts: STOP. Invoke superpowers:systematic-debugging skill. Check console/terminal errors, last 3 commits, declare root cause before proposing any fix. Never try a 3rd fix without root cause.

---

## Architecture

```
Frontend (:5100)                    Backend (:5101)
Vite dev server                     FastAPI + uvicorn (lifespan)
├── React 19 + TypeScript 5.9       ├── src/routers/*.py    Auto-discovered
├── @xyflow/react 12                ├── src/plugins/*.py    Auto-discovered
├── Zustand 5                       ├── /api/generate/*     Generation
├── Providers (Gemini, Flux, etc)   ├── /api/analyze/*      Analysis
├── Proxy /api → :5101              ├── /api/llm/*          LLM
└── Review Hub (/review)            ├── /api/bridge/*       Bridge
    ├── Gallery + Lightbox          ├── /api/effects/*      Effects
    ├── Drawing + Comments          ├── /api/rh/*           Review Hub API
    ├── Socket.IO real-time         ├── /socket.io          Socket.IO
    └── Admin delete (pin auth)     └── /api/health         Health + LAN IP

Review Hub (mounted on same backend):
  src/review_hub/app.py       Socket.IO server + mount
  src/review_hub/routes/      10 route modules (/api/rh/*)
  src/review_hub/queries/     DB query modules (aiosqlite)
  src/review_hub/scanner.py   Polls shared/Media/ every 5s
  src/review_hub/db.py        SQLite (WAL mode, FK cascade)

Shared data (outside repo, not in git):
  ../shared/Media/   ../shared/References/   ../shared/data/
```

---

## Directory Structure

```
00_aycb_v2/
├── frontend/
│   └── src/
│       ├── nodes/                  21 node components (auto-discovered)
│       │   ├── _shared/            NodeShell, types, shared CSS
│       │   ├── prompt-editor/      generate-image/  llm/  batch/
│       │   ├── image-upload/       image-compare/  image-analysis/
│       │   ├── image-fx/           image-merge/  comparison/
│       │   ├── video-analysis/     video-upload/  generate-video/
│       │   ├── json-parser/        json-parser-blend/  metaprompt/
│       │   ├── switch/  group/     text-combine/  result-viewer/  console/
│       │   └── index.ts            Auto-discovery via import.meta.glob
│       ├── review/                 Review Hub SPA (lazy-loaded at /review)
│       │   ├── components/         Gallery, Lightbox, Drawing, Comments, etc.
│       │   ├── hooks/              useGalleryData (exports useFilteredMedia)
│       │   ├── pages/              ReviewGallery
│       │   ├── services/           api.ts, socket.ts
│       │   ├── stores/             userStore, socketStore, drawingStore, toastStore
│       │   ├── styles/             review.css
│       │   ├── utils/              drawingUtils.ts
│       │   └── ReviewApp.tsx       Entry point
│       ├── components/             UI components
│       │   ├── canvas/             FlowCanvas, CanvasContextMenu
│       │   ├── console/            ConsolePanel, ReviewTab
│       │   ├── media/              MediaBrowser, FullscreenViewer
│       │   ├── project/            ProjectGallery, ProjectSwitcher
│       │   └── ui/                 Button, Toast
│       ├── hooks/                  React hooks
│       ├── stores/                 Zustand stores
│       ├── providers/              Image/LLM provider registry
│       ├── utils/                  Utilities
│       ├── storage/                Storage key constants (keys.ts)
│       ├── events/                 Event system
│       └── styles/                 design-tokens.css, globals.css
├── src/                            Python backend
│   ├── api.py                      FastAPI app + lifespan + router auto-discovery
│   ├── routers/                    API routers (auto-discovered)
│   ├── plugins/                    Plugin routers (auto-discovered)
│   │   └── perf_log.py             POST /api/perf — browser perf/error log
│   └── review_hub/                 Review Hub backend
│       ├── app.py                  Socket.IO + mount + startup
│       ├── db.py                   SQLite connection + schema init
│       ├── scanner.py              Media directory poller (5s interval)
│       ├── thumbnails.py           300px JPEG thumbnail generation
│       ├── routes/                 10 route modules (prefix /api/rh)
│       └── queries/                DB query helpers (aiosqlite)
├── tests/                          Backend tests (98 tests, 14 files)
│   ├── conftest.py                 Shared fixtures (tmp_db)
│   ├── test_rh_routes.py           Review Hub HTTP integration tests
│   └── test_*.py                   Unit + integration tests
├── config/                         Settings, prompts
├── reports/                        Session reports
└── pyproject.toml                  Python dependencies
```

---

## Node System

Nodes are auto-discovered via `import.meta.glob` in `frontend/src/nodes/index.ts`.

Each node folder contains:
- `node.manifest.ts` — type, label, category, inputs/outputs (uses `NodeManifest` type)
- `{PascalName}Node.tsx` — component with `export default`
- Optional CSS module, test file, hook file

**Types:** `NodeManifest`, `SlotDef`, `SlotType`, `NodeCategory` in `nodes/_shared/types.ts`
**Categories:** `input`, `media-model`, `llm`, `utility`
**Slot types:** `text`, `image`, `video`, `prompt`, `media`

### Creating a Node

1. Create folder: `frontend/src/nodes/{kebab-name}/`
2. Write `node.manifest.ts` with default export
3. Write `{PascalName}Node.tsx` using `NodeShell` from `../_shared/NodeShell`
4. Write test file
5. DONE. Zero other files modified.

---

## Provider Architecture

Two registries in `frontend/src/providers/index.ts`:

```
imageProviders Map → getImageProvider(id)
llmProviders Map   → getLLMProvider(id)
```

Providers self-register on import (side-effect imports in `api.ts`):
- `geminiProvider.ts` → registers `gemini` (image), `imagen` (image), `gemini` (LLM)
- `fluxProvider.ts` → registers `flux-cloud` (image)
- `localProvider.ts` → registers `local` (image)
- `ollamaProvider.ts` → registers `ollama` (LLM)

---

## Design Tokens

Dark theme. Accent: `#F52776`. System fonts. Minimal border-radius.

```
--color-accent: #F52776             --color-accent-hover: #d41f64
--accent: #F52776                   --accent-glow: #F5277630
--color-bg-primary: #0a0a0b        --color-text-primary: #fafafa
--color-bg-secondary: #111113       --color-text-secondary: #a1a1aa
--color-border: #27272a             --color-success: #22c55e
--color-error: #ef4444              --color-warning: #eab308
```

Full set in `frontend/src/styles/design-tokens.css` and `frontend/src/styles/globals.css`.

---

## Not Yet Ported

- **Remaining nodes** — Inpainting, ComfyUI, Collage. All other nodes (21) are ported.

---

## Testing

```bash
cd frontend && npx vitest run          # Frontend tests (115 tests)
python -m pytest                        # Backend tests (98 tests)
```

**Gap:** Review Hub frontend has zero test files (`frontend/src/review/` has no `.test.tsx`). Backend RH routes are covered by `tests/test_rh_routes.py`.

---

## Running

**Desktop launcher:** `AYCB Studio.bat` on Desktop — starts backend + frontend + opens browser.

```bash
# Backend (--reload is MANDATORY for hot restart to work)
python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload

# Frontend
cd frontend && npm run dev
```

Frontend: http://localhost:5100
Backend:  http://localhost:5101

### Restart Mechanism

The backend restart (`POST /api/restart` or Settings > Backend > Hard Restart) works by touching `src/routers/_reload_trigger.py`. Uvicorn's `--reload` file watcher detects the change and respawns the worker process. **This only works if uvicorn was started with `--reload`.**

Checklist if restart is broken:
1. Was uvicorn started with `--reload`? Without it, touch has no effect.
2. Is `_reload_trigger.py` inside the watched directory (`src/`)? It must be.
3. Frontend polls `/api/health` every 1.5s for up to 30s. Backend should be back in ~2-3s.
4. If stuck: kill the "AYCB Backend" CMD window, relaunch `AYCB Studio.bat`.

### Shared Root

All shared data lives **outside the repo** at `C:\Users\upper\Documents\shared\`:

```
Documents/shared/          ← settings.shared_root
├── Media/                 ← settings.media_dir (scanner, bridge, uploads)
├── References/            ← settings.references_dir
└── data/
    ├── thumbnails/        ← settings.thumbnails_dir
    ├── review-hub.db      ← settings.db_path
    └── browser-perf.jsonl ← browser perf/error log (auto-rotates 1MB)
```

Single source of truth: `config/settings.py` → `settings.shared_root`. All backend modules import from `config.settings`. Editable from UI: Settings > Paths. Persisted to `.env` as `AYCB_SHARED_ROOT`.

**Never hardcode shared paths with `Path(__file__)`** — always use `settings.media_dir`, `settings.references_dir`, etc.

**Known exception:** `src/review_hub/db.py` uses `_DB_PATH = Path(__file__)...` instead of `settings.db_path`. Tests monkeypatch `_DB_PATH` directly. This should be migrated to use `settings.db_path` when touched next.

### Browser Performance Logger

Frontend (`utils/perfLogger.ts`) captures errors, promise rejections, long tasks (>100ms), LCP, CLS. Batches every 10s to `POST /api/perf`. Backend (`src/plugins/perf_log.py`) writes to `shared/data/browser-perf.jsonl`.

Guards: self-exclusion (logger errors ignored), dedup (same msg within 10s = skip), batch cap (50), file rotation (1MB).

**Review cycle:** every 3 days, read the log and propose performance fixes.

```bash
# Read raw log
cat ../shared/data/browser-perf.jsonl
# Filter errors only
cat ../shared/data/browser-perf.jsonl | jq 'select(.type=="error")'
# Top long tasks
cat ../shared/data/browser-perf.jsonl | jq 'select(.type=="long-task")' | jq -s 'sort_by(-.val) | .[0:10]'
```

---

## Backend Changes Checklist

After modifying any backend endpoint or model:
1. Verify frontend types match the new response shape.
2. Verify UI components reference correct endpoints.
3. Verify new fields appear in dropdowns/forms.
4. Test the endpoint with curl before claiming done.

---

## Data Sources of Truth

| Data | Source | Access |
|---|---|---|
| Generation metadata (prompt, model, cost) | PNG tEXt chunks | `_find_png_meta()` in bridge.py |
| Review status (approved/rejected/favorite) | Review Hub SQLite DB | `queries/favorites.py` |
| Comments, drawings | Review Hub SQLite DB | `queries/comments.py`, `queries/drawings.py` |

**No sidecar files.** All review data lives in the DB. No `.review.json` files.

## Admin Auth (Review Hub)

Pin-based: `ADMIN_PIN` constant in `frontend/src/review/stores/userStore.ts` and `src/review_hub/routes/media.py`. Frontend sends `X-Admin-Pin` header on delete requests. Backend verifies.

---

## Git

- Work on `dev` branch. Never commit directly to `main`.
- Commit on request or when a feature is complete (not micro-commits per task).
- Prefixes: `[node]`, `[fix]`, `[feat]`, `[refactor]`, `[test]`, `[docs]`, `[styles]`
- Run tests before every commit.

---

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Component files | PascalCase | `MediaGrid.tsx` |
| Hook files | camelCase, `use` prefix | `useSocket.ts` |
| Store files | camelCase, `Store` suffix | `mediaStore.ts` |
| Test files (frontend) | source name + `.test` | `MediaGrid.test.tsx` |
| Test files (backend) | `test_` prefix | `test_shared_utils.py` |
| CSS modules | PascalCase (matching component) | `NodeShell.module.css` |
| Directories | kebab-case | `generate-image/` |
| Node manifest type | camelCase | `generateImage` |
| Node labels (UI) | Title Case | `Generate Image` |
| Python files | snake_case | `media_files.py` |
| API paths | kebab-case | `/api/generate/image` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Types/interfaces | PascalCase | `NodeManifest` |
