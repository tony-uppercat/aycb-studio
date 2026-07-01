# Technical Report — Async Queue Audit Remediation (2026-06-14, evening)

Branch `dev-full`. All changes **UNCOMMITTED** (working tree). Close-out verification: **521 frontend tests pass, `tsc --noEmit` clean**.

## TL;DR — tonight's "bugs" were mostly STALE STATE, not new regressions

Antonio's own diagnosis nailed it: the weirdness came from **old nodes / old jobs already on the canvas** carrying stale persisted async state, plus **Vite HMR dev-state corruption** (running code ≠ disk). A latency workflow confirmed **zero perf regression** was introduced. Async batch is the SLOW/cheap tier (minutes–hours) — never "fast"; the old "fast feel" was the non-blocking instant-return illusion. See memory [[feedback_stale_state_vs_regression]].

## NEXT SESSION — do these FIRST
1. **Hard-reload** `Ctrl+Shift+R` (HMR corrupted state repeatedly tonight).
2. **Clear stale jobs** (browser console): `localStorage.removeItem('aycb_async_jobs'); location.reload();`
   → the mount-only self-heal then clears `asyncPending` on old stuck nodes → runnable again.
3. **Drag-to-canvas is a SEPARATE open issue** (see below) — NOT fixed this session, the fix attempt was reverted. Investigate it in the browser, not headlessly.

## What shipped (uncommitted, green)

Audit remediation from `reports/2026-06-14_async-queue-audit.md` (34 findings):

- **C1** cascade → forces SYNC for an ASY node feeding downstream (`isChainRunning()` in `cascadeRun.ts` set only by `executeCascade`/`executeCascadesParallel`, NOT `runNodesParallel`; `planRun()` in `useGenerateImage.ts`). Standalone + Run-Selected stay async.
- **H1** no double-submit: `planRun` → `'skip'` when `alreadyPending`.
- **H2** batch ×N + ASY → sync (would collapse N→1).
- **H8 + stale-job fix** `selectJobForNode` = **newest job by submittedAt**; `submittedAt` switched `performance.now()` → **`Date.now()`** (root cause of stale-leftover shadowing a fresh run).
- **H5/H6/H7** project-pinning: media + cost stamped to the **job's** project; `deleteProject` purges its async jobs.
- **H3** key-per-job: in-memory `_jobKeys` (NEVER persisted), poll with submit-key, fallback live.
- **H4** log every caught poll error (rule 12); `MAX_POLL_ERRORS` 6→30.
- **H9 + M2** cost = REAL usage from batch response (resolution-correct, discounted), carried on `req.usage`, logged by consumer instead of re-estimating from live node state.
- **M4 / L1 / L2 / L4** OpenAI submit partial-upload cleanup; output-file cleanup uses live `outputFileId`; `_lastState`/key cleanup on terminal; dead `removeJob` guard removed.
- **L3 (the unblock)** mount-only self-heal in `useGenerateImage`: OLD node reloaded with `asyncPending=true` but no live job → clears the flag (no longer bricked by the re-run guard). Mount-only so it never races a fresh run's pre-job debounce window.

## Drag-to-canvas — status: REVERTED, still OPEN (do NOT re-apply blindly)
`GenerateImageNode.tsx` was `git checkout`ed back to HEAD. **Sync drag works again.** Async drag is back to its ORIGINAL non-working state.

**What was tried and FAILED:** adding `onDragStart` (set `application/x-aycb-media` from `currentMediaId`) + `nodrag` class + explicit `draggable` on the node `<img>`. It **broke the previously-working SYNC drag too** → reverted (Iron Law: don't patch a working feature worse). The exact reason the attempt broke sync could not be confirmed headlessly (DOM drag isn't unit-testable).

**Root-cause analysis (verified by reading code — for whoever picks this up):**
- The node image is a bare `<img className={styles.previewImg}>` with NO `onDragStart`. Sync drag "works" only because the browser synthesizes a File from a **`data:` src** (sync's `imageB64`) → `useCanvasDragDrop.onDrop` `files` branch creates an `imageUpload`. Async results render as a **`blob:` src** (`historyPreview`) → the browser does NOT synthesize a File → `onDrop` gets nothing → nothing created. THAT is why async never worked and sync did.
- `onDrop` (`hooks/useCanvasDragDrop.ts:53`) already creates an `imageUpload` node from an `application/x-aycb-media` payload `[{mediaId,type,name}]`. The clean fix is to give the node image an explicit drag source emitting that payload — BUT it must NOT break the native data:-URL path, and the `nodrag` interaction with React Flow needs live-browser verification first.

**Recommended next approach:** investigate IN THE BROWSER (use the `/run` or `/verify` skill, or manual). Confirm with a temporary `console.log` whether `onDragStart` even fires on the node image (RF may swallow it). Only then wire `x-aycb-media`. Consider doing it once in a shared `_shared` drag helper so all media-producing nodes get it, rather than per-node.

## Files changed this session (mine — clean to commit)
`useGenerateImage.ts`, `generate-image.test.ts`, `asyncJobStore.ts(+test)`, `asyncBundler.ts(+test)`, `asyncJobPoller.ts(+test)`, `applyImageResult.ts(+test)`, `mediaStore.ts`, `useActiveProject.ts`.
(`GenerateImageNode.tsx` was reverted to HEAD — the drag attempt is gone.)

**Entangled (do NOT commit blindly):** `cascadeRun.ts(+test)` mixes my `isChainRunning` with Antonio's uncommitted **Block Run** WIP. Other dirty files (`NodeShell`, `FlowCanvas`, `CanvasContextMenu`, `useCanvasContextMenuActions`, `LLMNode`, `LLMHistory`, `imageMergeRender`) are Antonio's separate WIP — untouched by me.

## Open decisions (Antonio)
1. **Strategic** — keep the async batch queue at all? It's the SLOW/cheap tier, fragile in an interactive canvas (stuck-job recovery, no cancel UI). Options: keep+harden / disable (sync-only, batch via existing `scripts/batch_*.py`) / reduce to non-blocking-sync. **This is the real question raised tonight.**
2. **Commit strategy** given the `cascadeRun.ts` Block-Run entanglement.
3. **Branch `dev-full`**: merge / PR / keep / discard.
4. **Auto-flush cadence**: 2.5s / manual / 10–15s.

## Still deferred / open (non-blocking)
- **Drag node image → canvas with async** — OPEN (see section above). Sync works (data: File quirk), async doesn't (blob:). Fix attempt reverted; needs in-browser investigation.
- **M3** GC reaper for done/failed jobs whose nodes are deleted (store leak; needs canvas-wide reconcile).
- **L5** SKIPPED — `output_format:'png'` is empirically required for OpenAI batch edits (code comment "proven in PAO").
- **L6/L7** minor cost-display mismatches.
- **"Run Selected (Async)" intent** — currently runs selected nodes respecting their per-node ASY toggle; it does NOT force the batch queue. Decide if the menu should force-async (would touch Block Run WIP).

## Verify health
```
cd frontend && npx vitest run && npx tsc --noEmit   # 521 pass, 0 type errors
```
