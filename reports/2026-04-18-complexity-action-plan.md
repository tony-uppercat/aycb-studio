# Complexity Action Plan — 2026-04-18

Concrete, ordered fixes derived from `2026-04-18-complexity-audit-v2.md`.
Each item lists: file, exact change, test to add/run, acceptance check,
estimated effort, and the finding it closes.

Order is chosen so the cheapest / safest fixes ship first and each step
keeps the app running.

---

## Phase 0 — Quick Wins (≤1h total)

These six tasks clear 5 findings and fix the one security issue. They do
not interact with each other; they can land in any order.

### 0.1 Close C1 — path traversal in upload

**File**: `src/review_hub/routes/upload.py`

**Change** (2 line edits + 1 import):

```python
# top of file (new import)
from src.shared import _sanitize_filename

# line 24
dest = settings.media_dir / _sanitize_filename(file.filename)

# line 58
dest = save_dir / _sanitize_filename(file.filename)
```

**Tests** (`tests/test_rh_routes.py`):

```python
async def test_upload_media_rejects_path_traversal(client, tmp_db):
    fake = ("../../../etc/passwd", b"hostile", "text/plain")
    r = await client.post("/api/rh/upload/media",
                          files={"file": fake})
    assert r.status_code == 200  # sanitizer replaces, does not reject
    # Verify the file does NOT land outside media_dir
    hostile_escape = Path("/etc/passwd")
    assert not hostile_escape.exists() or \
           hostile_escape.stat().st_size != len(b"hostile")
    # Verify the file lands inside media_dir with sanitized name
    sanitized = [p for p in settings.media_dir.rglob("*passwd*") if p.is_file()]
    assert sanitized, "sanitized upload should land in media_dir"
```

**Acceptance**: upload with `filename="../../evil"` → file is written to
`media_dir/______evil` (or similar sanitized form), NOT to
`media_dir/../../evil`.

**Effort**: 5 min. **Closes**: C1.

---

### 0.2 Fix C2 — Veo duration mismatch

The backend silently snaps 5s → 4s. Fix in the frontend so what the user
sees is what the user gets.

**File**: `frontend/src/nodes/generate-video/useGenerateVideo.ts`

**Change**: at the point where `VIDEO_MODELS` is defined, add
`allowedDurations?: number[]` for Veo entries:

```ts
// In VIDEO_MODELS, for each Veo entry:
{
  id: 'vertex-veo-3.1',
  // ...existing fields...
  allowedDurations: [4, 6, 8],  // NEW
},
```

In the duration slider / input, snap client-side before submit:

```ts
const effectiveDuration = modelInfo.allowedDurations
  ? modelInfo.allowedDurations.reduce((best, d) =>
      Math.abs(d - duration) < Math.abs(best - duration) ? d : best)
  : duration
// Display effectiveDuration beside the slider when it differs from duration
```

**Alternative** (if snap-on-UI is too invasive): in
`src/vertex_video_gen.py:80-86`, change `_snap_duration` to raise
`HTTPException(422)` when the duration is outside the allowed set, and let
the frontend catch it.

**Acceptance**: requesting 5s Veo produces either (a) the UI snaps to 4 or
6 before submit (visible), or (b) HTTP 422 with `{"detail": "Veo duration
must be 4, 6, or 8 seconds"}`.

**Effort**: 15 min. **Closes**: C2.

---

### 0.3 Unify filename sanitization

Delete 3 of the 4 variants; leave only `_sanitize_filename`.

**Files to edit**:
- `src/review_hub/routes/folders.py:30-36` — delete `_safe_name`, import `_sanitize_filename` from `src.shared`, replace all 5 call sites
- `src/routers/bridge.py:101, 130, 227, 381, 397, 416` — replace each inline `re.sub(r"[^a-zA-Z0-9_\-]", "", stem)` with `_sanitize_filename(stem)`
- `src/routers/bridge_assets.py:157, 163` — same replacement

**Important**: `_sanitize_filename` in `shared.py:72-79` currently uses a
different pattern (`[\\/:*?"<>|\x00-\x1f\x7f]`) than the bridge inline
regex (`[^a-zA-Z0-9_\-]`). The bridge pattern is stricter (allowlist); the
shared pattern is looser (blocklist + control chars).

