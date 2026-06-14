# Handoff — Async Batch Queue + Cost Console (2026-06-14)

Session "costi-e-async". Branch `dev-full`. Tests **495 pass, tsc clean** at last full run. Caveman chat mode was active; ignore for handoff.

---

## 1. What shipped this session (committed on `dev-full`)

### A. Per-project cost console — commit `8a5815f`
- `CostEntry.projectId` stamped from `activeProjectId`; per-project 500 cap; `removeCostsForProject`; `getProjectCosts`.
- Extracted `components/console/CostsTab.tsx` + `hooks/useProjectCosts.ts` — tab filters/totals/badge/export/clear by active project. Export = `costs_<project>_<date>.json`. `deleteProject` purges its costs.
- 7 addCost call-sites: `model` normalized to canonical id via `resolveModel()`. `useImageEdit` hardcoded model fixed. `geminiShared` image cost made resolution-aware (but see follow-up #1).

### B. Non-blocking async batch image queue (Gemini + OpenAI) — commits `3ea90d7`…`d66c2fb`
Spec: `docs/superpowers/specs/2026-06-14-async-batch-queue-bundling-design.md`
Plan: `docs/superpowers/plans/2026-06-14-async-batch-queue-bundling.md`

Architecture: batch lifecycle split into **submit (fast)** + **poll (background)**.
- `stores/asyncJobStore.ts` — persisted jobs (recovery). `AsyncJob.requests[]` keyed by nodeId; `.meta{prompt,modelName,resolution,aspectRatio}`; optional `.openai{batchId,inputFileId,refFileIds,outputFileId}`; runtime `pendingCount`.
- `services/asyncBundler.ts` — per-`bundleKey` debounced (2.5s) buckets, 18MB chunking, provider-aware flush. bundleKey: gemini=modelId, openai=`modelId|gen` / `modelId|edits` (OpenAI Batch is single-endpoint). **apiKey travels on the request** (not a singleton getter — see fix `de1240e`). `_syncPending` updates `pendingCount`.
- `services/asyncJobPoller.ts` — singleton, polls all active jobs in parallel every 10s, provider-aware (`pollJobOnce` gemini / `pollOpenAIJobOnce` openai). Saves via `applyImageResult` (keeps metadata + bridge). `_lastState` map → live `[batch]` log to Console. Recovers persisted jobs on mount. Poller still uses an injected key getter (`configurePoller`) for recovery polls.
- `services/applyImageResult.ts` — shared result→mediaStore+meta+bridge (sync runSingle AND poller).
- `providers/geminiBatchPath.ts` / `openaiBatchPath.ts` — split into submit/poll/extract(or fetch)/cleanup; old `runGeminiBatch`/`runOpenAIBatch` kept as back-compat wrappers.
- `components/AsyncQueueBootstrap.tsx` — mounted in `App.tsx` inside SettingsProvider; starts poller, injects provider-aware key getter for the POLLER only.
- `nodes/generate-image/useGenerateImage.ts` — two ASY short-circuits (gemini + openai) before `api.generateImage`: build body → `enqueueAsyncRequest` (carries apiKey + meta) → return non-blocking. `myJob` consumer effect renders resultMediaId + cost ×0.5; `asyncConsumedRef` guards StrictMode double-count.
- `components/console/ConsolePanel.tsx` — `N in coda` + "Lancia coda ora" (driven by reactive `pendingCount`) and `N batch in corso` (activeJobs).
- `nodes/generate-image/GenerateImageNode.tsx` — `Batch · queued` badge on `data.asyncPending`.

Bundling = N same-model(+endpoint) requests → ONE batch submission → −50% kept, results routed by metadata.key (gemini) / custom_id (openai).

**Live gate PASSED**: ran a minimal N=2 @0.5K variant of `scripts/smoke_test_gemini_batch_bundle.py` (committed N=3) — both keys routed correctly, ~$0.045. Gemini multi-request bundling verified live.

### C. Two bug fixes living in UNCOMMITTED (dirty) files — NOT yet committed
These edit WIP files (Block Run / LLMHistory), left dirty on purpose:
- **LLM Claude-CLI cost → $0** (`nodes/llm/LLMNode.tsx`): `costUsd = isClaudeCli ? 0 : ...`. Root cause: `src/claude_cli.py:137` returns `total_cost_usd` (API-equivalent) but subscription marginal cost is $0. Tokens still tracked.
- **Run Selected (Async) runs only the selected** (`utils/cascadeRun.ts` new `runNodesParallel` + `FlowCanvas.tsx` rewired + `utils/cascadeRun.test.ts`): was using `executeCascadesParallel` which ran upstream too. `runNodesParallel(ids)` runs only the selected in parallel, skips blocked, no upstream.

---

## 2. Git state

`git log main..dev-full` top = `d66c2fb`. ~30 commits ahead of main (this session's async + cost + prior LLM-skills work).

**Dirty (uncommitted) — WIP, do NOT blow away:**
```
M CanvasContextMenu.tsx, FlowCanvas.tsx, useCanvasContextMenuActions.ts   ← Block Run feature
M NodeShell.tsx, NodeShell.module.css                                     ← Block Run UI
M utils/cascadeRun.ts  +  ?? utils/cascadeRun.test.ts                     ← Block Run + runNodesParallel fix (2.C)
M nodes/llm/LLMNode.tsx  +  ?? nodes/llm/LLMHistory.tsx                    ← LLMHistory feature + cli-cost fix (2.C)
M utils/imageMergeRender.ts, imageMergeRender.test.ts                     ← separate refactor (unrelated)
```
Block Run = node "freeze" feature (frozen boundary skipped in chain runs) + "Run Selected (Async)" context-menu item. LLMHistory = read-only prompt/response browse per LLM node. Both are the user's in-progress features awaiting their review — not part of the async/cost work.

---

## 3. BLOCKED: the audit (re-run after session limit resets ~15:30 Europe/Berlin)

User asked "c'è qualcosa che non va fai un audit" with `/effort ultracode`. Launched `async-queue-audit` workflow (6 finder dims → adversarial verify → completeness critic → synthesize). **All agents failed: "You've hit your session limit · resets 3:30pm (Europe/Berlin)".** Zero findings produced.

**Resume after reset:**
```
Workflow({ scriptPath: "C:\\Users\\upper\\.claude\\projects\\C--Users-upper-Documents-00-aycb-v2-frontend-src\\5edc230a-a544-4a0c-ae43-87e1089fbe4d\\workflows\\scripts\\async-queue-audit-wf_0a4c82e4-b0c.js", resumeFromRunId: "wf_0a4c82e4-b0c" })
```
(Or just relaunch the same workflow fresh — nothing cached since all agents errored.)

### Suspected issues the audit should confirm (my own pre-audit hunches — UNVERIFIED, hunt these first):
1. **Node in two jobs**: a node submitted in batch1 (in-flight) then re-run → enqueued into batch2 → appears in TWO jobs. Consumer `s.jobs.find(j => requests.some(nodeId===id))` returns only the FIRST → possible mis-route / stale result. (`useGenerateImage.ts` consumer effect.)
2. **activeProjectId at consume vs submit**: async cost/media stamped with `activeProjectId` at CONSUME time. If user switches project while polling → cost lands on wrong project.
3. **Reload during the 2.5s debounce window**: buckets are NOT persisted → pending requests lost silently → node stuck `asyncPending:true` forever (no job ever forms to clear it).
4. **Blocked node enqueued for async**: bundler does NOT consult the block registry (`isNodeBlocked`) — a blocked node's ASY run may still submit.
5. **Deleted node mid-flight**: job's request never consumed (consumer needs node mounted) → `done` job lingers in persisted store, reappears each reload (leak).
6. **Gemini async body parity**: confirm `buildGeminiImageBody` is byte-identical to the sync path (thinking gate, 0.5K→512, grounding) — divergence = different output ASY vs sync.
7. **OpenAI multi-ref**: confirm `submitOpenAIBatch` uploads each request's OWN refs in a multi-request batch (not merged).
8. **BatchNode**: still imports `executeCascadesParallel` — confirm the Run-Selected rewire (2.C) didn't break it.
9. **Double discount**: poller parse applies ×0.5 AND consumer estimate applies ×0.5 — confirm the cost-TAB entry isn't double-discounted vs the PNG meta cost.

---

## 4. Open decisions (ask user)

- **Auto-flush cadence** (async queue): currently auto-flushes 2.5s after last enqueue. User unsure if they want (A) keep 2.5s, (B) MANUAL queue — no auto-flush, only "Lancia ora", or (C) longer ~10-15s. Awaiting choice.
- **Branch close** `dev-full`: 1) merge main locally · 2) push + PR · 3) keep as-is · 4) discard. Awaiting choice. (Finishing-a-development-branch was in progress.)

## 5. Follow-ups (tracked, not blocking)

1. **imageSize NOT threaded** from callers (`providers/geminiProvider.ts:150`, batch path) to `geminiShared.computeGeminiCost` → 4K cost still logs at 1K tier (under-reports ~44-56%). geminiShared is resolution-aware but not fed the size.
2. **ConsolePanel.tsx is 583 lines** (>300 rule) — extract FeedbackPanel next.
3. **LLMNode model-id normalization** deferred (entangled with uncommitted LLMHistory).
4. **OpenAI Batch caveat**: completion_window 24h (slow by design); gpt-image-2 has auth flakiness (`project_openai_401_ip_allowlist`).

## 6. Memory updated
`memory/project_async_batch_queue.md`, `memory/project_cost_console_perproject.md` (+ MEMORY.md index). Gate marked PASSED.

## 7. How to verify health
```
cd frontend && npx vitest run && npx tsc --noEmit   # last: 495 pass, 0 type errors
```
