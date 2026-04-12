# AYCB v2 — Technical Report 2026-04-12

## Summary
UI bug fixes and UX improvements: arrow nav in fullscreen gallery, favorite management overhaul, node copy history stripping, ConsolePanel sliding bug, and collapsible text/preview panels in JSON Parser and Bracket Parser. Commit: `884fb0e` (47 files, includes subnet/pre-comp implementation from prior session).

---

## Bugs Fixed

### 1. Fullscreen gallery arrow nav — `GenerateImageNode.tsx`
**Root cause:** Gallery guard used `urls.length > 1`, but `historyThumbs` (the URLs) is lazily loaded only when `historyExpanded === true`. When the history grid is collapsed, `urls` is empty even if multiple history items exist.
**Fix:** Changed guard to `h.historyIds.length > 1`. `historyIds` is always populated from node data; `loadGalleryFullSrc` loads images from IndexedDB on demand.

### 2. Favorite management — `MediaPreview.tsx` + `MediaInfoPanel.tsx`
Three layered bugs:
- `onFavoriteToggle` wrapper ignored the `id` argument — fixed by using `(id) => { void handleFavoriteToggle(id) }`
- Gallery entries had no review status loaded — new `useEffect` fetches statuses for ALL `mediaIds` in the gallery, not just the current entry
- Favorite button was hidden when item had no review status — moved button BEFORE the `reviewBadge` conditional

### 3. Node copy carries history — `useKeyboardShortcuts.ts`
**Root cause:** `cloneNodesAndEdges` spread all `node.data` including runtime outputs.
**Fix:** Added `CLONE_STRIP` set (`result`, `analysisHistory`, `last_preview_b64`) + generator-type detection via presence of `historyIds` in data → strips `historyIds` and `mediaId`. Upload nodes keep their `mediaId`.

### 4. ConsolePanel UI sliding bug — `ConsolePanel.tsx`
**Root cause 1:** `scrollIntoView({ behavior: 'smooth' })` was called on sentinel divs. Per CSSOM View spec, smooth scroll propagates to ALL ancestor scroll containers, including `overflow: hidden` ones (`.splitBody`, `.consoleWrap`). This visibly slid the layout.
**Fix:** Replaced 5 `xxxBottomRef.current?.scrollIntoView({ behavior: 'smooth' })` effects with direct `el.scrollTop = el.scrollHeight` on the correct container ref (`consoleBodyRef`, `fbListRef`). Removed 5 sentinel divs.

**Root cause 2:** `useNodes()` subscribes to the entire nodes array, causing ConsolePanel to re-render 60×/sec during node drags.
**Fix:** Replaced with `useStore(s => s.nodes.find(n => n.selected) ?? null)`.

---

## Feature: Collapsible text panels — `JsonParserNode.tsx` + `BracketParserNode.tsx`
- **JSON Parser**: "Hide/Show Preview" toggle for colorized output area + "Hide/Show Text" for manual textarea
- **Bracket Parser**: "Hide/Show Text" for manual textarea (output preview already had collapse)
- State persisted in node data (`previewCollapsed`, `textCollapsed` / `text_collapsed`)
- Types updated in `types.ts`

---

## Files Changed (this session)

| File | Change |
|---|---|
| `frontend/src/nodes/generate-image/GenerateImageNode.tsx` | Gallery guard: `urls.length` → `historyIds.length` |
| `frontend/src/components/media/MediaPreview.tsx` | Fetch all gallery review statuses; fix favorite toggle wrapper |
| `frontend/src/components/media/MediaInfoPanel.tsx` | Favorite button always visible; DL entry hidden when button active |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | `cloneNodesAndEdges`: strip history/result from generator nodes |
| `frontend/src/components/console/ConsolePanel.tsx` | `scrollIntoView` → `scrollTop`; `useNodes()` → `useStore` selector |
| `frontend/src/nodes/json-parser/JsonParserNode.tsx` | Add previewCollapsed + textCollapsed toggles |
| `frontend/src/nodes/json-parser/useJsonParser.ts` | Add `previewCollapsed`, `textCollapsed` state |
| `frontend/src/nodes/bracket-parser/BracketParserNode.tsx` | Add textCollapsed toggle for manual textarea |
| `frontend/src/nodes/bracket-parser/useBracketParser.ts` | Add `textCollapsed` state |
| `frontend/src/types.ts` | Add `previewCollapsed`, `textCollapsed` to JsonParserNodeData; `text_collapsed` to BracketParserNodeData |

---

## Key Technical Learnings

### `scrollIntoView` propagation bug
`element.scrollIntoView({ behavior: 'smooth' })` per CSSOM View spec scrolls **all** scrollable ancestors, including `overflow: hidden` containers (they temporarily get non-zero `scrollTop`). This caused ConsolePanel and other panels to "slide". **Rule: always use `el.scrollTop = el.scrollHeight` for programmatic scroll-to-bottom. Never use `scrollIntoView` for this purpose.**

### `useNodes()` re-render storm
`useNodes()` from `@xyflow/react` creates a subscription to the entire nodes array. Any node position change (drag) triggers a re-render on every subscriber. In performance-sensitive components (panels, sidebars), use `useStore(s => s.nodes.find(...))` with a targeted selector instead.

### Feedback file location
Urgent feedback is saved to disk at `feedback/urgent.json` in the project root. Readable directly without browser DevTools. All feedback saved to `feedback/all.json`.

---

## Tests
- Frontend: 273 passed (38 files)
- Backend: unchanged

---

## Urgent Feedback — Remaining Open
From `feedback/urgent.json` (resolved this session: favorite, nav):

- `[bug]` when ctrl+alt drag to copy, original must stay — copy is dragged (`fb_1775937376675`)
- `[bug]` navigation in full screen doesnt work — FIXED this session
- `[ux]` collapse text panel in json/bracket parser — FIXED this session
- `[idea]` input pin for bracket editing — done (bracketParser input pins)
- `[bug]` issue with selection — needs investigation
- `[bug]` when template insert keep multi selection active
- `[bug]` 2k default resolution
- `[bug]` pricing in dropdown

## Next Tasks
1. Ctrl+Alt drag copy: original should stay in place, copy gets dragged (`useKeyboardShortcuts.ts`)
2. 2k default resolution in Generate Image
3. Pricing display in model dropdown
4. Selection issue investigation