Before unifying, decide: strict or loose? Recommendation — make
`_sanitize_filename` handle a `mode: 'strict' | 'lenient'` kwarg:

```python
def _sanitize_filename(name: str | None, mode: str = "lenient") -> str:
    if not name:
        return "file"
    if mode == "strict":
        clean = re.sub(r"[^a-zA-Z0-9_\-]", "", name)
    else:
        clean = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', '_', name)
    return clean[:200] or "file"
```

Then call sites pass `mode="strict"` for bridge stems (which must be safe
for URL paths) and default for file uploads.

**Tests**:
```python
def test_sanitize_strict_strips_special():
    assert _sanitize_filename("foo/bar.png", "strict") == "foobarpng"

def test_sanitize_lenient_preserves_dot():
    assert _sanitize_filename("foo/bar.png", "lenient") == "foo_bar.png"

def test_sanitize_rejects_path_traversal():
    assert ".." not in _sanitize_filename("../evil.png", "lenient")
```

**Acceptance**: `grep -r "re.sub(r.\[\^a-zA-Z0-9_.-\]" src/` returns zero
matches. `grep -r "_safe_name" src/` returns zero matches.

**Effort**: 30 min (most of it is grepping + replacing). **Closes**: M12.

---

### 0.4 Auto-discover Review Hub routes

**File**: `src/review_hub/app.py`

Replace lines 11 and 119 with the `pkgutil` pattern already proven in
`src/api.py:63-78`:

```python
# Remove the long import line at the top.

# Replace lines 119-120 with:
import pkgutil
import importlib
from src.review_hub import routes as rh_routes

for _, module_name, _ in pkgutil.iter_modules(rh_routes.__path__):
    module = importlib.import_module(f"src.review_hub.routes.{module_name}")
    if hasattr(module, "router"):
        app.include_router(module.router)
```

**Acceptance**: removing one of the 13 route files (e.g. temporarily
renaming `asset_links.py` to `asset_links.py.bak`) causes the app to still
start; re-enabling it auto-mounts. No hardcoded list anywhere.

**Effort**: 30 min. **Closes**: M3.

---

### 0.5 Rename `video.py` to `video_proc.py`

**Files**:
- `src/routers/video.py` → `src/routers/video_proc.py`
- Any `from src.routers.video import ...` (search first)
- Tests: `tests/test_video.py` → `tests/test_video_proc.py` (if exists)

**Acceptance**: `grep -r "routers.video[^_]" src/ tests/` returns zero
matches. `/api/video` endpoints still respond.

**Effort**: 10 min. **Closes**: M11.

---

### 0.6 Extract queries helper module

**File**: new `src/review_hub/queries/_helpers.py`

```python
from aiosqlite import Row

def _row_to_dict(row: Row | None) -> dict | None:
    return dict(row) if row else None

def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]
```

Then in `queries/{media,comments,favorites,drawings,sessions,references,assets}.py`,
replace the local duplicates with:

```python
from ._helpers import _row_to_dict, _rows_to_list
```

**Acceptance**: no file in `queries/` defines its own `_row_to_dict` or
`_rows_to_list`.

**Effort**: 10 min. **Closes**: m13.

---

## Phase 1 — Transactional Safety (3h)

### 1.1 Disk + DB order reversal

For each of the 5 endpoints in M6, apply the pattern: **DB first, disk
second, rollback on DB failure**.

**Pattern**:

```python
db = await get_db()
try:
    # 1. All DB writes in a single transaction (implicit via connection)
    for row in ...:
        await db.execute("UPDATE ...", ...)

    # 2. Do the filesystem op AFTER DB writes succeed
    src.rename(dst)  # or shutil.move, or unlink, or write_bytes

    # 3. Commit — we reached here, both succeeded
    await db.commit()
except Exception:
    # DB auto-rolls back because we never committed.
    # If the filesystem op completed before raising, un-do it:
    if dst.exists() and not src.exists():
        dst.rename(src)
    raise
finally:
    await db.close()
```

