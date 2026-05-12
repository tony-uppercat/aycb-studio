# Image Node Link Bug — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "always linked" alias bug between Image nodes (and other media-owning nodes) by forking blobs on duplicate/paste, and turn the new `image-in` slot on the Image node into a proxy passthrough that mirrors upstream live without mutating `data.mediaId`.

**Architecture:** Two independent concerns shipped as two commits. (1) Universal `cloneNodeMedia` helper called from `ctxDuplicate`/`ctxPaste` clones every media-ref field in `node.data` to fresh ids in IndexedDB. (2) Image node's `useImageUpload` hook detects an upstream edge on `image-in` and writes `outputMediaIds['image-out']` to mirror live, never touching its own `data.mediaId`; preview, drag, and picker gate on the proxy state.

**Tech Stack:** React 19, @xyflow/react 12, Zustand 5, vitest, IndexedDB (browser API).

**Spec:** `docs/superpowers/specs/2026-05-04-image-node-link-bug-design.md`

---

## Commit 1 — Universal Fork Eager

### Task 1: Add `cloneNodeMedia` helper with TDD

**Files:**
- Modify: `frontend/src/mediaStore.ts` (append at end, use existing `loadMedia`, `saveMediaForProject`, `generateMediaId`)
- Create: `frontend/src/mediaStore.test.ts`

