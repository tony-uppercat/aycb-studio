# AYCB v2 — Technical Report 2026-05-07

## Summary
Added a canvas right-click "Merge" submenu that produces a single
merged image node from a selection of 2+ image-upload nodes. Layout is
chosen via fly-out (Grid / Horizontal / Vertical). The renderer used
by the existing Image Merge node was extracted into a shared util so
both call sites use the same code path.

---

## Feature: Right-click Quick Merge

**Trigger:** Selection right-click when `imageNodes.length >= 2` (same
gating as the existing "Create Collage" entry). Submenu appears next
to "Create Collage" using the existing fly-out `SubMenu` component in
`CanvasContextMenu.tsx`.

**Behavior:** Pick a layout → `runQuickMerge({ mediaIds, layout })`
loads each blob, renders client-side via `renderImageMerge`, persists
the PNG to the media store, and returns the new mediaId.
`FlowCanvas.handleQuickMerge` then appends a new `imageUpload` node at
`(maxRight + 60, avgY)` of the selection's bounding box, marks it
selected, and snapshots the canvas for undo. No Image Merge node is
created; the user does not click Run.

**Defaults for the quick path:**
- `gap = 4`
- `bgColor = 'black'`
- `outputMode = 'auto'` (canvas size derived from largest source image)
- `columns = ceil(sqrt(count))` for grid (square-ish layout)
- Horizontal collapses to 1 row, Vertical to 1 column.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/utils/imageMergeRender.ts` | New — exports `renderImageMerge`, `fileToImage`, `defaultGridColumns`, `LayoutMode`. Lifted from `useImageMerge.ts` so both call sites share one renderer. |
| `frontend/src/utils/imageMergeRender.test.ts` | New — covers `defaultGridColumns` math (1, 2, 4, 5, 9, 10, 16). |
| `frontend/src/services/quickMerge.ts` | New — `runQuickMerge({ mediaIds, layout })` orchestration: load → image → render → save → return `{ mediaId }`. Throws if fewer than 2 loadable images. |
| `frontend/src/services/quickMerge.test.ts` | New — mocks `mediaStore` + `imageMergeRender`, verifies forwarded layout, file naming (`merge-<layout>-<ts>.png`), the <2 guard, and the skip-missing-id path. |
| `frontend/src/nodes/image-merge/useImageMerge.ts` | Imports `fileToImage` + `renderImageMerge` from the new util. Drops the inline renderer (242 → 113 lines). Behavior unchanged. |
| `frontend/src/components/canvas/CanvasContextMenu.tsx` | Adds `onMerge?: (layout, imageNodes) => void` prop and a SubMenu in the selection branch (gated on `canCollage`). Three items: Grid / Horizontal / Vertical, each badged with the image count. |
| `frontend/src/components/canvas/FlowCanvas.tsx` | Imports `runQuickMerge` + `LayoutMode`. New `handleQuickMerge` callback collects mediaIds, runs the service, places a new `imageUpload` node, snapshots for undo. Wired as `onMerge={handleQuickMerge}`. |

---

## Tests
- 47 test files, 350 tests pass (9 new).
- `npx tsc --noEmit` clean.

## Known Issues
- None observed. UI verification deferred to Antonio per his usual workflow.

## Next Tasks
1. Optional: extend the gating from `imageUpload` only to any node that emits an image (image-fx, generate-image, image-merge itself, comparison) — currently the menu mirrors the `Create Collage` rule.
2. Optional: surface gap / bg / size knobs in the popup, or remember the last-chosen settings.
3. Continue with the existing backlog (Vertex Imagen edit cleanup, manual Collage free-form span, drag-to-copy gestures).
