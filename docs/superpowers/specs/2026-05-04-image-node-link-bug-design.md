# Image Node "Always Linked" Bug — Design Spec

**Date:** 2026-05-04
**Status:** Approved, ready for implementation plan

## Context

The Image node (`image-upload`) and other nodes that own media (`generate-image`, `generate-video`, `batch`, `image-fx`) reference blob storage in IndexedDB by `mediaId`. Several recent changes plus pre-existing behavior caused every "create another instance" path to produce an **alias** (same `mediaId`) instead of an independent node:

- **Duplicate / Paste:** `ctxDuplicate` and `ctxPaste` in `useCanvasContextMenuActions.ts` shallow-copy `node.data`, so cloned nodes share `mediaId`, `historyIds`, `frameIds`, `outputMediaIds`. Editing one node mutates the IDB record and the original changes too.
- **`image-in` reactive adoption** (uncommitted on `dev`): a new input slot on the Image node makes downstream nodes adopt the upstream's `mediaId` directly. Disconnect doesn't clear the adopted id, and `pickFile`/crop reuse it, overwriting the upstream blob.
- **Dead code:** the Image node's context menu has a "Duplicate" button that dispatches `CANVAS_EVENTS.DUPLICATE_NODE`, but no listener exists.

User-visible symptom: every copy of an Image node (and similarly Generate Image, etc.) behaves as a link — modifying one modifies the other.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Was `image-in` intended on the Image node? | Yes — keep it, but as a **passthrough proxy** (B). |
| Duplicate/paste semantics | **Fork eager** (A). Clone blobs in IDB at duplicate time. |
| `image-in` connect when node already has an image | **Hide-but-preserve** (B). `data.mediaId` retained; preview shows upstream while connected; disconnect restores original. |
| Output during proxy mode | **Mirror upstream** (A). `image-out` emits the upstream `mediaId`. |
| Scope | Universal — fix duplicate/paste for **all** nodes with media-ref fields, not just Image. |

## Architecture

### Two independent fixes

1. **Universal fork-eager helper** in `mediaStore.ts` invoked from `ctxDuplicate` and `ctxPaste`. Clones every media-ref field inside `node.data`.
2. **Proxy passthrough mode** in the Image node's `useImageUpload` hook. Activated when `image-in` has an incoming edge.

The two fixes are concept-independent and ship in separate commits but land together.

### Fork-eager helper

New export in `frontend/src/mediaStore.ts`:

```ts
export async function cloneNodeMedia(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>>
```

Behavior:

- Scans `data` for four known media-ref fields:
  - `mediaId: string`
  - `historyIds: string[]`
  - `frameIds: string[]`
  - `outputMediaIds: Record<string, string>`
- For each unique id, runs `loadMedia(oldId) → generateMediaId() → saveMediaForProject(newId, file)`.
- Maintains a `Map<oldId, newId>` for the duration of one call so duplicate ids inside the same node (e.g., `outputMediaIds['image-out'] === mediaId`) clone only once.
- Returns a new `data` object with the four fields rewritten to the new ids. Other fields are passed through unchanged.
- If `loadMedia(oldId)` returns `null` (orphan id), keeps the original id and logs a `console.warn`. Does **not** throw — duplicate must not abort because of stale references.

### Integration into duplicate/paste

`frontend/src/hooks/useCanvasContextMenuActions.ts`:

- `ctxDuplicate` becomes `async`. Before `setNodes`, awaits `Promise.all(nodes.map(n => cloneNodeMedia(n.data)))` and uses the cloned data for the new nodes. The `getNextNodeId` and position-offset logic stay unchanged.
- `ctxPaste` becomes `async`. Same treatment for clipboard nodes.
- Snapshot is still recorded once at the end, so undo restores the canvas (the cloned blobs in IDB are not undone — they are accepted as a small cost of fork eager, evicted later by `enforceStorageCap` if needed).

### Proxy passthrough mode (Image node)

Existing reactive selector in `useImageUpload.ts:140-152` (`incomingMediaId`) is the entry point. The `useEffect` that wrote `incomingMediaId` into `data.mediaId` is **replaced** with new logic:

```ts
const isProxy = !!incomingMediaId

useEffect(() => {
  if (isProxy) {
    updateNodeData(id, { outputMediaIds: { 'image-out': incomingMediaId } })
  } else if (data.outputMediaIds) {
    updateNodeData(id, { outputMediaIds: null })
  }
}, [incomingMediaId])
```

`data.mediaId` is **never** written from this code path — the node's "owned" image is preserved across connect/disconnect.

Preview rendering (existing `useEffect` at `useImageUpload.ts:52-64`) is updated to choose source:

```ts
const previewMediaId = isProxy ? incomingMediaId : data.mediaId
useEffect(() => {
  if (!previewMediaId) return
  // existing loadMedia → blob URL → setPreview logic
}, [previewMediaId])
```

