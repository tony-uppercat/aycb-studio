# Contributing to AYCB Studio v2

Short guide for collaborators. Longer architectural context is in
[CLAUDE.md](./CLAUDE.md).

## Workflow

1. **Fork** the repo (or ask Antonio for write access).
2. **Branch off `dev`** — `main` is protected, direct pushes are
   blocked. Feature branches can use any name; `fix/<short-desc>`,
   `feat/<short-desc>` are common.
3. **Open a PR targeting `dev`**. GitHub Actions runs backend pytest +
   frontend `tsc` + vitest automatically; the PR can't merge until the
   CI turns green.
4. **Antonio reviews** before merge. Small fixes (<50 LOC, no arch
   change) can be self-merged once CI is green.
5. Periodic merges from `dev` → `main` happen when a set of features
   is shippable. Each `main` merge is a de-facto "release".

## Before you push

Run the same checks CI will run:

```bash
# Backend
python -m pytest

# Frontend
cd frontend && npx tsc --noEmit && npx vitest run
```

If either fails locally, fix it before pushing. You're saving ~2
minutes of CI time and keeping the commit graph honest.

## What a good commit looks like

- Prefix: `[fix]`, `[feat]`, `[refactor]`, `[test]`, `[docs]`,
  `[styles]`, `[perf]`, `[node]` (new node folder).
- First line ≤ 72 chars, imperative mood, describes the *what*.
- Body explains the *why* — constraints, trade-offs, references to
  issues or prior commits. Bullet lists are fine.
- One commit per logical unit. Don't mix a bug fix with a feature.

Example:

```
[fix] scanner — cap .meta.json size at 1 MB

A malformed sidecar could OOM the scanner loop on read_text(). The
registry sidecar shape maxes out at a few KB; gating at 1 MB is
orders of magnitude above any legitimate file.
```

## What CI checks

- **Backend**: `python -m pytest` against Python 3.12 on Ubuntu,
  installing `pip install -e ".[api,dev]"`.
- **Frontend**: `npx tsc --noEmit` + `npx vitest run` on Node 20 with
  `npm ci`.

No coverage minimum, no lint enforcement, no format bot (yet) — the
intent is the smallest useful gate, not a gauntlet.

## Project conventions (hard rules from CLAUDE.md)

- Max 300 LOC per file. Plan the split at 250.
- New node = new folder in `frontend/src/nodes/` with
  `node.manifest.ts`. Touch zero other files.
- All data fields `snake_case` (API payloads, TypeScript interfaces).
- No emoji in UI. Lucide icons (16px, stroke 1.5) + plain text.
- `AbortController` on every frontend `fetch` in `useEffect` cleanup.
- Sanitize all user text input before storage.
- Never `except: pass`. Always log the error. Corrupt data files:
  backup to `.corrupt` and reset.
- Never extend an existing file past 250 LOC. When in doubt, add a new
  file.

## Reporting bugs

Open a GitHub issue. Include:

- **Steps to reproduce** (canvas state if relevant — the backup JSON
  works great).
- **Expected vs actual** behavior.
- **Relevant logs** from the backend console + the browser DevTools
  console.
- If the browser perf log
  (`shared/data/browser-perf.jsonl`) has entries around the failure
  window, copy the last 20 lines.