**Why TDD here:** the helper is pure orchestration over an injectable IO surface. Mocking the load/save loaders gives us full coverage of dedup, orphan handling, and field rewriting without an IDB polyfill (jsdom has no IndexedDB; existing tests like `subnet-output.test.ts` already mock `mediaStore` for this reason — here we instead use dependency injection because we *are* `mediaStore`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/mediaStore.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { cloneNodeMedia } from './mediaStore'

function makeMockLoaders(blobs: Record<string, File | null>) {
  const load = vi.fn(async (id: string) => blobs[id] ?? null)
  const save = vi.fn(async () => {})
  return { load, save }
}

describe('cloneNodeMedia', () => {
  it('clones a single mediaId to a new id with the same blob', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' })
    const { load, save } = makeMockLoaders({ 'old-1': file })

    const out = await cloneNodeMedia({ mediaId: 'old-1' }, { load, save })

    expect(out.mediaId).not.toBe('old-1')
    expect(typeof out.mediaId).toBe('string')
    expect(load).toHaveBeenCalledWith('old-1')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(out.mediaId, file)
  })

  it('clones each id in historyIds preserving order and length', async () => {
    const f1 = new File(['1'], '1.png')
    const f2 = new File(['2'], '2.png')
    const f3 = new File(['3'], '3.png')
    const { load, save } = makeMockLoaders({ 'h-1': f1, 'h-2': f2, 'h-3': f3 })

    const out = await cloneNodeMedia({ historyIds: ['h-1', 'h-2', 'h-3'] }, { load, save })

    const ids = out.historyIds as string[]
    expect(ids).toHaveLength(3)
    expect(ids.every(id => typeof id === 'string')).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect(ids).not.toContain('h-1')
    expect(ids).not.toContain('h-2')
    expect(ids).not.toContain('h-3')
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('clones each id in frameIds preserving order', async () => {
    const f1 = new File(['a'], 'a.mp4', { type: 'video/mp4' })
    const f2 = new File(['b'], 'b.mp4', { type: 'video/mp4' })
    const { load, save } = makeMockLoaders({ 'f-1': f1, 'f-2': f2 })

    const out = await cloneNodeMedia({ frameIds: ['f-1', 'f-2'] }, { load, save })

    const ids = out.frameIds as string[]
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe('f-1')
    expect(ids[1]).not.toBe('f-2')
  })

  it('clones each value in outputMediaIds preserving keys', async () => {
    const f1 = new File(['a'], 'a.png')
    const f2 = new File(['b'], 'b.png')
    const { load, save } = makeMockLoaders({ 'o-1': f1, 'o-2': f2 })

    const out = await cloneNodeMedia(
      { outputMediaIds: { 'image-out': 'o-1', 'image-out-1': 'o-2' } },
      { load, save },
    )

    const map = out.outputMediaIds as Record<string, string>
    expect(Object.keys(map).sort()).toEqual(['image-out', 'image-out-1'])
    expect(map['image-out']).not.toBe('o-1')
    expect(map['image-out-1']).not.toBe('o-2')
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('dedupes: same id appearing in mediaId and outputMediaIds clones only once', async () => {
    const file = new File(['same'], 'a.png')
    const { load, save } = makeMockLoaders({ 'shared': file })

    const out = await cloneNodeMedia(
      { mediaId: 'shared', outputMediaIds: { 'image-out': 'shared' } },
      { load, save },
    )

    expect(save).toHaveBeenCalledTimes(1)
    const map = out.outputMediaIds as Record<string, string>
    expect(map['image-out']).toBe(out.mediaId)
  })

  it('keeps original id when loadMedia returns null (orphan reference)', async () => {
    const { load, save } = makeMockLoaders({})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await cloneNodeMedia({ mediaId: 'orphan' }, { load, save })

    expect(out.mediaId).toBe('orphan')
    expect(save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('passes through unrelated fields unchanged', async () => {
    const { load, save } = makeMockLoaders({})

    const out = await cloneNodeMedia(
      { prompt: 'hello', selectedModel: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9' },
      { load, save },
    )

    expect(out.prompt).toBe('hello')
    expect(out.selectedModel).toBe('gemini-3.1-flash-image-preview')
    expect(out.aspectRatio).toBe('16:9')
  })

  it('returns a new object without mutating the input', async () => {
    const { load, save } = makeMockLoaders({})
    const input = { mediaId: 'orphan', other: 'x' }

    const out = await cloneNodeMedia(input, { load, save })

    expect(out).not.toBe(input)
    expect(input.mediaId).toBe('orphan')
  })

  it('handles missing media-ref fields gracefully (empty data)', async () => {
    const { load, save } = makeMockLoaders({})

    const out = await cloneNodeMedia({}, { load, save })

    expect(out).toEqual({})
    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/mediaStore.test.ts`
Expected: FAIL — `cloneNodeMedia` is not exported from `./mediaStore`.

- [ ] **Step 3: Implement `cloneNodeMedia` in `mediaStore.ts`**

Append to `frontend/src/mediaStore.ts`:

```ts
// ── Clone Node Media (for duplicate/paste) ───────────────────────────────────

export interface CloneLoaders {
  load: (id: string) => Promise<File | null>
  save: (id: string, file: File) => Promise<void>
}

const DEFAULT_CLONE_LOADERS: CloneLoaders = {
  load: loadMedia,
  save: saveMediaForProject,
}

/**
 * Clone every media-ref field inside `node.data` to fresh ids in IndexedDB.
 * Used by ctxDuplicate / ctxPaste so cloned nodes own independent blobs.
 *
 * Recognised fields: `mediaId`, `historyIds[]`, `frameIds[]`, `outputMediaIds{}`.
 * Other fields pass through unchanged.
 *
 * Dedup: an id appearing in multiple fields clones only once per call.
 * Orphan ids (load returns null) are kept as-is with a console warning.
 */
export async function cloneNodeMedia(
  data: Record<string, unknown>,
  loaders: CloneLoaders = DEFAULT_CLONE_LOADERS,
): Promise<Record<string, unknown>> {
  const cache = new Map<string, Promise<string>>()

  function cloneOne(oldId: string): Promise<string> {
    const existing = cache.get(oldId)
    if (existing) return existing
    const promise = (async () => {
      const file = await loaders.load(oldId)
      if (!file) {
        console.warn(`[cloneNodeMedia] orphan id, keeping original: ${oldId}`)
        return oldId
      }
      const newId = generateMediaId()
      await loaders.save(newId, file)
      return newId
    })()
    cache.set(oldId, promise)
    return promise
  }

  const out: Record<string, unknown> = { ...data }

  if (typeof data.mediaId === 'string') {
    out.mediaId = await cloneOne(data.mediaId)
  }

  if (Array.isArray(data.historyIds)) {
    out.historyIds = await Promise.all(
      data.historyIds.map(id => typeof id === 'string' ? cloneOne(id) : Promise.resolve(id)),
    )
  }

  if (Array.isArray(data.frameIds)) {
    out.frameIds = await Promise.all(
      data.frameIds.map(id => typeof id === 'string' ? cloneOne(id) : Promise.resolve(id)),
    )
  }

  if (data.outputMediaIds && typeof data.outputMediaIds === 'object' && !Array.isArray(data.outputMediaIds)) {
    const oldMap = data.outputMediaIds as Record<string, unknown>
    const entries = await Promise.all(
      Object.entries(oldMap).map(async ([key, value]) =>
        typeof value === 'string' ? [key, await cloneOne(value)] as const : null,
      ),
    )
    out.outputMediaIds = Object.fromEntries(
      entries.filter((e): e is readonly [string, string] => e !== null),
    )
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/mediaStore.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Run full frontend test suite to verify no regressions**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (115 + 9 new = 124+).

---

### Task 2: Wire `cloneNodeMedia` into `ctxDuplicate` and `ctxPaste`

**Files:**
- Modify: `frontend/src/hooks/useCanvasContextMenuActions.ts`

**Why no automated test:** these callbacks operate on React Flow store state; integration testing requires a `<ReactFlowProvider>` harness and mocked store. The end-to-end behavior is verified manually in Task 9 (browser smoke). The pure piece — `cloneNodeMedia` — is already covered by Task 1.

- [ ] **Step 1: Update `ctxDuplicate` to be async and call `cloneNodeMedia`**

Open `frontend/src/hooks/useCanvasContextMenuActions.ts`. At the top, import `cloneNodeMedia`:

```ts
import { cloneNodeMedia } from '../mediaStore'
```

Replace the existing `ctxDuplicate` (around line 77-87) with:

```ts
  const ctxDuplicate = useCallback(async (nodes: Node[]) => {
    const newNodes = await Promise.all(nodes.map(async n => ({
      ...n,
      id: getNextNodeId(n.type || 'unknown'),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      selected: true,
      data: await cloneNodeMedia(n.data as Record<string, unknown>),
    })))
    const postNodes = [...getNodes().map(n => ({ ...n, selected: false })), ...newNodes]
    snapshot(postNodes, getEdges())
    setNodes(postNodes)
  }, [getNodes, getEdges, setNodes, snapshot])
```

- [ ] **Step 2: Update `ctxPaste` similarly**

Replace the existing `ctxPaste` (around line 95-115) with:

```ts
  const ctxPaste = useCallback(async () => {
    if (!clipboardRef.current) return
    const { nodes: clipNodes, edges: clipEdges } = clipboardRef.current
    const idMap: Record<string, string> = {}
    const newNodes = await Promise.all(clipNodes.map(async n => {
      const newId = getNextNodeId(n.type || 'unknown')
      idMap[n.id] = newId
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
        data: await cloneNodeMedia(n.data as Record<string, unknown>),
      }
    }))
    const newEdges = clipEdges.map(e => ({
      ...e,
      id: `e-${idMap[e.source]}-${idMap[e.target]}-${Date.now()}`,
      source: idMap[e.source] ?? e.source,
      target: idMap[e.target] ?? e.target,
    }))
    const postNodes = [...getNodes().map(n => ({ ...n, selected: false })), ...newNodes]
    const postEdges = [...getEdges(), ...newEdges]
    snapshot(postNodes, postEdges)
    setNodes(postNodes)
    setEdges(postEdges)
  }, [getNodes, getEdges, setNodes, setEdges, snapshot, clipboardRef])
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

Note: callers of `ctxDuplicate`/`ctxPaste` (CanvasContextMenu, FlowCanvas, SubnetEditorInner, useKeyboardShortcuts) invoke them as fire-and-forget callbacks. No caller awaits the return — the new async signature is compatible.

- [ ] **Step 4: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — no regressions.

---

### Task 3: Commit fork eager

- [ ] **Step 1: Stage and commit**

```bash
git add frontend/src/mediaStore.ts frontend/src/mediaStore.test.ts frontend/src/hooks/useCanvasContextMenuActions.ts
git commit -m "$(cat <<'EOF'
[fix] duplicate/paste — fork mediaId blobs in IDB

Cloned nodes now own independent IndexedDB blobs (mediaId, historyIds,
frameIds, outputMediaIds) instead of aliasing the source. Closes the
"always linked" alias bug across all media-owning nodes (Image, Generate
Image, Generate Video, Batch, Image FX).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify commit landed**

Run: `git log -1 --oneline`
Expected: most recent commit is the fork eager fix.

---

## Commit 2 — Image Node Proxy Passthrough

### Task 4: Replace adoption useEffect with proxy useEffect in `useImageUpload.ts`

**Files:**
- Modify: `frontend/src/nodes/image-upload/useImageUpload.ts`

**Why this design:** the existing reactive selector for `incomingMediaId` (lines 140-152) is correct and stays. Only the *side effect* changes: instead of writing to `data.mediaId` (which created the alias), we write to `data.outputMediaIds['image-out']`. Downstream nodes already read `outputMediaIds` ahead of `mediaId` (verified in `useGenerateImage.ts:391`, `subnet-output.test.ts:121`), so this transparently mirrors upstream.

- [ ] **Step 1: Replace the adoption useEffect (lines 154-157)**

Open `frontend/src/nodes/image-upload/useImageUpload.ts`. Find the block:

```ts
  useEffect(() => {
    if (!incomingMediaId || incomingMediaId === data.mediaId) return
    updateNodeData(id, { mediaId: incomingMediaId })
  }, [incomingMediaId]) // eslint-disable-line react-hooks/exhaustive-deps
```

Replace with:

```ts
  // Proxy passthrough: when image-in is connected, mirror upstream via
  // outputMediaIds. Never touch data.mediaId — preserves the node's own
  // image so disconnect restores it.
  useEffect(() => {
    const currentOut = (data as { outputMediaIds?: Record<string, string> | null }).outputMediaIds
    if (incomingMediaId) {
      if (currentOut?.['image-out'] === incomingMediaId) return
      updateNodeData(id, { outputMediaIds: { 'image-out': incomingMediaId } })
    } else if (currentOut) {
      updateNodeData(id, { outputMediaIds: null })
    }
  }, [incomingMediaId]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

---

### Task 5: Update preview useEffect to mirror upstream when proxy

**Files:**
- Modify: `frontend/src/nodes/image-upload/useImageUpload.ts`

- [ ] **Step 1: Replace the preview useEffect (lines 52-64)**

Find the block:

```ts
  // Load media from IndexedDB
  useEffect(() => {
    const mediaId = data.mediaId
    if (!mediaId) return
    let blobUrl: string | null = null
    loadMedia(mediaId).then(file => {
      if (file) {
        fileRef.current = file
        blobUrl = URL.createObjectURL(file)
        setPreview(blobUrl)
      }
    })
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [data.mediaId])
```

This block currently lives BEFORE `incomingMediaId` is declared. Move the `incomingMediaId` selector and the `isProxy` derivation **above** this useEffect. The end ordering should be:

1. `incomingMediaId` selector (existing, around line 141)
2. `isProxy` derived constant (new)
3. Preview useEffect (rewritten below)

Reorder by cutting the `incomingMediaId` block (the `useStore` and the immediately-prior comment) and pasting it just below `const fileRef = useRef<File | null>(null)` (around line 18). Then add:

```ts
  const isProxy = !!incomingMediaId
```

Now replace the preview useEffect with:

```ts
  // Source of truth for the preview: upstream blob if proxy mode active,
  // otherwise the node's own media. Switches transparently on connect/disconnect.
  const previewMediaId = incomingMediaId ?? data.mediaId
  useEffect(() => {
    if (!previewMediaId) {
      setPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      fileRef.current = null
      return
    }
    let blobUrl: string | null = null
    let cancelled = false
    loadMedia(previewMediaId).then(file => {
      if (cancelled) return
      if (file) {
        fileRef.current = file
        blobUrl = URL.createObjectURL(file)
        setPreview(blobUrl)
      }
    })
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [previewMediaId])
```

Note: the existing standalone cleanup useEffect at lines 66-70 (revokes preview on unmount) becomes redundant — `previewMediaId` change already revokes inside the cleanup. Delete:

```ts
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])
```

- [ ] **Step 2: Run TypeScript check + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no TS errors, all tests pass.

---

### Task 6: Gate handlers + expose `isProxy` from the hook

**Files:**
- Modify: `frontend/src/nodes/image-upload/useImageUpload.ts`

- [ ] **Step 1: Add `isProxy` to the return object**

Find the `return { ... }` block at the bottom of `useImageUpload`. Add `isProxy` to the returned object (alongside `preview`, `dragging`, etc.):

```ts
  return {
    preview,
    isProxy,
    dragging,
    inputRef,
    dragHandlers,
    onInputChange,
    openPicker,
    showCtxMenu,
    setShowCtxMenu,
    handlePreviewClick,
    handleCtxSplit,
    handleCtxCrop,
    handleCtxCopy,
    handleCtxDuplicate,
    cropOverlay,
    splitOverlay,
    fileRef,
  }
```

(The component will gate behavior on `isProxy` in Task 7. We expose the flag rather than swap handlers inside the hook so the component owns the UI policy.)

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (consumer adoption happens in Task 7).

---

### Task 7: Update `ImageUploadNode.tsx` — gate UI in proxy mode + show badge

**Files:**
- Modify: `frontend/src/nodes/image-upload/ImageUploadNode.tsx`

- [ ] **Step 1: Destructure `isProxy` from the hook**

Find the destructure (around line 62-68):

```tsx
  const {
    preview, dragging, inputRef, dragHandlers, onInputChange, openPicker,
    showCtxMenu, setShowCtxMenu, handlePreviewClick,
    handleCtxSplit, handleCtxCrop, handleCtxCopy, handleCtxDuplicate,
    cropOverlay, splitOverlay,
  } = useImageUpload(id, data, selected)
```

Add `isProxy`:

```tsx
  const {
    preview, isProxy, dragging, inputRef, dragHandlers, onInputChange, openPicker,
    showCtxMenu, setShowCtxMenu, handlePreviewClick,
    handleCtxSplit, handleCtxCrop, handleCtxCopy, handleCtxDuplicate,
    cropOverlay, splitOverlay,
  } = useImageUpload(id, data, selected)
```

- [ ] **Step 2: Gate `renderNormalView` for proxy mode**

Find the `renderNormalView` function (around line 147-175). Replace the function body with a version that:
- Disables `onClick` and drag handlers when `isProxy`.
- Shows a small "proxy" badge on top.
- Hides Crop / Split context menu items when `isProxy` (Copy and Duplicate stay; Duplicate will be removed entirely in Task 8).

```tsx
  function renderNormalView() {
    return (
      <div className={styles.previewArea}
        onClick={isProxy ? undefined : openPicker}
        {...(isProxy ? {} : dragHandlers)}
        style={{ position: 'relative', ...(dragging ? { borderColor: '#3b82f6' } : undefined) }}>
        {preview
          ? <img src={preview} alt={isProxy ? 'proxy preview' : 'uploaded'} className={styles.previewImg}
              onClick={handlePreviewClick} style={{ cursor: 'pointer' }} />
          : <span className={styles.dropHint}>{isProxy ? 'proxy: no upstream image' : 'Click or drag an image'}</span>}
        {isProxy && (
          <span style={{
            position: 'absolute', top: 4, left: 4, zIndex: 4,
            fontSize: 10, color: 'var(--text-dim)',
            background: 'rgba(0,0,0,0.5)', padding: '1px 5px', borderRadius: 2,
            pointerEvents: 'none', userSelect: 'none',
          }}>proxy</span>
        )}
        {preview && !isProxy && (
          <>
            <button className={styles.nodeContextBtn} title="Options"
              onClick={e => { e.stopPropagation(); e.preventDefault(); setShowCtxMenu(v => !v) }}>&#x22EE;</button>
            {showCtxMenu && (
              <div className={styles.nodeContextMenu} onPointerDown={e => e.stopPropagation()}>
                <button className={styles.nodeContextItem} onClick={handleCtxCrop}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x2702;</span>Crop</button>
                <button className={styles.nodeContextItem} onClick={handleCtxSplit}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x25A6;</span>Split</button>
                <button className={styles.nodeContextItem} onClick={handleCtxCopy}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x2398;</span>Copy to clipboard</button>
                <button className={styles.nodeContextItem} onClick={handleCtxDuplicate}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x2750;</span>Duplicate</button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }
```

(Duplicate button stays for now — will be removed in Task 8.)

- [ ] **Step 3: Short-circuit overlays when `isProxy` becomes true mid-edit**

If the user opens Crop or Split and *then* connects an upstream `image-in` edge, the overlay would render on top of stale state. Force `renderNormalView` to win when `isProxy`. Find the render block at the bottom of `ImageUploadNode` (around line 182-184):

```tsx
        {cropMode && preview ? renderCropOverlay()
          : splitMode && preview ? renderSplitOverlay()
          : renderNormalView()}
```

Replace with:

```tsx
        {!isProxy && cropMode && preview ? renderCropOverlay()
          : !isProxy && splitMode && preview ? renderSplitOverlay()
          : renderNormalView()}
```

- [ ] **Step 4: Run TypeScript check + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no errors, all tests pass.

---

### Task 8: Remove dead `Duplicate` button + `DUPLICATE_NODE` event

**Files:**
- Modify: `frontend/src/nodes/image-upload/useImageUpload.ts`
- Modify: `frontend/src/nodes/image-upload/ImageUploadNode.tsx`
- Modify: `frontend/src/events/canvasEvents.ts`

- [ ] **Step 1: Remove `handleCtxDuplicate` from `useImageUpload.ts`**

Open `frontend/src/nodes/image-upload/useImageUpload.ts`. Delete the entire `handleCtxDuplicate` callback (around lines 126-130):

```ts
  const handleCtxDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowCtxMenu(false)
    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.DUPLICATE_NODE, { detail: { nodeId: id } }))
  }, [id])
```

Remove `handleCtxDuplicate` from the return object (around line 172).

If `CANVAS_EVENTS` is no longer used elsewhere in the file (verify with a search of the file), remove the import:

```ts
import { CANVAS_EVENTS } from '../../events/canvasEvents'
```

- [ ] **Step 2: Remove the Duplicate button from `ImageUploadNode.tsx`**

In `renderNormalView` (modified in Task 7), remove the Duplicate button block:

```tsx
                <button className={styles.nodeContextItem} onClick={handleCtxDuplicate}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x2750;</span>Duplicate</button>
```

Also remove `handleCtxDuplicate` from the destructure at the top of the component (Task 7 step 1).

- [ ] **Step 3: Remove `DUPLICATE_NODE` from `events/canvasEvents.ts`**

Open `frontend/src/events/canvasEvents.ts`. Remove these two lines:

```ts
  /** Duplicate a specific node by ID (dispatched from ImageUploadNode context menu). */
  DUPLICATE_NODE: 'duplicate-node',
```

- [ ] **Step 4: Run TypeScript check + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no errors, all tests pass. If TS reports unused imports anywhere, remove them.

---

### Task 9: Manual browser verification

**Files:** none modified.

This task is a checklist of UI scenarios that cannot be unit-tested without a full React Flow harness. Per `feedback_automation_vs_visual_check.md`: visual verification is reserved for the user (Antonio). These scenarios are the gate for committing.

Start the app: launch `AYCB Studio.bat` from desktop, or run `python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload` and `cd frontend && npm run dev`.

- [ ] **Scenario 1: Duplicate Image with photo → independent**
  1. Add Image node, upload a photo.
  2. Right-click → Duplicate (or Ctrl+D).
  3. On the duplicate, open Crop, drag a tight crop, click Replace.
  4. **Expected:** original Image node still shows the un-cropped photo. Duplicate shows the crop.

- [ ] **Scenario 2: Duplicate Generate Image with history → independent**
  1. Add Generate Image, generate 3 images (history grows to 3).
  2. Duplicate the node.
  3. On the duplicate, click through history thumbnails to a different one — the duplicate's mediaId changes.
  4. **Expected:** original Generate Image's `mediaId` and current preview are unchanged.

- [ ] **Scenario 3: Empty Image + image-in connect → live mirror**
  1. Add a fresh Image node (no upload).
  2. Connect a Generate Image's `image-out` to the Image node's `image-in`.
  3. **Expected:** Image node displays the generated image. Small "proxy" label visible top-left. Drop and click-to-pick are disabled. Crop/Split context items are absent.
  4. Disconnect.
  5. **Expected:** Image node empty (no preview).

- [ ] **Scenario 4: Image with photo → image-in connect → preserves photo on disconnect**
  1. Add Image node, upload photo A.
  2. Connect upstream image-out (different image B) to Image node's image-in.
  3. **Expected:** preview switches to image B. "proxy" badge visible.
  4. Disconnect.
  5. **Expected:** preview returns to image A. No badge.

- [ ] **Scenario 5: Drop file during proxy → blocked**
  1. With image-in connected, drag-drop a file onto the Image node.
  2. **Expected:** no upload occurs. The proxy preview remains.

- [ ] **Scenario 6: Output mirrors upstream**
  1. Image node in proxy mode (image-in connected to Generate Image showing image B).
  2. Connect Image's `image-out` to a downstream Generate Image's `image-0`.
  3. Run downstream Generate Image.
  4. **Expected:** downstream uses image B as reference (visible in the request payload via DevTools Network tab, or in the generated output).

- [ ] **Scenario 7: Saved canvas → reload → proxy mode reactivates**
  1. Set up Scenario 3 (proxy active). Wait for autosave (or trigger via SaveIndicator).
  2. Reload page (Ctrl+R).
  3. **Expected:** Image node returns in proxy mode, badge visible, preview shows upstream.

If any scenario fails, do NOT commit. Investigate root cause via `superpowers:systematic-debugging`.

---

### Task 10: Commit proxy passthrough + cleanup

- [ ] **Step 1: Stage and commit**

```bash
git add frontend/src/nodes/image-upload/useImageUpload.ts \
        frontend/src/nodes/image-upload/ImageUploadNode.tsx \
        frontend/src/nodes/image-upload/node.manifest.ts \
        frontend/src/nodes/image-upload/image-upload.test.ts \
        frontend/src/events/canvasEvents.ts
git commit -m "$(cat <<'EOF'
[feat] image node — image-in proxy passthrough + UI lock + cleanup

Image-in connection now mirrors upstream via outputMediaIds without
touching data.mediaId — connect/disconnect preserves the node's own
image. Crop/Split/Replace and drop-to-upload are gated off during proxy
mode. Removes the dead Duplicate button (DUPLICATE_NODE event had no
listener); duplication remains via canvas right-click and Ctrl+D, now
backed by fork-eager from the previous commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Note: the manifest and test files for image-upload already had the `image-in` slot added in pending modifications before this plan started. They're staged as part of this commit.

- [ ] **Step 2: Verify both commits in log**

Run: `git log --oneline -3`
Expected: top two commits are the fork-eager fix and this proxy commit, in order.

---

## Done Criteria

- [ ] All vitest tests pass (115 existing + 9 new = 124+).
- [ ] `npx tsc --noEmit` passes.
- [ ] All 7 manual scenarios in Task 9 pass.
- [ ] Two commits on `dev` branch with the messages above.
- [ ] No remaining references to `DUPLICATE_NODE` or `handleCtxDuplicate` in the codebase (`grep -r DUPLICATE_NODE frontend/src` returns empty).