**Endpoints to fix**:
- `src/review_hub/routes/folders.py:67-104` (`rename_folder`)
- `src/review_hub/routes/folders.py:121-147` (`move_media`)
- `src/review_hub/routes/media.py:118-148` (`delete_media`)
- `src/review_hub/routes/media.py:151-180` (`bulk_delete_media`)
- `src/review_hub/routes/upload.py:72-95` (`upload_reference` — the two
  separate DB connections for INSERT + UPDATE)

For `delete_media` specifically, the "rollback" is unrecoverable (you can't
un-unlink a file). Policy: DELETE first, then unlink. If unlink fails,
log and move on — the DB record is gone so the scanner will clean up
the orphan file within 5 seconds.

For `upload_reference`, merge the two `await get_db()` calls into one
context:

```python
db = await get_db()
try:
    new_id = await rq.add_reference(db, ...)
    try:
        thumbnail_path = generate_reference_thumbnail(dest, new_id)
    except Exception as exc:
        _log.warning("thumbnail failed: %s", exc)
        thumbnail_path = None
    if thumbnail_path:
        await db.execute(
            "UPDATE [references] SET thumbnail_path=? WHERE id=?",
            (thumbnail_path, new_id),
        )
    await db.commit()
finally:
    await db.close()
```

**Tests** (concept):

```python
async def test_delete_media_rollback_on_disk_failure(client, tmp_db):
    media_id = insert_test_row(...)
    # Simulate disk unlink failure by mocking Path.unlink to raise
    with mock.patch.object(Path, "unlink", side_effect=OSError("boom")):
        r = await client.delete(f"/api/rh/media/{media_id}",
                                headers={"X-Admin-Pin": "1312"})
    # After current (buggy) behavior: DB row still exists, file still exists
    # After fix: DB row is gone, file may remain — scanner will clean it
    row = await get_media(tmp_db, media_id)
    assert row is None  # new policy: DB always wins
```

**Acceptance**: all 5 endpoints pass a "disk failure after DB success"
test; the DB and disk do not diverge (or the divergence is deterministic
and recoverable by the scanner).

**Effort**: 3h (includes 5 tests + CI run). **Closes**: M6.

---

## Phase 2 — Model Registry (the big one, 6–8h)

### 2.1 Design

Create `src/registry.py` as a single source of truth:

```python
"""Single source of truth for all model metadata."""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Literal

Provider = Literal["gemini", "flux", "local", "ollama", "piapi", "fal",
                   "atlas", "vertex", "claude"]
Capability = Literal["text", "image", "video", "edit"]

@dataclass(frozen=True)
class Model:
    id: str
    name: str
    provider: Provider
    capability: Capability
    # Pricing — exactly one of these will be non-None
    cost_per_call: float | None = None        # flat per-invocation (e.g. Gemini image)
    cost_per_token: tuple[float, float] | None = None  # (in/M, out/M)
    cost_per_sec: dict[str, float] | None = None       # {"720p": 0.10, ...}
    # Capabilities
    aspect_ratios: tuple[str, ...] = ()
    allowed_durations: tuple[int, ...] = ()   # for video
    qualities: tuple[str, ...] = ()
    max_ref_images: int = 0
    deprecated: bool = False

REGISTRY: dict[str, Model] = {
    "gemini-3.1-flash-image-preview": Model(
        id="gemini-3.1-flash-image-preview",
        name="Nano Banana 2",
        provider="gemini",
        capability="image",
        cost_per_call=0.067,
        aspect_ratios=("1:1", "4:3", "3:4", "16:9", "9:16", "21:9"),
    ),
    # ... 20+ models, one entry each
}

def by_capability(cap: Capability) -> list[Model]:
    return [m for m in REGISTRY.values() if m.capability == cap]

def by_provider(prov: Provider) -> list[Model]:
    return [m for m in REGISTRY.values() if m.provider == prov]
```

### 2.2 Serve to frontend

New endpoint in `src/routers/registry.py`:

