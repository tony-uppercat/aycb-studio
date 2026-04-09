# AYCB v2 — Technical Report 2026-04-09

## Summary
Search grounding, edit mode, resolution-aware cost estimation for Generate Image node. New Image Edit node with Vertex AI Imagen integration. GCP authentication setup.

## Files Changed

### Created (8 files)
- `frontend/src/nodes/image-edit/node.manifest.ts` — Image Edit node manifest
- `frontend/src/nodes/image-edit/ImageEditNode.tsx` — Image Edit component
- `frontend/src/nodes/image-edit/useImageEdit.ts` — Image Edit hook
- `frontend/src/nodes/image-edit/image-edit.test.ts` — Manifest tests
- `src/routers/image_edit.py` — Backend endpoint, Vertex AI client, Gemini+Imagen routing
- `tests/test_image_edit.py` — Backend unit tests
- `docs/superpowers/specs/2026-04-09-image-edit-node-design.md` — Design spec
- `docs/superpowers/plans/2026-04-09-image-edit-node.md` — Implementation plan

### Modified (9 files)
- `src/gemini.py` — Added `use_grounding` param to `generate_image()`, google_search tool
- `src/routers/generate.py` — Added `use_grounding` Form param
- `src/routers/settings.py` — GCP project/location in GET/PUT paths
- `config/settings.py` — Added `gcp_project`, `gcp_location` fields
- `frontend/src/providers/index.ts` — Added `useGrounding` to ImageGenerationOptions
- `frontend/src/providers/geminiProvider.ts` — Added googleSearch tools config
- `frontend/src/api.ts` — Added `use_grounding` in FormData, `editImage()` function
- `frontend/src/nodes/generate-image/useGenerateImage.ts` — useGrounding, editMode state, resolution-aware cost
- `frontend/src/nodes/generate-image/GenerateImageNode.tsx` — GND and EDIT toggle buttons
- `frontend/src/utils/costEstimate.ts` — Resolution-aware pricing maps, input ref cost
- `frontend/src/components/SettingsContext.tsx` — gcpProject, gcpLocation state
- `frontend/src/components/SettingsPanel.tsx` — GCP fields in Paths tab
- `frontend/src/types.ts` — ImageEditResult interface
- `frontend/src/__tests__/critical-paths.test.ts` — 4 new cost estimation tests

## Bugs Fixed
- `pullMedia` returns `{file, mediaId}` not `File` — Image Edit node was passing object to FormData
- `types.Image.from_bytes()` doesn't exist — replaced with `types.Image(image_bytes=data)`
- `generated.image._image_bytes` private field — replaced with `image_bytes` public field
- Subject images cap was `[:8]` instead of `[:4]` per API spec

## Tests
- Backend: 112 passed (was 105, +7 new)
- Frontend: 157 passed (was 150, +7 new)
- Total: 269, all green

## Known Issues
- Imagen 3 (`imagen-3.0-capability-001`) is deprecated — deadline June 2026
- `EDIT_MODE_DEFAULT` produces poor results with Imagen — use specific modes
- Gemini option in Image Edit node is redundant with EDIT button in Generate Image
- Review Hub frontend still has zero test files

## Next Tasks
1. Test Imagen specific edit modes (Background Swap, Remove Object)
2. Remove redundant Gemini from Image Edit node or keep for convenience
3. Prompt Library feature
4. Gestione utenti by admin (Review Hub)
