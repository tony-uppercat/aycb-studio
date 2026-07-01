# Technical Report — `aycb_ui` localStorage quota crash fix (2026-06-23)

Branch `dev-full`. Changes **UNCOMMITTED**. Close-out verification: **548 frontend
tests pass, `tsc --noEmit` clean**.

Scope of this session for AYCB = **one bug**: the recurring
`Failed to execute 'setItem' on 'Storage': Setting the value of 'aycb_ui'
exceeded the quota.` (A separate standalone "invoicer" tool was also designed
this session — NOT part of AYCB, lives at `C:\Users\upper\Documents\00_Utility\_invoicer\PLAN.md`. Ignore here.)

## TL;DR
The `aycb_ui` quota crash is now fixed **at the source**. `canvasStore`'s persist
wrote raw `localStorage` with no quota guard; its sibling `asyncJobStore` already
had the `persistSafely`/`safeStorage` degrade-to-no-persist wrapper but
`canvasStore` was never given it. On a full shared quota the `aycb_ui` write
threw uncaught → the exact error. Now it degrades to a `console.warn` + skip,
like the async store. Already happened before (2026-05-19, memory
[[project_storage_cleanup_paused]]) — back then only a manual cleanup snippet
shipped, never the crash-proofing.

## Root cause
- `aycb_ui` = `canvasStore` persist key (`STORAGE_KEYS.UI_STATE`).
- It persisted via **default `localStorage`** — no try/catch on `setItem`.
- `localStorage` is one shared ~5MB budget. The persisted `costs` array grows
  500-entries-per-project across **all** projects (only evicted on explicit
  project delete) and competes with `aycb_media_meta` + `aycb_bridge_stems`.
- When the budget fills, `canvasStore`'s `setItem('aycb_ui', …)` throws an
  uncaught `QuotaExceededError` on **every** `set()` → canvas ErrorBoundary /
  console spam. `asyncJobStore` (key `aycb_async_jobs`) silently no-ops in the
  same condition because it already wraps writes.

## What changed (3 files, mine, green)
- `frontend/src/stores/asyncJobStore.ts` — `export` the existing `safeStorage`;
  generalized the warn message `async-jobs persist skipped` →
  `persist skipped for "<key>"` (now serves both stores).
- `frontend/src/stores/canvasStore.ts` — persist now uses
  `storage: createJSONStorage(() => safeStorage)` (import from `./asyncJobStore`).
  No import cycle (asyncJobStore does not import canvasStore).
- `frontend/src/stores/canvasStore.test.ts` — regression test: `addCost` with a
  throwing `Storage.prototype.setItem` (QuotaExceededError) **must not throw**.
  Reproduced the crash (red) before the fix, green after.

Reused existing, already-tested machinery (`persistSafely`) — no new abstraction.

## Verify health
```
cd frontend && npx vitest run        # 548 passed
cd frontend && npx tsc --noEmit      # clean
```

## Commit guidance (entanglement)
- `canvasStore.ts` + `canvasStore.test.ts` are **isolated and mine** — clean to
  stage on their own.
- `asyncJobStore.ts` was **already dirty** from the 2026-06-14 async-queue WIP;
  my 2-line change (export + log text) rides on top. Committing it pulls in that
  WIP, or cherry-pick the two lines. Coordinate with the open commit-strategy
  decision in `reports/2026-06-14_async-audit-remediation_technical.md`.

## NOT fixed — still open (was a crash, now a silent degrade)
The **growth** is untouched, only the crash. `costs` still accumulates
500/project across every project and now **silently stops persisting** once the
shared quota fills (cost console loses new entries instead of crashing). Real
fixes (deferred, see [[project_storage_cleanup_paused]] items #1/#2):
1. Move `costs` / `media_meta` / `bridge_stems` / presets / templates out of
   `localStorage` into IndexedDB; keep only fixed-size config in `localStorage`.
2. Cap `bridge_stems` / `media_meta` by **bytes**, not entry count.
3. `navigator.storage.estimate()` warning toast at 80% quota.
4. `scripts/cleanup_browser_storage.js` still useful to free space now (manual
   DevTools paste).

## Memory updated
[[project_storage_cleanup_paused]] — appended a 2026-06-23 note recording that
the `aycb_ui` crash path is now closed (crash, not growth).
