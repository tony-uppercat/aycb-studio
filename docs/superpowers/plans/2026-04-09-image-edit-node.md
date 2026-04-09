# Image Edit Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Image Edit node using Vertex AI Imagen `edit_image()` for cheap image editing ($0.02/edit).

**Architecture:** Dual-client — existing Gemini API key stays for generation/LLM, a new Vertex AI client (ADC auth) handles editing via `client.models.edit_image()`. New node in `frontend/src/nodes/image-edit/`, new backend endpoint in `src/routers/image_edit.py`. GCP project + location stored in settings.

**Tech Stack:** Python `google-genai` SDK (already installed), Vertex AI ADC auth, React + TypeScript frontend.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `config/settings.py` | Modify | Add `gcp_project`, `gcp_location` fields |
| `src/routers/settings.py` | Modify | Expose GCP fields in GET/PUT `/api/settings/paths` |
| `src/routers/image_edit.py` | Create | Backend endpoint + Vertex AI client + edit logic |
| `tests/test_image_edit.py` | Create | Backend unit tests |
| `frontend/src/types.ts` | Modify | Add `ImageEditNodeData` interface |
| `frontend/src/components/SettingsContext.tsx` | Modify | Add `gcpProject`, `gcpLocation` state |
| `frontend/src/components/SettingsPanel.tsx` | Modify | Add GCP fields to Paths tab |
| `frontend/src/api.ts` | Modify | Add `editImage()` function |
| `frontend/src/nodes/image-edit/node.manifest.ts` | Create | Node manifest |
| `frontend/src/nodes/image-edit/ImageEditNode.tsx` | Create | Node component |
| `frontend/src/nodes/image-edit/useImageEdit.ts` | Create | Node hook |
| `frontend/src/nodes/image-edit/image-edit.test.ts` | Create | Frontend manifest test |

---

### Task 1: Backend — Settings fields for GCP

**Files:**
- Modify: `config/settings.py`
- Modify: `src/routers/settings.py`

- [ ] **Step 1: Add GCP fields to Settings**

In `config/settings.py`, add after the `gemini_embedding_model` line:

```python
    # ── Google Cloud (Vertex AI) ──────────────────────────────────────
    gcp_project: str = ""
    gcp_location: str = "us-central1"
```

- [ ] **Step 2: Expose GCP fields in settings router**

In `src/routers/settings.py`, update `get_paths()` to include GCP fields:

```python
@router.get("/paths")
async def get_paths():
    resolved = settings.shared_root.resolve()
    return {
        "shared_root": str(resolved),
        "exists": resolved.exists(),
        "media_dir": str(settings.media_dir),
        "references_dir": str(settings.references_dir),
        "gcp_project": settings.gcp_project,
        "gcp_location": settings.gcp_location,
    }
```

Update `set_paths()` to handle GCP fields:

```python
@router.put("/paths")
async def set_paths(body: dict):
    new_path = body.get("shared_root", "").strip()
    if not new_path:
        return {"error": "shared_root is required"}
    p = Path(new_path).resolve()
    settings.shared_root = p
    set_key(ENV_PATH, "AYCB_SHARED_ROOT", str(p))
    # GCP settings (optional)
    gcp_project = body.get("gcp_project", "").strip()
    gcp_location = body.get("gcp_location", "").strip()
    if gcp_project:
        settings.gcp_project = gcp_project
        set_key(ENV_PATH, "AYCB_GCP_PROJECT", gcp_project)
    if gcp_location:
        settings.gcp_location = gcp_location
        set_key(ENV_PATH, "AYCB_GCP_LOCATION", gcp_location)
    return {"shared_root": str(p), "exists": p.exists(), "gcp_project": settings.gcp_project, "gcp_location": settings.gcp_location}
```

- [ ] **Step 3: Run backend tests**

Run: `python -m pytest tests/ -x -q`
Expected: all pass (settings changes are backwards-compatible)

- [ ] **Step 4: Commit**

```bash
git add config/settings.py src/routers/settings.py
git commit -m "[feat] Add GCP project/location settings for Vertex AI"
```

