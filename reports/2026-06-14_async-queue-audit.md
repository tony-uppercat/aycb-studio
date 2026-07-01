# Async Batch Queue + Per-Project Cost Console — Adversarial Audit (2026-06-14)

Branch `dev-full`. Method: 7 finder dimensions → adversarial refute pass per finding → completeness critic → gap finders → synthesis. 60 agents, 26+18 findings checked, **34 confirmed real** (deduplicated below).

---

## 1. Verdict

The shipped async queue is **NOT safe to keep on `dev-full` as-is**. It works on the happy path (single node, single project, stable key, no re-runs) but breaks on every realistic deviation: cascades, batch x2/x4, project switching, key rotation, re-runs, and node/project deletion.

**Biggest risk (CRITICAL):** in a cascade/chain, an ASY node reports "done" the instant it enqueues — every downstream node consumes the *previous* (or empty) image, so chained graphs silently produce wrong output with no error and no re-run.

Close behind: same-node **double-submit** (bills two generations for one run), **batch x2/x4 collapsing N paid images into 1**, **key rotation permanently abandoning an already-billed batch**, and a family of **wrong-project cost/image misrouting** bugs that defeat the entire per-project cost console this work was meant to support.

Ship-blocking until at least the critical + the money/correctness `high`s are fixed.

---

## 2. Findings by Severity

### CRITICAL

**C1. Cascade treats ASY node as done on enqueue → downstream consumes stale/empty input**
`useGenerateImage.ts:577-602, 649-690` + `cascadeRun.ts:159-166`
Chained graphs (LLM, merge, compare, edit-chains, ResultViewer) run against the prior or empty image; the real result lands minutes later, downstream never re-runs.
Fix: in the ASY branch of `runSingle`, return a promise that resolves only when this node's job reaches a terminal state (apply result before returning) — or force the sync path when the node is in a cascade.

### HIGH

**H1. Same-node re-run double-submits two paid batches (bundler deletes bucket before await)**
`asyncBundler.ts:60-104` (delete at 62, awaits at 74/84)
Two real paid generations + two cost logs for one run; second result overwrites the node silently.
Fix: `inFlight` Set keyed by `bundleKey` around the submit; or caller-side early-return in `runSingle` when `data.asyncPending` is true.

**H2. Batch x2/x4 + ASY collapses N generations into 1**
`asyncBundler.ts:50` — bundler dedups by nodeId.
User requests N images, gets 1; N-1 unbilled, extra output slots never bound.
Fix: bundle identity unique per `runSingle` call (`${id}#${uuid}`) + consumer consumes all the node's requests. Or disable ASY when `batchCount>1`.

**H3. Key rotation permanently fails an already-billed batch (poller uses live key, not submit key)**
`asyncJobPoller.ts:129-135, 59-63, 115-123`
Rotating the API key mid-flight → poller hits 401/403/404, exhausts 6 retries, marks a succeeded+billed batch failed → money spent, image lost.
Fix: store the submitting key (or key id) on `AsyncJob`, poll each job with its own key; don't count 401/403/404 toward `pollErrors`.

**H4. Transient blip permanently fails a job; poll errors swallowed silently**
`asyncJobPoller.ts:59-63, 115-123, 142-146`
A ~60s network drop / 429 burst permanently fails a healthy server-side batch; bare `catch {}` violates CLAUDE.md rule 12.
Fix: log the caught error; treat 429/5xx/network as transient (backoff, no exhaustion count); only terminal errors hit `MAX_POLL_ERRORS`.

**H5. Background poller saves images into the currently-open project, not the job's project**
`asyncJobPoller.ts:43-52, 98-107` + `mediaStore.ts:134-147`
Submit in A, switch to B, batch completes → image registered into B's gallery. Job carries `projectId` but the poller ignores it.
Fix: thread `job.projectId` through `applyImageResult` → `saveMediaForProject`, fall back to `activeProjectId` only when absent.

**H6. Async cost attributed to the active project at consume time, not the job's project**
`useGenerateImage.ts:718-722`
The x0.5 cost lands on whatever project is active when the poll resolves → per-project cost console corrupted.
Fix: pass `projectId: myJob.projectId` into the `addCost` call.