UI gates while `isProxy`:

- `dragHandlers` and `openPicker` are replaced with no-ops (returned by `useImageUpload` based on `isProxy`).
- Context menu items Crop, Split, Replace are hidden. Copy-to-clipboard remains (non-destructive).
- A small grey "proxy" label rendered above the preview (1 line, low contrast) — visual feedback that the node is mirroring an upstream.

### Cleanup

- Remove `handleCtxDuplicate` callback from `useImageUpload.ts`.
- Remove the "Duplicate" button from `ImageUploadNode.tsx`'s in-node context menu.
- Remove `DUPLICATE_NODE` from `events/canvasEvents.ts` (only referenced by the dead handler being removed).
- Drop the unused `CANVAS_EVENTS` import in `useImageUpload.ts` if it becomes unused after cleanup.

## Data flow

**Normal (no image-in):**
- `data.mediaId` → IDB blob → preview & `image-out` (via existing propagation).

**Proxy mode (image-in connected):**
- React Flow store → `incomingMediaId` selector → `useEffect` writes `outputMediaIds['image-out']` → downstream sees upstream id.
- Preview reads upstream blob via `loadMedia(incomingMediaId)`.
- `data.mediaId` unchanged.

**Disconnect:**
- `incomingMediaId` becomes `null`.
- `useEffect` clears `outputMediaIds`.
- Preview falls back to `data.mediaId`. If the node had no own image, preview is empty.

**Duplicate/paste:**
- `cloneNodeMedia(n.data)` runs ahead of `setNodes`. New ids point to fresh IDB blobs. Originals untouched.

## Error handling

- `loadMedia` returning `null` during clone: log warning, keep original id, continue. The duplicate may have a broken reference to the same orphan as the source — same situation as before, no regression.
- `saveMediaForProject` failure during clone: bubbles up, the duplicate operation aborts. Clones already written are not rolled back; `enforceStorageCap` will evict them if storage fills. Acceptable tradeoff vs. transactional complexity.
- `image-in` connected to a node with no `mediaId` and no `outputMediaIds`: `incomingMediaId` returns `null`, proxy mode does not activate. Same as no connection.

## Testing

### Automated (vitest)

- Update `frontend/src/nodes/image-upload/image-upload.test.ts` for the new manifest (label `Image`, one input). Already partially done in pending changes.
- New `frontend/src/mediaStore.test.ts` covering `cloneNodeMedia`:
  - Single `mediaId` clones to new id with same blob bytes.
  - `historyIds[]` clones each id, preserves order.
  - `frameIds[]` clones each id, preserves order.
  - `outputMediaIds{}` clones each value, preserves keys.
  - De-dup: `mediaId === outputMediaIds['image-out']` → only one IDB write.
  - Orphan id (`loadMedia` returns null): keeps original id, no throw.
  - Uses `fake-indexeddb` for isolation.

### Manual (browser, Antonio)

After both commits land:

1. Duplicate an Image node with a photo → crop the duplicate → original unchanged.
2. Duplicate a Generate Image with a 3-image history → delete history on the duplicate → original history intact.
3. Connect an upstream Generate Image to a fresh Image node's `image-in` → see upstream live; "proxy" label visible; crop menu items hidden.
4. Disconnect the proxy → Image node empty.
5. Image node with own photo → connect `image-in` → see upstream; disconnect → photo returns.
6. While in proxy mode, drop a file on the node → no-op.
7. Connect Image (proxy) → another Generate Image's `image-0` → downstream receives upstream live.

## Out of scope

- Reference counting or copy-on-write — explicitly rejected in favor of fork eager.
- `pickFile` ownership tracking — current "overwrite same `mediaId`" is correct given fork eager keeps every node's id distinct.
- Subnet input/output behavior — covered by recent commit `bbeabd6` and unrelated to media aliasing.
- Refactor of `useImageUpload.ts` size or structure — file stays well under the 300-line cap after these changes.

## Commit plan

Two commits, both ship together:

1. `[fix] duplicate/paste — fork mediaId blobs in IDB (close alias bug across all media nodes)`
   - `mediaStore.ts`: add `cloneNodeMedia`.
   - `useCanvasContextMenuActions.ts`: `ctxDuplicate` and `ctxPaste` become async, call `cloneNodeMedia`.
   - `mediaStore.test.ts`: new test file.

2. `[feat] image node — image-in proxy passthrough + UI lock + cleanup`
   - `useImageUpload.ts`: replace adoption useEffect with proxy useEffect (writes `outputMediaIds`), gate `dragHandlers`/`openPicker`, remove `handleCtxDuplicate`.
   - `ImageUploadNode.tsx`: hide Crop/Split/Replace context items in proxy mode, add proxy label, remove Duplicate button.
   - `events/canvasEvents.ts`: remove `DUPLICATE_NODE`.
   - `image-upload.test.ts`: keep updated manifest expectations.