---

### Task 2: Backend — Image edit endpoint

**Files:**
- Create: `src/routers/image_edit.py`

- [ ] **Step 1: Create the image edit router**

Create `src/routers/image_edit.py`:

```python
"""Image Edit router — Vertex AI Imagen edit_image."""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import time

from PIL import Image as PILImage
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config.settings import settings
from src.shared import _log, _require_prompt, _validate_image_upload, _read_upload, MAX_IMAGE_BYTES

router = APIRouter(prefix="/api/edit", tags=["edit"])

logger = logging.getLogger(__name__)

# ── Vertex AI client (lazy) ──────────────────────────────────────────────────

_vertex_client = None


def _get_vertex_client():
    """Lazy-init Vertex AI client. Raises if GCP not configured."""
    global _vertex_client
    if _vertex_client is not None:
        return _vertex_client
    if not settings.gcp_project:
        raise ValueError(
            "GCP Project ID not configured. Go to Settings > Paths and enter your Google Cloud Project ID. "
            "Also run: gcloud auth application-default login"
        )
    from google import genai
    _vertex_client = genai.Client(
        vertexai=True,
        project=settings.gcp_project,
        location=settings.gcp_location or "us-central1",
    )
    return _vertex_client


def _reset_vertex_client():
    """Reset cached client (for testing or after settings change)."""
    global _vertex_client
    _vertex_client = None


# ── Edit modes that need a mask ──────────────────────────────────────────────

_NEEDS_MASK = {
    "EDIT_MODE_INPAINT_REMOVAL",
    "EDIT_MODE_INPAINT_INSERTION",
    "EDIT_MODE_OUTPAINT",
}


def _edit_image_sync(
    prompt: str,
    base_pil: PILImage.Image,
    edit_mode: str,
    mask_mode: str,
    mask_dilation: float,
    number_of_images: int,
    subject_pils: list[PILImage.Image] | None = None,
) -> list[PILImage.Image]:
    """Run edit_image synchronously (called via asyncio.to_thread)."""
    from google.genai import types

    client = _get_vertex_client()

    # Convert PIL to genai Image
    buf = io.BytesIO()
    base_pil.save(buf, format="PNG")
    buf.seek(0)
    base_image = types.Image.from_bytes(data=buf.read())

    # Build reference images
    ref_images: list = [
        types.RawReferenceImage(
            reference_id=0,
            reference_image=base_image,
        )
    ]

    # Add mask if edit mode requires one
    if edit_mode in _NEEDS_MASK:
        ref_images.append(
            types.MaskReferenceImage(
                reference_id=1,
                config=types.MaskReferenceConfig(
                    mask_mode=mask_mode,
                    mask_dilation=mask_dilation,
                ),
            )
        )

    # Add subject reference images
    if subject_pils:
        for i, spil in enumerate(subject_pils[:4]):
            sbuf = io.BytesIO()
            spil.save(sbuf, format="PNG")
            sbuf.seek(0)
            ref_images.append(
                types.SubjectReferenceImage(
                    reference_id=10 + i,
                    reference_image=types.Image.from_bytes(data=sbuf.read()),
                    config=types.SubjectReferenceConfig(
                        subject_type="SUBJECT_TYPE_DEFAULT",
                    ),
                )
            )

    config = types.EditImageConfig(
        edit_mode=edit_mode,
        number_of_images=number_of_images,
    )

    response = client.models.edit_image(
        model="imagen-3.0-capability-001",
        prompt=prompt,
        reference_images=ref_images,
        config=config,
    )

    results: list[PILImage.Image] = []
    if response.generated_images:
        for gen_img in response.generated_images:
            img_bytes = gen_img.image._image_bytes
            results.append(PILImage.open(io.BytesIO(img_bytes)))

    return results


def _pil_to_b64(img: PILImage.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@router.post("/image")
async def edit_image_endpoint(
    prompt: str = Form(...),
    edit_mode: str = Form("EDIT_MODE_INPAINT_REMOVAL"),
    mask_mode: str = Form("MASK_MODE_BACKGROUND"),
    mask_dilation: float = Form(0.01),
    number_of_images: int = Form(1),
    image: UploadFile = File(...),
    subject_images: list[UploadFile] | None = File(default=None),
):
    clean_prompt = _require_prompt(prompt)
    _validate_image_upload(image)
    raw = await _read_upload(image, MAX_IMAGE_BYTES, "Base image")
    base_pil = PILImage.open(io.BytesIO(raw)).convert("RGB")

    subject_pils: list[PILImage.Image] = []
    if subject_images:
        for f in subject_images[:4]:
            _validate_image_upload(f)
            sraw = await _read_upload(f, MAX_IMAGE_BYTES, "Subject image")
            subject_pils.append(PILImage.open(io.BytesIO(sraw)).convert("RGB"))

    _log(f"Edit image — mode={edit_mode}, mask={mask_mode}, {len(subject_pils)} subjects, prompt={clean_prompt[:80]}...")
    t0 = time.time()
    try:
        results = await asyncio.to_thread(
            _edit_image_sync,
            clean_prompt, base_pil, edit_mode, mask_mode,
            mask_dilation, number_of_images, subject_pils or None,
        )
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Edit image FAILED — {exc} ({dt:.1f}s)")
        raise HTTPException(502, detail=str(exc))

    dt = time.time() - t0
    if not results:
        _log(f"Edit image — no results ({dt:.1f}s)")
        return {"images_b64": [], "status": "No images generated", "usage": None}

    images_b64 = [_pil_to_b64(r) for r in results]
    cost = 0.02 * len(results)
    _log(f"Edit image — {len(results)} results ({dt:.1f}s)")
    return {
        "images_b64": images_b64,
        "status": "OK",
        "usage": {"cost_usd": cost},
    }
```

