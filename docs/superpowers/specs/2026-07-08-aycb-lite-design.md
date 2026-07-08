# AYCB Lite — Design

**Date:** 2026-07-08
**Status:** Approved by Antonio (brainstorming session)
**Approach:** B — pruned copy + targeted hardening pass

## Purpose

A lighter, stable version of AYCB Studio v2 serving all four goals at once:
distributable to others, leaner for daily personal use, a reducible base for
future web deploy, and a smaller codebase to maintain. **Stability is the
primary quality bar** — Lite must be more stable than full, not just smaller.

## Repo Strategy

- **New repo `aycb-lite`**, copied from `dev-full` at a clean checkpoint commit.
- Copy is pruned, not rewritten. Architecture unchanged: React 19 + Vite
  frontend proxied to FastAPI backend, node auto-discovery, provider registries.
- **Ports:** frontend **:5200**, backend **:5201** (Vite proxy updated) so Lite
  and full can run side by side.
- **Shared root:** same `C:\Users\upper\Documents\shared\` — Media stays the
  single source of truth, no duplication. Review Hub is removed, so there is no
  scanner/DB contention between the two apps.

## Prerequisite (blocking)

Before the copy, land ALL uncommitted work on `dev-full` and tag a checkpoint:

- Async fixes from 2026-06-16 (failJob un-hang, Gemini sync retry backoff,
  async_jobs quota guard, RH prompt search, flip H/V)
- Storage-cap orphan-only fix + quota warns (2026-07-07)
- Omni Flash duration fix + smoke test updates
- `rotateImage.ts` + test
- Current canvas/context-menu modifications

Forking from a stale base would bake known-fixed bugs into Lite.

## What Is Removed

### Backend
- `src/review_hub/` entirely: app, db, scanner, thumbnails, 10 route modules,
  queries
- Socket.IO server + mount
- Review Hub tests (`tests/test_rh_routes.py` + related)
- Orphaned dependencies after removal (`python-socketio`, `aiosqlite` if no
  other consumer) — verify with grep before dropping

### Frontend
- `frontend/src/review/` entire SPA (components, hooks, pages, services,
  stores, styles, ReviewApp)
- `ReviewTab` in ConsolePanel + any `/review` routing and socket stores
- 8 nodes: `image-analysis`, `video-analysis`, `subnet`, `subnet-input`,
  `subnet-output`, `group`, `switch`, `comparison`
- Quick aliases pointing at removed nodes
- **Consequence cuts** (discovered during planning — these read the Review Hub
  SQLite DB via `/api/bridge/review/*`, `/api/bridge/favorite`,
  `/api/bridge/assets`, which lose their data source when RH is removed):
  Media Browser review badges + favorite toggles, console AssetsTab,
  `src/routers/bridge_assets.py`. `registerBridgeStem`/`saveMediaMeta`
  (metadata writes to shared/Media) stay.

## What Stays (23 nodes + full periphery)

### Nodes
- **Core:** prompt-editor, generate-image, generate-image-batch, batch,
  image-upload, video-upload, generate-video, result-viewer, console
- **Image editing:** image-edit, image-fx, image-merge, color-correction,
  image-compare
- **Text/LLM:** llm, metaprompt, json-parser, json-parser-blend,
  bracket-parser, text-combine, find-replace, text-note, nb2-light-director

### Providers (all of them)
- Image: Gemini (NB2, NB2 Lite, NB Pro, Imagen), OpenAI gpt-image-2
  (client-side), Flux cloud, Local
- Video: Atlas (Kling), fal, PiAPI, Veo, Gemini Omni Flash
- LLM: Gemini, Claude API, cli-claude-* (subscription), Ollama

### Periphery
- Async/batch queue (Gemini + OpenAI −50%), cost console (per-project)
- Multi-project: ProjectGallery, ProjectSwitcher, templates
- Media Browser + FullscreenViewer + bridge to shared/Media
- ConsolePanel (minus ReviewTab) + CostsTab
- Prompt Library, quick aliases (pruned), day/night theme, perf logger
- Settings (paths, backend restart, backups)

Antonio's constraint: kept features must be **lightened where they are known
to misbehave** — stability over feature completeness.

## Hardening Pass (the point of Lite)

Targeted fixes on known-fragile areas, each verified empirically before close:

1. **Cascade video bug** — `GenerateVideoNode` `run()` resolves at submission;
   polling is decoupled, so downstream cascade breaks (known since 2026-05-19).
   Fix: `run()` awaits completion (or cascade waits on job terminal state).
2. **Storage/IDB** — confirm orphan-only `enforceStorageCap` + quota guards are
   in the copied base; verify no cross-project eviction path remains.
3. **Async queue robustness** — per-entry retry + recovery hardening (pending
   items from 2026-06-16 session).
4. **Empirical smoke pass** — run a smoke script per generation path
   (image sync, image batch, video per provider, LLM) before declaring stable.

## Phases

- **Phase 0** — land uncommitted work on `dev-full`, run full suites, tag
  checkpoint (e.g. `pre-lite-fork-2026-07-08`).
- **Phase 1** — create `aycb-lite` repo, copy, prune (backend + frontend +
  tests + deps), change ports, fix imports, get `tsc` + vitest + pytest green.
- **Phase 2** — hardening pass (items 1–3 above).
- **Phase 3** — smoke E2E per generation path, Lite `CLAUDE.md`, desktop
  launcher `.bat`, CI workflow copy.

Estimate: 2–3 sessions.

## Success Criteria

- `npx tsc --noEmit` clean; vitest + pytest green in the Lite repo
- App boots on :5200/:5201; both apps can run simultaneously
- Image gen (sync + batch), video gen, LLM node all verified working
- Zero `review_hub`/`review/` code or references remain (grep-verified)
- Cascade video fix verified with a real chained graph
- File count and dependency count measurably reduced vs full

## Non-Goals

- No rewrite of healthy layers (approach C rejected)
- No new features
- No web deploy in this cycle (Lite is the *base* for it, not the deploy)
- Review Hub stays exclusive to full v2
