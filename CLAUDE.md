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
3. Orient: 3-4 lines max.

When creating/porting nodes, read `skills/aycb-node-creator/SKILL.md`.

---

## Rules (Non-Negotiable)

1. Max 300 lines per file. Plan the split at 250.
2. New node = new folder in `frontend/src/nodes/` with `node.manifest.ts`. Touch zero other files.
3. New backend endpoint = new file in `src/plugins/`. Auto-discovered. Touch zero other files.
4. All data fields: `snake_case`. API payloads, TypeScript interfaces. No camelCase for data properties.
5. No emoji in UI. Lucide icons (16px, stroke 1.5) + plain text. Title Case for labels.
6. `AbortController` on every frontend fetch call.
7. Sanitize all user text input before storage.
8. Run tests after every change. Fix failures before reporting done.
9. Interfaces before implementations. Check `types.ts` before creating services.
10. One task = one thing. Never mix node creation + bug fix + refactor in one task.
11. When in doubt, add a new file. Never extend an existing one past 250 lines.

---

## Architecture

```
Frontend (:5100)                    Backend (:5101)
Vite dev server                     FastAPI + uvicorn
├── React 19 + TypeScript 5.9       ├── src/routers/*.py    Auto-discovered
├── @xyflow/react 12                ├── src/plugins/*.py    Auto-discovered
├── Zustand 5                       ├── /api/generate/*     Generation
├── Providers (Gemini, Flux, etc)   ├── /api/analyze/*      Analysis
└── Proxy /api → :5101              ├── /api/llm/*          LLM
                                    ├── /api/bridge/*       Bridge
                                    ├── /api/effects/*      Effects
                                    └── /api/health         Health check

Shared data (local, not in git):
  shared/data/    shared/Media/    shared/References/
```

---

## Directory Structure

```
00_aycb_v2/
├── frontend/
│   └── src/
│       ├── nodes/                  Node components (auto-discovered)
│       │   ├── _shared/            NodeShell, types, shared CSS
│       │   ├── prompt-editor/      PromptEditorNode
│       │   ├── generate-image/     GenerateImageNode
│       │   ├── llm/                LLMNode
│       │   ├── json-parser/        JsonParserNode
│       │   ├── batch/              BatchNode
│       │   └── index.ts            Auto-discovery via import.meta.glob
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
│       ├── storage/                IndexedDB, storage keys
│       ├── events/                 Event system
│       └── styles/                 design-tokens.css, globals.css
├── src/                            Python backend
│   ├── api.py                      FastAPI app + router auto-discovery
│   ├── routers/                    API routers (auto-discovered)
│   └── plugins/                    Plugin routers (auto-discovered)
├── config/                         Settings, prompts
├── shared/                         Media, data (gitignored)
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
--amber: #F52776                    --amber-glow: #F5277630
--color-bg-primary: #0a0a0b        --color-text-primary: #fafafa
--color-bg-secondary: #111113       --color-text-secondary: #a1a1aa
--color-border: #27272a             --color-success: #22c55e
--color-error: #ef4444              --color-warning: #eab308
```

Full set in `frontend/src/styles/design-tokens.css` and `frontend/src/styles/globals.css`.

---

## Not Yet Ported

- **Review Hub** — LAN review system for iPad (Express + Socket.io + React). Planned for Phase 2.
- **Remaining 12 nodes** — ImageUpload, ImageCompare, Inpainting, VideoAnalysis, VideoGenerate, ComfyUI, Switch, Collage, and others. Same pattern as existing 5.

---

## Testing

```bash
cd frontend && npx vitest run          # Frontend tests
cd . && pytest                          # Python backend tests
```

---

## Running

```bash
# Backend
python -m uvicorn src.api:app --host 0.0.0.0 --port 5101

# Frontend
cd frontend && npm run dev
```

Frontend: http://localhost:5100
Backend:  http://localhost:5101

---

## Git

- Work on `dev` branch. Never commit directly to `main`.
- Commit after each successful task.
- Prefixes: `[node]`, `[fix]`, `[feat]`, `[refactor]`, `[test]`, `[docs]`, `[styles]`
- Run tests before every commit.

---

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Component files | PascalCase | `MediaGrid.tsx` |
| Hook files | camelCase, `use` prefix | `useSocket.ts` |
| Store files | camelCase, `Store` suffix | `mediaStore.ts` |
| Test files | source name + `.test` | `MediaGrid.test.tsx` |
| CSS modules | PascalCase (matching component) | `NodeShell.module.css` |
| Directories | kebab-case | `generate-image/` |
| Node manifest type | camelCase | `generateImage` |
| Node labels (UI) | Title Case | `Generate Image` |
| Python files | snake_case | `media_files.py` |
| API paths | kebab-case | `/api/generate/image` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Types/interfaces | PascalCase | `NodeManifest` |