- [ ] **Step 2: Run backend tests**

Run: `python -m pytest tests/ -x -q`
Expected: all pass (new router is auto-discovered, no conflicts)

- [ ] **Step 3: Commit**

```bash
git add src/routers/image_edit.py
git commit -m "[feat] Image edit endpoint — Vertex AI Imagen edit_image"
```

---

### Task 3: Backend — Unit tests for image edit

**Files:**
- Create: `tests/test_image_edit.py`

- [ ] **Step 1: Write tests**

Create `tests/test_image_edit.py`:

```python
"""Tests for the image edit router — config building, validation."""
import pytest


def test_vertex_client_raises_without_gcp_project():
    """_get_vertex_client raises ValueError if gcp_project is empty."""
    from src.routers.image_edit import _get_vertex_client, _reset_vertex_client
    from config.settings import settings

    _reset_vertex_client()
    original = settings.gcp_project
    try:
        settings.gcp_project = ""
        with pytest.raises(ValueError, match="GCP Project ID not configured"):
            _get_vertex_client()
    finally:
        settings.gcp_project = original
        _reset_vertex_client()


def test_needs_mask_modes():
    """Verify which edit modes require a mask."""
    from src.routers.image_edit import _NEEDS_MASK
    assert "EDIT_MODE_INPAINT_REMOVAL" in _NEEDS_MASK
    assert "EDIT_MODE_INPAINT_INSERTION" in _NEEDS_MASK
    assert "EDIT_MODE_OUTPAINT" in _NEEDS_MASK
    assert "EDIT_MODE_BGSWAP" not in _NEEDS_MASK
    assert "EDIT_MODE_PRODUCT_IMAGE" not in _NEEDS_MASK


def test_pil_to_b64_roundtrip():
    """_pil_to_b64 produces valid base64 PNG."""
    import base64
    import io
    from PIL import Image as PILImage
    from src.routers.image_edit import _pil_to_b64

    img = PILImage.new("RGB", (64, 64), color=(255, 0, 0))
    b64 = _pil_to_b64(img)
    decoded = base64.b64decode(b64)
    restored = PILImage.open(io.BytesIO(decoded))
    assert restored.size == (64, 64)


def test_edit_mode_enum_values():
    """Verify EditMode enum has the expected values."""
    from google.genai.types import EditMode
    assert hasattr(EditMode, "EDIT_MODE_INPAINT_REMOVAL")
    assert hasattr(EditMode, "EDIT_MODE_INPAINT_INSERTION")
    assert hasattr(EditMode, "EDIT_MODE_OUTPAINT")
    assert hasattr(EditMode, "EDIT_MODE_BGSWAP")
    assert hasattr(EditMode, "EDIT_MODE_PRODUCT_IMAGE")


def test_reference_image_types_exist():
    """Verify all reference image types we use exist in the SDK."""
    from google.genai import types
    assert hasattr(types, "RawReferenceImage")
    assert hasattr(types, "MaskReferenceImage")
    assert hasattr(types, "SubjectReferenceImage")
    assert hasattr(types, "MaskReferenceConfig")
    assert hasattr(types, "SubjectReferenceConfig")
    assert hasattr(types, "EditImageConfig")
```