**H7. `deleteProject` leaks the project's async jobs and mis-routes their results**
`useActiveProject.ts:451-499`
Deleting a project mid-batch leaves its jobs polling forever; on success the image saves into whatever project is now active; job lingers 'done' in localStorage.
Fix: after the cost purge, `for (const j of jobsForProject(targetId)) removeJob(j.id)` (both actions exist).

**H8. Consumer reads the OLDEST matching job → stale image or stuck-pending**
`useGenerateImage.ts:699-725`
`jobs.find(...)` returns the oldest job for the node. Unresolved-while-newer-ready → stuck pending; completed orphan → stale image + extra cost logged. A failed older job masks a newer paid result indefinitely.
Fix: select the newest *resolved* job (filter on `resultMediaId||error`, sort by `submittedAt` desc, fall back to any match).

**H9. Async Gemini PNG-meta/bridge cost ignores imageSize → metadata under-reports ~34-56%**
`asyncJobPoller.ts:40`
`parseGenerateContentResponse(..., GEMINI_BATCH_DISCOUNT)` omits `imageSize` → 1K tier default; embedded PNG/bridge cost diverges from console (4K flash: $0.0335 meta vs $0.0755 console).
Fix: pass the 4th arg — `req.meta?.resolution ?? ''`.

### MEDIUM

**M1. BatchNode collects stale/empty results from ASY upstream nodes**
`BatchNode.tsx:120-154` — harvests `data.mediaId` 100ms after cascade; ASY sources have none yet. Same root cause as C1 (partial self-heal via mediaId subscription, but cost stays wrong).

**M2. Async cost re-estimated from live node state, not the submitted snapshot**
`useGenerateImage.ts:718` — changing model/resolution while in flight logs the *new* cost (switch to free/local → paid batch logged $0). Also hardcodes `thinking=false`, under-reporting flash ~23%.
Fix: estimate from `myJob.modelId` / `req.meta.resolution` / `req.meta.prompt` + real thinking flag. Best: `applyImageResult` emits the single stamped cost.

**M3. Failed/done jobs of unmounted or deleted nodes never GC'd; failures never surfaced**
`asyncJobStore.ts:74-83, 88` + `asyncJobPoller.ts:127-136` — terminal jobs whose node is deleted/inactive persist unbounded; failures invisible (no failed-job UI); multi-request bundle jobs with a deleted member never reach length 0.
Fix: poller/startup reaper drops terminal jobs whose nodeIds exist on no canvas; surface failures to Console; prune orphaned bundle requests.

**M4. Failed OpenAI submit after partial ref upload leaks vision files**
`openaiBatchPath.ts:81-104` — ref/JSONL upload or batch-create throws mid-way → uploaded vision file ids never deleted → recurring OpenAI storage cost.
Fix: try/catch around `submitOpenAIBatch`; best-effort `deleteFileQuiet` every collected id before re-throw.

### LOW

- **L1.** OpenAI output file leaks on completed-but-download-fails path — `asyncJobPoller.ts:91-92,115-123` reads stale closure `outputFileId` (undefined). Re-read `live` job before cleanup.
- **L2.** `_lastState` map entries leak for poll-retry-exhausted / deleted-node jobs — `asyncJobPoller.ts:59-63,115-123` catch never `_lastState.delete(job.id)`.
- **L3.** Reload during 2.5s debounce orphans node in 'Batch · queued' forever — `asyncBundler.ts:39-57` + `useGenerateImage.ts:585/601`; buckets in-memory only. On bootstrap clear `asyncPending` for any node with no matching job.
- **L4.** `removeJob` guard at `useGenerateImage.ts:723-724` is dead code (`markConsumed` already removes single-request jobs; multi-request never length 1). Delete it; do graph-based pruning.
- **L5.** OpenAI async edits sends `output_format:'png'` the sync path omits — `openaiBatchPath.ts:90`. Benign divergence; drop the line.
- **L6.** OpenAI async: missing `usage` leaves PNG-meta `cost_usd` absent while console still logs an estimate — `openaiBatchPath.ts:147-153`. Fall back to same estimate in `applyImageResult`.
- **L7.** BatchNode cost sum reports $0 for ASY sources — `BatchNode.tsx:141-147`; async cost logged later by consumer. Display-only; show "cost pending".
- **L8.** ASY loading spinner / elapsed timer clear instantly in cascade/manual run — `useGenerateImage.ts:498-503,649-690`; Run button re-enables immediately, inviting duplicate enqueue. Drive `running`/elapsed off `data.asyncPending`. Largely resolved by C1.