```python
from fastapi import APIRouter
from src.registry import REGISTRY
from dataclasses import asdict

router = APIRouter(prefix="/api/registry", tags=["registry"])

@router.get("/models")
async def list_models():
    return {"models": [asdict(m) for m in REGISTRY.values()]}

@router.get("/models/{capability}")
async def list_by_capability(capability: str):
    from src.registry import by_capability
    return {"models": [asdict(m) for m in by_capability(capability)]}
```

### 2.3 Frontend consumption

Replace the 4 frontend registries (`IMAGE_MODELS`, `VIDEO_MODELS`,
`MODEL_MAP`, `BFL_MODELS`, etc.) with a single hook:

```ts
// frontend/src/hooks/useModelRegistry.ts
import { useEffect, useState } from 'react'

export interface Model {
  id: string
  name: string
  provider: string
  capability: 'text' | 'image' | 'video' | 'edit'
  cost_per_call?: number
  cost_per_sec?: Record<string, number>
  cost_per_token?: [number, number]
  aspect_ratios: string[]
  allowed_durations?: number[]
  qualities: string[]
  max_ref_images: number
  deprecated: boolean
}

let _cache: Model[] | null = null

export async function fetchRegistry(): Promise<Model[]> {
  if (_cache) return _cache
  const r = await fetch('/api/registry/models')
  const data = await r.json()
  _cache = data.models as Model[]
  return _cache
}

export function useModelRegistry(capability?: Model['capability']) {
  const [models, setModels] = useState<Model[]>([])
  useEffect(() => {
    let cancelled = false
    fetchRegistry().then(all => {
      if (cancelled) return
      setModels(capability ? all.filter(m => m.capability === capability) : all)
    })
    return () => { cancelled = true }
  }, [capability])
  return models
}
```

### 2.4 Backend consumption

Each provider module (`video_gen.py`, `fal_video_gen.py`, etc.) drops its
local `MODELS` dict and imports from `registry.py`:

```python
# src/fal_video_gen.py (after refactor)
from src.registry import REGISTRY, Model

def get_model_info(model_id: str) -> Model:
    m = REGISTRY.get(model_id)
    if not m or m.provider != "fal":
        raise FalVideoGenError(f"Unknown fal model: {model_id}")
    return m
```

### 2.5 Migration order (safe, incremental)

1. Land `src/registry.py` with **all** current entries (no usage yet). PR 1.
2. Land `src/routers/registry.py` + test. PR 2.
3. Frontend: add `useModelRegistry`, use it in **one** node first
   (e.g. GenerateVideoNode). Keep `VIDEO_MODELS` dict in parallel. PR 3.
4. Migrate remaining frontend consumers one at a time. PR 4-6.
5. Backend: migrate `fal_video_gen.py` to read from registry. PR 7.
6. Migrate remaining backend providers. PR 8.
7. Delete the dead `MODELS` dicts + `IMAGE_MODELS` + `VIDEO_MODELS` +
   `MODEL_MAP` + `BFL_MODELS` + `EDIT_MODELS` + `shared.py:MODELS/IMAGE_MODELS`
   + `cli.py:MODELS`. PR 9.

Total: 9 PRs, each under 2 hours. The app stays green between PRs because
old + new coexist until PR 9.

**Acceptance**: adding a hypothetical `Veo 3.2` touches exactly one file
(`src/registry.py`) and the frontend/backend pick it up on next reload.

**Effort**: 6-8h. **Closes**: C3, M10, plus enables clean pricing audits.

---

## Phase 3 — Structural (~10h, non-urgent)

Tackle only when (0)-(2) have landed and the grade is at B.

### 3.1 Bridge sqlite helpers → `review_hub/queries/bridge.py` (M1, 2-3h)
Move the 9 raw `sqlite3.connect(...)` helpers in `bridge.py` +
`bridge_assets.py` into a new sync query module alongside the async ones.
Schema knowledge in one place.

### 3.2 Split `ConsolePanel.tsx` (M4, 3h)
Per tab: `ConsoleTab`, `PerfTab`, `ReviewTab` (already separate),
`NetworkTab`, `FeedbackPanel`.