- [ ] **Step 2: Run tests**

Run: `python -m pytest tests/test_image_edit.py -v`
Expected: 5 passed

- [ ] **Step 3: Commit**

```bash
git add tests/test_image_edit.py
git commit -m "[test] Image edit backend tests — config, validation, SDK types"
```

---

### Task 4: Frontend — Settings for GCP

**Files:**
- Modify: `frontend/src/components/SettingsContext.tsx`
- Modify: `frontend/src/components/SettingsPanel.tsx`

- [ ] **Step 1: Add GCP fields to SettingsContext**

In `frontend/src/components/SettingsContext.tsx`:

Add to `Settings` interface:
```typescript
  gcpProject: string
  gcpLocation: string
```

Add to `SettingsCtx` interface:
```typescript
  setGcpProject: (k: string) => void
  setGcpLocation: (k: string) => void
```

Add to `DEFAULTS`:
```typescript
gcpProject: '', gcpLocation: 'us-central1'
```

Add to `Ctx` default:
```typescript
setGcpProject: () => {},
setGcpLocation: () => {},
```

Add to `ctx` object in `SettingsProvider`:
```typescript
setGcpProject: (k) => setSettings(s => ({ ...s, gcpProject: k })),
setGcpLocation: (k) => setSettings(s => ({ ...s, gcpLocation: k })),
```

- [ ] **Step 2: Add GCP fields to SettingsPanel Paths tab**

In `frontend/src/components/SettingsPanel.tsx`:

Add state variables near the `sharedPath` declarations:
```typescript
const [gcpProject, setGcpProjectLocal] = useState('')
const [gcpLocation, setGcpLocationLocal] = useState('us-central1')
```

Update `fetchPaths` to read GCP fields:
```typescript
setGcpProjectLocal(d.gcp_project ?? '')
setGcpLocationLocal(d.gcp_location ?? 'us-central1')
```

Update `savePath` to send GCP fields:
```typescript
body: JSON.stringify({ shared_root: sharedPath, gcp_project: gcpProject, gcp_location: gcpLocation }),
```

