# Image Edit Node — Design Spec

**Date:** 2026-04-09
**Status:** Approved

## Summary

Add an Image Edit node powered by Vertex AI Imagen `edit_image()` API for cheaper image editing ($0.02/edit vs $0.067/gen with Gemini Flash Image). Supports inpainting, object removal, background swap, outpainting, and product image editing with automatic mask modes.

## Architecture

Dual-client approach: existing Gemini API key for generation/LLM, new Vertex AI client (ADC auth) for editing only.

```
Gemini API (api_key)              Vertex AI (ADC)
├── Generate Image node           ├── Image Edit node
├── LLM node                     │   └── client.models.edit_image()
├── Analysis nodes                │       model: imagen-3.0-capability-001
└── generate_content()            └── Requires: GCP project + gcloud login
```

The Vertex AI client is created lazily on first edit request. If GCP credentials are not configured, the node shows a clear error message.

## GCP Authentication

### User Setup (one-time)

1. Create a Google Cloud project (or use existing)
2. Enable Vertex AI API in the project
3. Run `gcloud auth application-default login` in terminal
4. In AYCB Settings > Paths: enter GCP Project ID and Location

### Backend

- `config/settings.py` gets two new fields: `gcp_project: str`, `gcp_location: str`
- Persisted to `.env` as `AYCB_GCP_PROJECT` and `AYCB_GCP_LOCATION`
- A separate `genai.Client(vertexai=True, project=..., location=...)` is created for edit operations
- The existing Gemini client (API key) is unchanged

## Node Design

### Manifest

```typescript
{
  type: 'imageEdit',
  label: 'Image Edit',
  category: 'media-model',
  inputs: [
    { id: 'image-in', label: 'Image', type: 'image' },
  ],
  outputs: [
    { id: 'image-out', label: 'Image', type: 'image' },
  ],
}
```

### Input Slots

| Slot | Type | Required | Description |
|---|---|---|---|
| `image-in` | image | Yes | Base image to edit |
| `subject-0..3` | image | No | Subject reference images (dynamic pins, same pattern as Generate Image refs) |

### Output Slots

| Slot | Type | Description |
|---|---|---|
| `image-out` | image | Edited result |

### UI Controls

| Control | Type | Values |
|---|---|---|
| Edit Mode | dropdown | Remove Object, Insert Object, Background Swap, Outpaint, Product Image |
| Mask Mode | dropdown | Background, Foreground, Semantic (shown only when edit mode needs a mask) |
| Mask Dilation | slider | 0.00 - 0.10 (default 0.01) |
| Prompt | textarea | Edit instruction |
| Count | buttons | 1, 2, 4 (number of result images) |

### Edit Mode → API Mapping

| UI Label | EditMode enum | Needs mask | Description |
|---|---|---|---|
| Remove Object | `EDIT_MODE_INPAINT_REMOVAL` | Yes | Remove object from masked area |
| Insert Object | `EDIT_MODE_INPAINT_INSERTION` | Yes | Insert described object into masked area |
| Background Swap | `EDIT_MODE_BGSWAP` | No (auto) | Replace background, keep foreground |
| Outpaint | `EDIT_MODE_OUTPAINT` | Yes | Extend image beyond borders |
| Product Image | `EDIT_MODE_PRODUCT_IMAGE` | No | Product photography editing |

### Mask Mode → API Mapping (when mask needed)

| UI Label | MaskMode | Description |
|---|---|---|
| Background | `MASK_MODE_BACKGROUND` | Auto-detect and mask background |
| Foreground | `MASK_MODE_FOREGROUND` | Auto-detect and mask foreground |
| Semantic | `MASK_MODE_SEMANTIC` | Category-based (sky, floor, etc.) |

## Backend Endpoint

### `POST /api/edit/image`

New file: `src/routers/image_edit.py` (auto-discovered).

**Form parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | str | required | Edit instruction |
| `edit_mode` | str | `EDIT_MODE_INPAINT_REMOVAL` | Imagen EditMode |
| `mask_mode` | str | `MASK_MODE_BACKGROUND` | Mask mode |
| `mask_dilation` | float | `0.01` | Mask dilation |
| `number_of_images` | int | `1` | Results count (1-4) |
| `image` | UploadFile | required | Base image |
| `subject_images` | list[UploadFile] | optional | Subject references (0-4) |

**Response:**

```json
{
  "images_b64": ["base64...", ...],
  "status": "OK",
  "usage": { "cost_usd": 0.02 }
}
```

### Vertex AI Client

```python
from google import genai

def _get_vertex_client() -> genai.Client:
    """Lazy-init Vertex AI client. Raises if GCP not configured."""
    return genai.Client(
        vertexai=True,
        project=settings.gcp_project,
        location=settings.gcp_location,
    )
```

### Edit Function

```python
def edit_image(
    prompt: str,
    base_image: Image.Image,
    edit_mode: str = "EDIT_MODE_INPAINT_REMOVAL",
    mask_mode: str = "MASK_MODE_BACKGROUND",
    mask_dilation: float = 0.01,
    number_of_images: int = 1,
    subject_images: list[Image.Image] | None = None,
) -> list[Image.Image]:
    client = _get_vertex_client()
    # Build reference images list
    # Call client.models.edit_image(model="imagen-3.0-capability-001", ...)
    # Return list of PIL images
```

## Files to Create

| File | Purpose | Est. lines |
|---|---|---|
| `frontend/src/nodes/image-edit/node.manifest.ts` | Node manifest | ~25 |
| `frontend/src/nodes/image-edit/ImageEditNode.tsx` | Node component | ~120 |
| `frontend/src/nodes/image-edit/useImageEdit.ts` | Node hook | ~200 |
| `src/routers/image_edit.py` | Backend endpoint + Vertex client | ~120 |

## Files to Modify

| File | Change |
|---|---|
| `config/settings.py` | Add `gcp_project`, `gcp_location` fields |
| `frontend/src/components/SettingsPanel.tsx` | Add GCP Project ID + Location inputs |
| `frontend/src/components/SettingsContext.tsx` | Add state for new settings |

## Cost

| Operation | Provider | Cost |
|---|---|---|
| Image generation | Gemini Flash Image | $0.067/img (1K) |
| Image editing | Vertex AI Imagen | ~$0.02/edit |
| Savings | | ~70% cheaper for edits |

## Not in Scope (v1)

- User-drawn masks (MASK_MODE_USER_PROVIDED)
- Style reference images (EDIT_MODE_STYLE)
- Control reference images (face mesh)
- Frontend Gemini provider path for edit (Vertex only)
- History/gallery in the edit node (can be added later)

## Testing

- Backend: unit test for Vertex client init, parameter building
- Frontend: manifest test, cost estimate test
- Integration: requires GCP credentials (manual test)
