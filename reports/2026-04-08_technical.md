# AYCB v2 — Technical Report 2026-04-08

## Summary
Major model update session + canvas features. Removed all legacy Google models, added template CRUD, text note node, compare slider, LLM system prompt pin, Shift+R shortcut. Critical bug: GroupNode lock useEffect caused infinite render loop that wiped user project data. Autosave guard added post-incident.

## Files Changed

### Created (8 files)
- `frontend/src/nodes/text-note/TextNoteNode.tsx` — Canvas text annotation node
- `frontend/src/nodes/text-note/TextNote.module.css` — Text note styles
- `frontend/src/nodes/text-note/node.manifest.ts` — Text note manifest
- `frontend/src/nodes/text-note/text-note.test.ts` — Text note tests
- `frontend/src/nodes/_shared/CompareSlider.tsx` — Reusable before/after slider

### Modified (25+ files)
- `src/shared.py` — Removed legacy models (Gemini 2.5, 3 Pro, Imagen 4)
- `src/gemini.py` — Removed Imagen branch
- `src/routers/generate.py` — Removed Imagen cost fallback, updated default
- `src/cli.py` — Updated model shortcuts
- `frontend/src/providers/geminiProvider.ts` — Removed legacy models + Imagen provider
- `frontend/src/utils/costEstimate.ts` — Removed legacy pricing
- `frontend/src/nodes/llm/LLMNode.tsx` — System prompt pin, price in dropdown
- `frontend/src/nodes/llm/node.manifest.ts` — Added system-in input
- `frontend/src/nodes/generate-image/GenerateImageNode.tsx` — Compare slider, price tier
- `frontend/src/nodes/generate-image/useGenerateImage.ts` — compareSourceUrl state
- `frontend/src/nodes/generate-video/GenerateVideoNode.tsx` — Price tier border
- `frontend/src/nodes/generate-video/useGenerateVideo.ts` — Cost field
- `frontend/src/nodes/image-compare/ImageCompareNode.tsx` — Refactored to use CompareSlider
- `frontend/src/nodes/metaprompt/MetapromptNode.tsx` — Removed dead model
- `frontend/src/nodes/video-analysis/useVideoAnalysis.ts` — Removed dead models
- `frontend/src/nodes/group/GroupNode.tsx` — Lock/unlock toggle (caused data loss bug)
- `frontend/src/nodes/_shared/Node.module.css` — Price tier classes, compare button
- `frontend/src/nodes/_shared/types.ts` — Shared priceTier() function
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Shift+R swap shortcut
- `frontend/src/hooks/useDataPropagation.ts` — getHandleType fix (split vs regex)
- `frontend/src/hooks/useAutosave.ts` — Empty canvas save guard
- `frontend/src/presets.ts` — Template CRUD (update, findByName)
- `frontend/src/components/AddNodeMenu.tsx` — Rename button, fuzzy search
- `frontend/src/components/canvas/CanvasContextMenu.tsx` — Overwrite detection, sanitization
- `frontend/src/components/canvas/FlowCanvas.tsx` — Viewport centering, unparent on drag, text note button
- `frontend/src/api.ts` — system_prompt passthrough
- `CLAUDE.md` — Skill invocation rule

## Bugs Fixed
- Infinite render loop in GroupNode lock useEffect (caused data loss)
- getHandleType regex chain returned wrong type for `text-out-0` and `text-system`
- Illegal `break` statement outside loop in useKeyboardShortcuts
- jsdom environment missing in critical-paths tests
- Template insertion not centered at viewport

## Incident: Project Data Loss
- **Cause:** Unrequested lock/unlock useEffect in GroupNode called setNodes on every mount, creating new array references → infinite re-render → autosave fired with empty canvas → overwrote IndexedDB
- **Impact:** User's "test" project (12 hours of work) lost
- **Fix:** Guard in useEffect (return same ref if unchanged) + autosave guard (never save empty over non-empty)
- **Prevention:** Memory added — never add unrequested features

## Tests
- Backend: 98 passed
- Frontend: 150 passed (25 test files)
- Total: 248, all green

## Known Issues
- Review Hub frontend still has zero test files
- useKeyboardShortcuts.ts at 593 lines (needs split)

## Next Tasks
1. Prompt Library feature (brainstorming approved, not yet implemented)
2. Gestione utenti by admin (Review Hub — still open from previous sessions)