Add GCP inputs in the Paths tab, after the Shared Root field's closing `</div>`:
```tsx
<div className={styles.field}>
  <label className={styles.label}>GCP Project ID</label>
  <input
    className={styles.input}
    type="text"
    placeholder="my-gcp-project-id"
    value={gcpProject}
    onChange={e => setGcpProjectLocal(e.target.value)}
  />
  <p className={styles.hint}>
    Google Cloud project for Vertex AI Imagen editing. Requires: gcloud auth application-default login
  </p>
</div>
<div className={styles.field}>
  <label className={styles.label}>GCP Location</label>
  <input
    className={styles.input}
    type="text"
    placeholder="us-central1"
    value={gcpLocation}
    onChange={e => setGcpLocationLocal(e.target.value)}
  />
</div>
```

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsContext.tsx frontend/src/components/SettingsPanel.tsx
git commit -m "[feat] GCP project/location settings in UI — Paths tab"
```

---

### Task 5: Frontend — API function for image edit

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add ImageEditResult type**

In `frontend/src/types.ts`, add after `GenerateImageResult`:

```typescript
export interface ImageEditResult {
  images_b64: string[]
  status: string
  usage?: { cost_usd: number }
}
```

- [ ] **Step 2: Add editImage function to api**

In `frontend/src/api.ts`, add after the `generateImage` method:

```typescript
  async editImage(
    prompt: string,
    image: File,
    editMode: string,
    maskMode: string,
    maskDilation: number,
    numberOfImages: number,
    subjectImages?: File[],
  ): Promise<ImageEditResult> {
    if (!isBackendAvailable()) throw new Error('Image editing requires the backend (Vertex AI)')
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('image', image)
    fd.append('edit_mode', editMode)
    fd.append('mask_mode', maskMode)
    fd.append('mask_dilation', String(maskDilation))
    fd.append('number_of_images', String(numberOfImages))
    subjectImages?.forEach(f => fd.append('subject_images', f))
    return post('/edit/image', fd)
  },
```

Add import for `ImageEditResult` at the top of the file.

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/types.ts
git commit -m "[feat] Frontend API function for image editing"
```

---

### Task 6: Frontend — Node manifest and test

**Files:**
- Create: `frontend/src/nodes/image-edit/node.manifest.ts`
- Create: `frontend/src/nodes/image-edit/image-edit.test.ts`

- [ ] **Step 1: Create manifest**

Create `frontend/src/nodes/image-edit/node.manifest.ts`:

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageEdit',
  label: 'Image Edit',
  icon: '🖌',
  category: 'media-model',
  description: 'Edit images using Vertex AI Imagen — inpainting, background swap, outpainting',
  defaultData: {
    edit_mode: 'EDIT_MODE_INPAINT_REMOVAL',
    mask_mode: 'MASK_MODE_BACKGROUND',
    mask_dilation: 0.01,
    number_of_images: 1,
  },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
```

- [ ] **Step 2: Create test**

Create `frontend/src/nodes/image-edit/image-edit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('image-edit manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('imageEdit')
    expect(manifest.label).toBe('Image Edit')
    expect(manifest.category).toBe('media-model')
  })

  it('has image input and output', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0].type).toBe('image')
    expect(manifest.inputs[0].handleId).toBe('image-in')
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0].type).toBe('image')
    expect(manifest.outputs[0].handleId).toBe('image-out')
  })

  it('has correct default data', () => {
    expect(manifest.defaultData.edit_mode).toBe('EDIT_MODE_INPAINT_REMOVAL')
    expect(manifest.defaultData.mask_mode).toBe('MASK_MODE_BACKGROUND')
    expect(manifest.defaultData.mask_dilation).toBe(0.01)
    expect(manifest.defaultData.number_of_images).toBe(1)
  })
})
```

- [ ] **Step 3: Run test**

Run: `cd frontend && npx vitest run src/nodes/image-edit/image-edit.test.ts`
Expected: 3 passed

- [ ] **Step 4: Commit**

```bash
git add frontend/src/nodes/image-edit/node.manifest.ts frontend/src/nodes/image-edit/image-edit.test.ts
git commit -m "[node] Image Edit manifest and tests"
```

---

### Task 7: Frontend — useImageEdit hook

**Files:**
- Create: `frontend/src/nodes/image-edit/useImageEdit.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/nodes/image-edit/useImageEdit.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { api } from '../../api'
import { pullMedia, pullAllMedia } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { useCanvasStore } from '../../stores/canvasStore'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'

const EDIT_MODES = [
  { value: 'EDIT_MODE_INPAINT_REMOVAL', label: 'Remove Object', needsMask: true },
  { value: 'EDIT_MODE_INPAINT_INSERTION', label: 'Insert Object', needsMask: true },
  { value: 'EDIT_MODE_BGSWAP', label: 'Background Swap', needsMask: false },
  { value: 'EDIT_MODE_OUTPAINT', label: 'Outpaint', needsMask: true },
  { value: 'EDIT_MODE_PRODUCT_IMAGE', label: 'Product Image', needsMask: false },
] as const