### 3.3 Split `MediaBrowser.tsx` (M4, 2h)
Per tab: `MediaTab`, `ReferencesTab` (already separate), `AssetsTab`
(already separate). The shell becomes ~100 LOC.

### 3.4 Rename SPA snake_case → camelCase (M2, 4h)
Codemod `frontend/src/review/**` variables and props from snake_case to
camelCase. Do not touch the API response shapes (those remain snake_case
per CLAUDE.md rule 4); only TypeScript-local identifiers.

### 3.5 Inline styles in NB2Editor → CSS module (M9, 3h)
Move the 300+ inline `style={{...}}` literals to
`NB2Editor.module.css`. Re-wire to design tokens.

### 3.6 Extract `useStateRef<T>` helper (M8, 45 min)

```ts
// frontend/src/hooks/useStateRef.ts
import { useEffect, useRef, useState } from 'react'

/** A useState whose current value is always readable from a ref, for
 *  stale-closure dodging inside long-lived callbacks. */
export function useStateRef<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return [value, setValue, ref] as const
}
```

Then the 7 mirror-ref sections in `useGenerateImage.ts` collapse:

```ts
const [aspectRatio, setAspectRatio, aspectRatioRef] = useStateRef(...)
const [resolution, setResolution, resolutionRef]   = useStateRef(...)
// etc.
```

---

## Phase 4 — Micro-optimizations (~3h, low priority)

### 4.1 Gate RAF loop in NB2 Viewport (m11, 1h)
Add `needsRender: useRef(true)` to the RAF callback; set `true` only on
scene changes.

### 4.2 Stream media upload (m12, 1h)
Replace `await file.read()` with a chunked `async for chunk in
file.stream()` loop writing to `dest.open("wb")`.

### 4.3 Debounce SPA `silentRefresh` (m8, 30 min)
In `useGalleryData.ts`, throttle the Socket.IO-triggered refetch to 500ms.

### 4.4 Centralize `isBackendAvailable` (m2, 5 min)
New `frontend/src/utils/runtime.ts`; import in `api.ts` and `ReviewTab.tsx`.

### 4.5 Table-drive Socket.IO relays (m1, 20 min)

```python
# src/review_hub/app.py (after)
_RELAYS = ["drawing_stroke", "drawing_clear", "drawing_undo",
           "cursor_move", "comment_new", "comment_delete",
           "favorite_toggle", "asset_link_new", "asset_link_delete"]

for _ev in _RELAYS:
    @sio.event(name=_ev)
    async def _relay(sid, data, _ev=_ev):
        await sio.emit(_ev, data, room="review", skip_sid=sid)
```

(Note: the `name=` kwarg and closure trick are the tricky bit — test this.)

---

## Running Order Summary

| PR | Phase | Effort | Findings closed | Blocks |
|----|-------|--------|-----------------|--------|
| 1 | 0.1 upload sanitize | 5 min | C1 | — |
| 2 | 0.2 Veo duration | 15 min | C2 | — |
| 3 | 0.3 sanitize unify | 30 min | M12 | — |
| 4 | 0.4 RH auto-discover | 30 min | M3 | — |
| 5 | 0.5 video.py rename | 10 min | M11 | — |
| 6 | 0.6 queries helper | 10 min | m13 | — |
| 7 | 1.1 transactional safety | 3h | M6 | — |
| 8-16 | 2.x model registry | 6-8h | C3, M10 | partially blocks frontend refactors |
| 17-22 | 3.x structural | ~10h | M1, M2, M4 (×2), M8, M9 | — |
| 23-27 | 4.x micro-opt | ~3h | m1, m2, m8, m11, m12 | — |

**To B (≥7.0)**: ship PRs 1-7 (~5h). **Full punch list**: ~24h over the
PR chain.

---

## Test Discipline

Every PR above must:
1. Ship a test that fails on the current code and passes on the fix.
2. Run `cd frontend && npx vitest run` green. (115 tests today.)
3. Run `python -m pytest` green. (98 tests today.)
4. Not regress the line `git grep "except: pass"` → still zero matches.

PRs that can't ship a test (e.g. 0.5 file rename) must at minimum show
the old import path returns ImportError after the change.
