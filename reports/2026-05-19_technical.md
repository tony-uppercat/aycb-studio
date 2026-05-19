# AYCB v2 — Technical Report 2026-05-19

## Summary

Investigation-only session. Antonio asked to verify the cascade run
("Sequential Run") actually waits for each node to finish AND for the
output to land in the store before the downstream node starts. Audit
confirmed correctness for sync providers, found one real bug
(GenerateVideo), and surfaced three minor smells. No code changed.

---

## Audit Scope

Files reviewed:
- `frontend/src/utils/cascadeRun.ts` (executeCascade + executeCascadesParallel)
- `frontend/src/nodes/_shared/NodeShell.tsx` (onRun registration + shift-click)
- `frontend/src/hooks/useDataPropagation.ts` (pullText, pullMedia, resolveSource)
- `frontend/src/nodes/generate-image/useGenerateImage.ts`
- `frontend/src/nodes/llm/LLMNode.tsx`
- `frontend/src/nodes/image-edit/useImageEdit.ts`
- `frontend/src/nodes/image-analysis/ImageAnalysisNode.tsx`
- `frontend/src/nodes/image-merge/useImageMerge.ts`
- `frontend/src/nodes/generate-video/useGenerateVideo.ts`
- `frontend/src/nodes/batch/BatchNode.tsx`
- `frontend/src/providers/fluxProvider.ts`
- `frontend/src/__tests__/critical-paths.test.ts`

---

## Findings

### Correct ✅ — Cascade core + sync provider nodes

`cascadeRun.ts:118-147` — `executeCascade` does:

```js
for (let i = 0; i < order.length; i++) {
  const fn = registry.get(nid)
  if (fn) await fn()
}
```

Topological order is computed via Kahn's algorithm (`cascadeRun.ts:47-69`).
Each node's `onRun` is registered via `NodeShell.tsx:140-145` in a
`useEffect`, so the registry always holds the latest closure.

Pattern in all sync nodes (Generate Image, LLM, Image Edit, Image
Merge, Image Analysis, Flux-Cloud):

1. `await api.X(...)` — blocks until provider responds
2. `await saveMediaForProject(mediaId, file)` if media is produced
3. `updateNodeData(id, { mediaId, outputMediaIds?, outputText?, ... })`
   — XYFlow's `updateNodeData` is a synchronous Zustand store write
4. THEN the promise resolves

Downstream nodes read via `pullText`/`pullMedia`/`pullAllMedia`, which
call `getNodes()`/`getEdges()` from `useReactFlow()` — these read the
live Zustand store, so they see the just-written values immediately.
Verified by `frontend/src/__tests__/critical-paths.test.ts:336-370`
("runs multiple leaf nodes in parallel after shared upstream").

Flux-Cloud is async (BFL polling URL) but its `pollForResult` is
`await`ed INSIDE `generateImage` (`fluxProvider.ts:48-100`), so from
the cascade's perspective the call is fully blocking.

### Bug ❌ — Generate Video doesn't await polling

`useGenerateVideo.ts:421-504` (`run`):

```js
const result = await api.generateVideo(...)
const reqId = result.request_id || result.task_id
setRequestId(reqId)
updateNodeData(id, { requestId: reqId, status: 'submitted', ... })
startPolling(reqId)   // ← setInterval, NOT awaitable
// run() resolves here
```

`startPolling` (`useGenerateVideo.ts:293-373`) sets `setInterval` and
returns synchronously. Inside the interval, `videoStatus` is polled
and on `completed` writes `mediaId`/`videoUrl`/`historyIds` via
`updateNodeData` (lines 339-348) — but by then the cascade has already
moved on.

Cascade `Prompt → GenerateVideo → VideoAnalysis` breaks: VideoAnalysis
runs at submission-time, pulls `videoUrl: ''` / `mediaId: undefined`,
fails or no-ops.

**Proposed fix:** convert `startPolling(reqId)` into
`pollUntilDone(reqId): Promise<void>` that resolves on terminal
states (completed/failed). `run()` awaits it before resolving. Keep
all internal side-effects (setVideoUrl, setHistoryIds, bridgeVideo,
addCost) inside the polling body unchanged — only the control flow
changes.

### Smell — `BatchNode.tsx:135` cargo delay

```js
await executeCascadesParallel(sourceIds, allEdges)
// Small delay to let React Flow state settle after cascade
await new Promise(r => setTimeout(r, 100))
await collectItems()
```

Cargo from the initial port (`a8f7928`). For sync providers
`executeCascadesParallel` already guarantees the store is up to date
when it resolves — `collectItems()` would read the same values 100ms
later. Safe to remove; can be done as part of the GenerateVideo fix
session.

### Smell — `_cascadeRunning` guard race

`cascadeRun.ts:120-126`:

```js
if (_cascadeRunning) {
  await _cascadeDone
}
_cascadeRunning = true
_cascadeDone = new Promise<void>(r => { resolveDone = r })
```

If two callers (B, C) arrive while a first cascade (A) is running:
both await the same `_cascadeDone` (A's promise). When A resolves,
both B and C resume on the microtask queue. They both pass the guard,
both set `_cascadeRunning = true`, and the later one overwrites
`_cascadeDone` — so B and C end up running in parallel even though
the intent is "one cascade at a time".

Edge case (requires queued shift+click in the same tick) but latent.
Fix would be a single-slot queue (`_pending: Promise<void>` chain) or
a Symbol-based ownership check inside the guard.

### Smell — `useImageEdit.ts:105` drops variants

```js
const b64 = r.images_b64[0]
setResultB64(b64)
```

In ×2/×4 mode the backend returns multiple `images_b64`. Only index 0
is kept; variants 2-4 are discarded. Off-topic for cascade but worth
fixing (write `outputMediaIds` map, mirror `useGenerateImage` batch
mode at `useGenerateImage.ts:642-648`).

---

## Files Changed

None.

---

## Tests

Not run — investigation only, no code touched.

Existing test for cascade ordering (`critical-paths.test.ts:336-370`)
still covers the sync-node case. A regression test for GenerateVideo
awaiting polling should be added with the fix.

---

## Memory Updates

- `project_cascade_video_bug.md` (new) — full description of the
  GenerateVideo cascade bug, file:line references, proposed fix,
  related smells. Indexed in `MEMORY.md` under Project section.

---

## Next Tasks

1. **Fix `useGenerateVideo` polling** — convert to awaitable
   `pollUntilDone`, await inside `run()`. Add a regression test that
   asserts `run()` doesn't resolve before terminal status.
2. **Remove `setTimeout(100)` in `BatchNode.tsx:135`** as part of the
   same change set (verified safe by the audit).
3. **Optional, lower priority:**
   - Fix `_cascadeRunning` race with a chain promise.
   - Fix `useImageEdit` batch variant discard.

---

## Working Tree (not part of this session)

Untouched, carried over from prior session(s):
- Batch node feature in progress (`frontend/src/nodes/generate-image-batch/`,
  `src/batch_gen/`, `src/plugins/batch_gen.py`, related tests + smoke
  scripts).
- Modifications to `frontend/src/api.ts`, `useGenerateImage.ts`,
  `geminiProvider.ts`, `types.ts`, `src/api.py`, `src/atlas_video_gen.py`,
  `src/gemini.py`, `src/registry.py`, `src/routers/generate.py`,
  `src/shared.py`, `Node.module.css`, `GenerateImageNode.tsx`,
  `frontend/src/providers/atlasImageProvider.ts`.
- Specs / plans under `docs/superpowers/`.

Per CLAUDE.md rule 13, left exactly as found.