const MASK_MODES = [
  { value: 'MASK_MODE_BACKGROUND', label: 'Background' },
  { value: 'MASK_MODE_FOREGROUND', label: 'Foreground' },
  { value: 'MASK_MODE_SEMANTIC', label: 'Semantic' },
] as const

const MAX_SUBJECTS = 4

export { EDIT_MODES, MASK_MODES }

export function useImageEdit(id: string, data: Record<string, unknown>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  // Dynamic subject pins (same pattern as Generate Image refs)
  const connectedSubjectCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('subject-')).length
  )
  const subjectCount = Math.min(connectedSubjectCount + 1, MAX_SUBJECTS)
  const subjectSlots: SlotDef[] = Array.from({ length: subjectCount }, (_, i) => ({
    id: `subject-${i}`,
    label: `Subject ${i + 1}`,
    type: 'image' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [subjectCount, id, updateNodeInternals])

  const [editMode, setEditMode] = useState(String(data.edit_mode ?? 'EDIT_MODE_INPAINT_REMOVAL'))
  const [maskMode, setMaskMode] = useState(String(data.mask_mode ?? 'MASK_MODE_BACKGROUND'))
  const [maskDilation, setMaskDilation] = useState(Number(data.mask_dilation ?? 0.01))
  const [numberOfImages, setNumberOfImages] = useState(Number(data.number_of_images ?? 1))
  const [localPrompt, setLocalPrompt] = useState(String(data.prompt ?? ''))
  const [resultB64, setResultB64] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  const needsMask = EDIT_MODES.find(m => m.value === editMode)?.needsMask ?? false

  // Check if image-in is connected
  const hasImageEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'image-in')
  )

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const prompt = localPrompt.trim()
      if (!prompt) { setError('Write an edit prompt'); return }

      // Pull base image from connected node
      const baseFile = await pullMedia(id, 'image-in', getNodes, getEdges)
      if (!baseFile) { setError('Connect an image to the Image input'); return }

      // Pull subject images
      const subjects = await pullAllMedia(id, 'subject-', getNodes, getEdges)

      const r = await api.editImage(
        prompt, baseFile, editMode, maskMode, maskDilation, numberOfImages,
        subjects.length > 0 ? subjects : undefined,
      )
      if (!r.images_b64 || r.images_b64.length === 0) {
        throw new Error(r.status || 'No images generated')
      }

      // Use the first result
      const b64 = r.images_b64[0]
      setResultB64(b64)

      // Save to media store
      const mediaId = generateMediaId()
      const response = await fetch(`data:image/png;base64,${b64}`)
      const blob = await response.blob()
      const file = new File([blob], `edited_${Date.now()}.png`, { type: 'image/png' })
      await saveMediaForProject(mediaId, file)
      updateNodeData(id, { mediaId })

      // Track cost
      const costUsd = r.usage?.cost_usd ?? 0.02
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'Image Edit',
        model: 'imagen-3.0-capability-001',
        inputTokens: 0,
        outputTokens: 0,
        costUsd,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
    }
  }, [localPrompt, editMode, maskMode, maskDilation, numberOfImages, id, getNodes, getEdges, updateNodeData])

  return {
    editMode, setEditMode,
    maskMode, setMaskMode,
    maskDilation, setMaskDilation,
    numberOfImages, setNumberOfImages,
    localPrompt, setLocalPrompt,
    resultB64,
    loading, error, lastCost,
    needsMask,
    hasImageEdge,
    subjectSlots,
    connectedSubjectCount,
    run,
    updateNodeData,
  }
}
```

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add frontend/src/nodes/image-edit/useImageEdit.ts
git commit -m "[node] Image Edit hook — edit modes, mask modes, subject refs"
```

---

### Task 8: Frontend — ImageEditNode component