### De-duplication note
Wrong-project cost (`useGenerateImage.ts:718-722`) appeared 5× → one HIGH (H6). Done/failed-job persistence leak appeared 4× → one MEDIUM (M3) + the deleteProject HIGH (H7). Gemini imageSize-in-meta appeared 2× → one HIGH (H9). Stale-image / stuck-pending selector appeared 3× → one HIGH (H8). Live-state-vs-snapshot cost re-estimation appeared 3× → one MEDIUM (M2).

---

## 3. Recommended Fix Order

1. **Cascade ASY await (C1, critical)** — `useGenerateImage.ts` runSingle ASY branch. Silent wrong output in any chained graph; everything downstream is untrustworthy until this holds. Also fixes M1 + L8.
2. **Double-submit `inFlight` guard + caller-side asyncPending early-return (H1)** — `asyncBundler.ts:60-104` / `runSingle`. Direct money loss, easy to trip.
3. **Batch x2/x4 unique bundle key, or disable ASY when batchCount>1 (H2)** — `asyncBundler.ts:50`. Money + missing output; small change.
4. **Selector → newest resolved job (H8)** — `useGenerateImage.ts:699`. Unblocks stuck-pending + stale-image; one-line, high leverage.
5. **Project pinning trio, one pass (H5+H6+H7):** poller `applyImageResult` threads `job.projectId`; cost `projectId: myJob.projectId`; `deleteProject` job purge. Restores the per-project cost console + correct gallery routing — the feature's whole point.
6. **Key-per-job + transient-error handling (H3+H4)** — `asyncJobPoller.ts`. Stops key rotation / brief outages from abandoning billed batches; satisfies CLAUDE.md rule 12.
7. **Cost-snapshot correctness (M2+H9)** — estimate from `myJob.modelId`/`req.meta` + real thinking flag (`:718`); pass `imageSize` into poller meta cost (`:40`).
8. **GC reaper + file-leak cleanups, batch the lows (M3,M4,L1-L8):** terminal-job reaper, `submitOpenAIBatch` try/catch, completed-download cleanup re-read, `_lastState.delete`, debounce-reload `asyncPending` clear, dead line 724, `output_format` parity.

Steps 1-4 are ship-blockers. Steps 5-6 must land before this is trusted in multi-project / multi-key use. 7-8 are correctness/hygiene and can follow.

---

## 4. Original pre-audit hunches — disposition
1. Node-in-two-jobs mis-route → **CONFIRMED** (H8).
2. activeProjectId at consume vs submit → **CONFIRMED** (H6).
3. Reload during 2.5s debounce → **CONFIRMED** (L3, low not high — only the badge sticks).
4. Blocked node enqueued for async → not surfaced as a real bug here (Block Run is uncommitted WIP; see C1/H1 caller-guard fixes which also cover it).
5. Deleted node mid-flight leak → **CONFIRMED** (M3, L4).
6. Gemini async body parity → mostly OK; cost-meta `imageSize` is the real gap (H9), not the image body.
7. OpenAI multi-ref per-request → OK; the real OpenAI bug is leak on partial-upload failure (M4) + `output_format` divergence (L5).
8. BatchNode `executeCascadesParallel` → not broken; BatchNode's real bug is harvesting ASY sources too early (M1).
9. Double discount ×0.5 → NOT double-discounted; the cost bugs are wrong-project (H6) + live-state snapshot (M2) + imageSize meta (H9).
