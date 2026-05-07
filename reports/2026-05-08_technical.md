# AYCB v2 — Technical Report 2026-05-08

## Summary
Fixed a keyboard-handler bug in the fullscreen text editor: Backspace
inside the editable textarea closed the panel instead of deleting
characters. Added a Ctrl/Cmd+Enter shortcut that saves (when editable)
and closes.

---

## Bug Fixed

### Backspace closed fullscreen text panel — `MediaPreview.tsx`

**Root cause:** The text-mode keyboard handler in
`MediaPreviewProvider` (lines 166-182) was attached at the document
level with `useCapture: true`. The Backspace branch
(`if (e.key === 'Backspace') { e.preventDefault(); close() }`) ran
before the textarea could process the keystroke, so character-delete
inside the editable textarea immediately closed the panel.

The Space handler one line below already had the correct guard
(skip when target is `INPUT`/`TEXTAREA`); Backspace was missing the
same guard.

**Fix:** Hoisted the `tag` / `inEditor` check to the top of the
handler so all close-on-key branches share it. Backspace now closes
only when `!inEditor`. Esc still closes unconditionally.

---

## Feature Added

### Ctrl/Cmd+Enter saves and closes — `MediaPreview.tsx`

When the panel is editable (`media.onEdit` provided), Ctrl+Enter or
Cmd+Enter calls `onEdit(editText)` and `close()`. Plain Enter is
unchanged (inserts a newline in the textarea, the browser default).
The bottom hint switches to `Esc to close · Ctrl+Enter to save` in
editable mode; read-only hint is unchanged.

The handler closes over `editText` so the effect deps grew to
`[media, close, editText]`. This forces re-attach on every keystroke
(small cost: one `removeEventListener` + `addEventListener` per
character), acceptable here since the panel is short-lived and the
handler is small. Could be optimized later via a ref if needed.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/components/media/MediaPreview.tsx` | Hoist `inEditor` guard, gate Backspace on `!inEditor`, add Ctrl/Cmd+Enter save+close, conditional hint text. |

---

## Tests
- 47 test files, 350 tests pass (no new tests for this fix —
  document-level capture handlers are awkward to test in jsdom; the
  fix is a one-line guard mirroring an existing working pattern in
  the same handler).
- `npx tsc --noEmit` clean.

## Known Issues
- Antonio noted at end of session that the right-click Merge popup
  feels too plain — no thumbnails, no descriptions, just text +
  badge. Deferred (not implemented this session).

## Next Tasks
1. **Open question / probable next task:** enrich the Merge popup —
   small layout-shape previews (e.g. mini SVG diagrams of grid /
   horizontal / vertical), descriptive text, possibly source-image
   thumbnails. Confirm scope with Antonio before building.
2. Existing backlog: Vertex Imagen edit cleanup, manual Collage
   free-form span-cells, drag-to-copy gestures.