**Files:**
- Create: `frontend/src/nodes/image-edit/ImageEditNode.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/nodes/image-edit/ImageEditNode.tsx`:

```tsx
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useImageEdit, EDIT_MODES, MASK_MODES } from './useImageEdit'
import styles from '../_shared/Node.module.css'

export function ImageEditNode({ id, data, selected }: NodeProps) {
  const h = useImageEdit(id, data as Record<string, unknown>)

  return (
    <NodeShell
      name="Image Edit"
      selected={selected}
      icon="🖌"
      inputSlots={[
        { id: 'image-in', label: 'Image', type: 'image' },
        ...h.subjectSlots,
      ]}
      outputSlots={[
        { id: 'image-out', label: 'Image', type: 'image' },
      ]}
      onRun={h.run}
      running={h.loading}
      lastCost={h.lastCost}
      estimatedCost="~$0.02"
    >
      <div className={styles.nodeContent}>
        <select
          className={styles.select}
          value={h.editMode}
          onChange={e => { h.setEditMode(e.target.value); h.updateNodeData(id, { edit_mode: e.target.value }) }}
          title="Edit Mode"
        >
          {EDIT_MODES.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        {h.needsMask && (
          <div className={styles.arResRow}>
            <select
              className={styles.selectSmall}
              value={h.maskMode}
              onChange={e => { h.setMaskMode(e.target.value); h.updateNodeData(id, { mask_mode: e.target.value }) }}
              title="Mask Mode"
            >
              {MASK_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              className={styles.selectSmall}
              type="number"
              min={0} max={0.1} step={0.005}
              value={h.maskDilation}
              onChange={e => { const v = parseFloat(e.target.value) || 0.01; h.setMaskDilation(v); h.updateNodeData(id, { mask_dilation: v }) }}
              title="Mask Dilation"
              style={{ width: 60 }}
            />
          </div>
        )}

        <div className={styles.batchToggle}>
          {[1, 2, 4].map(n => (
            <button key={n}
              className={`${styles.batchBtn} ${h.numberOfImages === n ? styles.batchBtnActive : ''}`}
              onClick={() => { h.setNumberOfImages(n); h.updateNodeData(id, { number_of_images: n }) }}
              title={n === 1 ? 'Single result' : `Generate ${n} variants`}
            >{'\u00d7'}{n}</button>
          ))}
        </div>

        <textarea
          className={styles.promptTextarea}
          value={h.localPrompt}
          onChange={e => { h.setLocalPrompt(e.target.value); h.updateNodeData(id, { prompt: e.target.value }) }}
          placeholder="Describe the edit..."
          rows={3}
          spellCheck={false}
        />

        {h.error && <p className={styles.error}>{h.error}</p>}

        <div className={styles.previewArea}>
          {h.resultB64
            ? <img src={`data:image/png;base64,${h.resultB64}`} alt="edited" className={styles.previewImg} />
            : <span className={styles.dropHint}>
                {h.hasImageEdge ? 'Ready — click Run' : 'Connect an image to edit'}
              </span>
          }
        </div>
      </div>
    </NodeShell>
  )
}

export default memo(ImageEditNode)
```

- [ ] **Step 2: Run all tests**

Run: `cd frontend && npx vitest run`
Expected: all pass

Run: `python -m pytest tests/ -x -q`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add frontend/src/nodes/image-edit/ImageEditNode.tsx
git commit -m "[node] Image Edit component — edit modes, mask config, subject refs"
```

---

### Task 9: Integration verification

- [ ] **Step 1: Run full test suites**

```bash
python -m pytest tests/ -x -q
cd frontend && npx vitest run
```

Expected: all pass, no regressions.

- [ ] **Step 2: Verify node auto-discovery**

Open browser at `localhost:5100`. The Image Edit node should appear in the Add Node menu under "Media / Model" category. No files modified for registration.

- [ ] **Step 3: Verify settings**

Open Settings > Paths. GCP Project ID and GCP Location fields should appear below Shared Root.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "[feat] Image Edit node — Vertex AI Imagen, inpainting, background swap, outpainting"
```
