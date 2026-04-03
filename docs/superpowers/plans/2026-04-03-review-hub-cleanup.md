# Review Hub Cleanup & Sidecar Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead sidecar system, fix broken bridge endpoints to query Review Hub DB directly, delete dead frontend code, add missing socket emits.

**Architecture:** Bridge endpoints that read `.review.json` files or proxy to `localhost:3002` are rewritten to query the Review Hub SQLite DB directly via existing `queries/` modules. Dead frontend components and API methods are deleted. Socket.io emits are added for `drawing_save` and `feedback_new`.

**Tech Stack:** Python/FastAPI, aiosqlite, React/TypeScript, Socket.io

---

### Task 1: Delete sidecar.py and remove dead query function

**Files:**
- Delete: `src/review_hub/sidecar.py`
- Modify: `src/review_hub/queries/favorites.py:45-52`

- [ ] **Step 1: Delete sidecar.py**

```bash
git rm src/review_hub/sidecar.py
```

- [ ] **Step 2: Remove `get_status()` from favorites.py**

In `src/review_hub/queries/favorites.py`, delete lines 45-52:

```python
# DELETE this entire function:
async def get_status(
    db: aiosqlite.Connection, media_id: int, user_name: str
) -> dict | None:
    cursor = await db.execute(
        "SELECT * FROM favorites WHERE media_id=? AND user_name=?",
        (media_id, user_name),
    )
    return _row_to_dict(await cursor.fetchone())
```

- [ ] **Step 3: Run backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "[fix] Remove dead sidecar.py and unused get_status() query"
```

---

### Task 2: Fix GET /api/bridge/review/{stem} to query DB directly

**Files:**
- Modify: `src/routers/bridge.py:118-125` (delete `_find_review_json`), `src/routers/bridge.py:361-380` (rewrite endpoint)

- [ ] **Step 1: Delete `_find_review_json()` helper**

In `src/routers/bridge.py`, delete lines 118-125:

```python
# DELETE this entire function:
def _find_review_json(stem: str) -> dict | None:
    """Search shared/Media/ recursively for {stem}.review.json and return parsed data, or None."""
    pattern = str(settings.media_dir / "**" / f"{stem}.review.json")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    review_path = Path(matches[0])
    return _json.loads(review_path.read_text(encoding="utf-8"))
```

- [ ] **Step 2: Add `_get_review_from_db()` helper**

Add this new helper in bridge.py where `_find_review_json` was:

```python
async def _get_review_from_db(stem: str) -> dict | None:
    """Query Review Hub DB for review status by filename stem."""
    import sqlite3

    db_path = settings.db_path
    if not db_path.exists():
        return None
    uri = db_path.as_uri() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT id FROM media WHERE filename LIKE ? LIMIT 1",
            (f"{stem}%",),
        ).fetchone()
        if not row:
            con.close()
            return None
        media_id = row["id"]
        favs = con.execute(
            "SELECT status, user_name FROM favorites WHERE media_id=?",
            (media_id,),
        ).fetchall()
        comment_count = con.execute(
            "SELECT COUNT(*) FROM comments WHERE media_id=?",
            (media_id,),
        ).fetchone()[0]
        drawing_count = con.execute(
            "SELECT COUNT(*) FROM drawings WHERE media_id=?",
            (media_id,),
        ).fetchone()[0]
        con.close()

        status = None
        reviewed_by = None
        favorite = False
        for f in favs:
            if f["status"] in ("approved", "rejected"):
                status = f["status"]
                reviewed_by = f["user_name"]
            if f["status"] == "favorite":
                favorite = True

        return {
            "status": status,
            "reviewed_by": reviewed_by,
            "favorite": favorite,
            "comments_count": comment_count,
            "drawings_count": drawing_count,
        }
    except Exception:
        return None
```

- [ ] **Step 3: Rewrite `get_review_status` endpoint**

Replace the `GET /review/{image_id}` endpoint:

```python
@router.get("/review/{image_id}")
async def get_review_status(image_id: str):
    """Read review status from Review Hub DB for a generated image.

    image_id is the filename stem, e.g. 'generated_1774482284911'.
    Returns review data or {"status": "not_reviewed"} if not found.
    """
    try:
        safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "", image_id)
        if not safe_id:
            return {"status": "not_reviewed"}
        data = await asyncio.to_thread(_get_review_from_db, safe_id)
        if data is None:
            return {"status": "not_reviewed"}
        return data
    except Exception as e:
        _log(f"Review status read error: {e}")
        return {"status": "not_reviewed"}
```

- [ ] **Step 4: Run backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add src/routers/bridge.py && git commit -m "[fix] Bridge review endpoint queries DB instead of sidecar files"
```

---

### Task 3: Delete batch review-status endpoint and fix favorite toggle

**Files:**
- Modify: `src/routers/bridge.py:383-419` (delete batch endpoint), `src/routers/bridge.py:508-535` (rewrite favorite)
- Modify: `src/shared.py:207-210` (delete FavoriteToggle)

- [ ] **Step 1: Delete `GET /review-status` batch endpoint**

In `src/routers/bridge.py`, delete the entire `get_review_status_batch` function (currently lines 383-419). No frontend calls it.

- [ ] **Step 2: Rewrite `POST /favorite` to call DB directly**

Replace the `toggle_favorite` endpoint with:

```python
@router.post("/favorite")
async def toggle_favorite(body: dict):
    """Toggle favorite/approved/rejected status via Review Hub DB.

    Body: { "stem": "generated_...", "status": "favorite"|"approved"|"rejected", "user_name": "aycb" }
    """
    stem = body.get("stem", "")
    status = body.get("status", "favorite")
    user_name = body.get("user_name", "aycb")

    media_id = await asyncio.to_thread(_lookup_media_id, stem)
    if media_id is None:
        raise HTTPException(status_code=404, detail=f"Media not found for stem: {stem}")

    from src.review_hub.db import get_db
    from src.review_hub.queries.favorites import toggle_favorite as db_toggle

    db = await get_db()
    try:
        result = await db_toggle(db, media_id=media_id, user_name=user_name, status=status)
        return result or {"ok": True}
    finally:
        await db.close()
```

- [ ] **Step 3: Update bridge.py import — remove FavoriteToggle**

In `src/routers/bridge.py` line 21, change:

```python
from src.shared import FavoriteToggle, _log
```

to:

```python
from src.shared import _log
```

- [ ] **Step 4: Delete FavoriteToggle from shared.py**

In `src/shared.py`, delete lines 206-210:

```python
# DELETE:
# ── Pydantic models used by multiple routers ─────────────────────────────────
class FavoriteToggle(BaseModel):
    stem: str
    status: str = "favorite"  # favorite | approved | rejected
    user_name: str = "aycb"
```

Keep the comment header if other models follow it (`PromptBody` etc).

- [ ] **Step 5: Run backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 6: Commit**

```bash
git add src/routers/bridge.py src/shared.py && git commit -m "[fix] Favorite toggle queries DB directly, remove dead batch endpoint"
```

---

### Task 4: Clean sidecar residue from bridge.py

**Files:**
- Modify: `src/routers/bridge.py:102-115` (clean `_delete_bridge_media`), `src/routers/bridge.py:184` (clean `_scan_media_list`)

- [ ] **Step 1: Remove .review.json deletion from `_delete_bridge_media()`**

Replace `_delete_bridge_media()` with:

```python
def _delete_bridge_media(stem: str) -> str | None:
    """Delete PNG for a given stem from shared/Media/. Returns deleted path or None."""
    pattern = str(settings.media_dir / "**" / f"{stem}.png")
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        return None
    png_path = Path(matches[0])
    deleted_path = str(png_path)
    png_path.unlink(missing_ok=True)
    _log(f"Bridge media deleted: {deleted_path}")
    return deleted_path
```

- [ ] **Step 2: Remove .review.json filter from `_scan_media_list()`**

In `_scan_media_list()`, delete line 184:

```python
# DELETE this line:
        if f.name.endswith(".meta.json") or f.name.endswith(".review.json"):
            continue
```

Replace with (only .meta.json if it's still relevant, or remove the whole check):

```python
        if f.name.endswith(".meta.json"):
            continue
```

- [ ] **Step 3: Update docstring on DELETE endpoint**

In `delete_bridge_media()` endpoint, change the docstring from:

```python
    """Delete a bridged image and its sidecars from shared/Media/.
```

to:

```python
    """Delete a bridged image from shared/Media/.
```

- [ ] **Step 4: Run backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add src/routers/bridge.py && git commit -m "[fix] Remove sidecar residue from bridge helpers"
```

---

### Task 5: Deduplicate _save_to_bridge()

**Files:**
- Modify: `src/routers/bridge.py:35-99` (delete local copy), `src/routers/bridge.py:21` (update import), `src/routers/bridge.py:311` (verify call still works)

- [ ] **Step 1: Delete `_save_to_bridge()` from bridge.py**

Delete the entire function at lines 35-99 in bridge.py.

- [ ] **Step 2: Import from shared.py**

Update the import at line 21:

```python
from src.shared import _log, _save_to_bridge
```

- [ ] **Step 3: Remove unused imports from bridge.py**

After removing the local `_save_to_bridge`, these imports are no longer needed in bridge.py (verify before removing — other functions may use them):

- `PngInfo` from `PIL.PngImagePlugin` — check if any other function uses it. `_find_png_meta` uses `PILImage` but not `PngInfo`. Safe to remove.
- `datetime, timezone` from `datetime` — check if `_scan_media_list` still uses them. It does (line 196). Keep.
- `io` — check if `bridge_media` endpoint uses it. The endpoint uses `base64.b64decode` but not `io.BytesIO` directly anymore. Safe to remove only if no other function needs it.

Only remove `PngInfo` import. Keep the rest.

- [ ] **Step 4: Verify shared.py version handles bridge.py's call site**

The `bridge_media` endpoint (line 311) calls `_save_to_bridge(img_bytes=..., prompt=..., ...)`. The shared.py version has the same signature. No change needed.

- [ ] **Step 5: Run backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 6: Commit**

```bash
git add src/routers/bridge.py && git commit -m "[refactor] Deduplicate _save_to_bridge — single source in shared.py"
```

---

### Task 6: Add missing socket.io emits

**Files:**
- Modify: `src/review_hub/routes/drawings.py:29-42`
- Modify: `src/review_hub/routes/feedback.py:29-42`

- [ ] **Step 1: Add socket emit to drawings POST handler**

In `src/review_hub/routes/drawings.py`, update `save_drawing`:

```python
@router.post("/drawings")
async def save_drawing(body: DrawingBody):
    db = await get_db()
    try:
        new_id = await q.save_drawing(
            db,
            media_id=body.media_id,
            author=body.author,
            strokes_json=body.strokes_json,
            thumbnail_data=body.thumbnail_data,
        )
        return {"id": new_id}
    finally:
        await db.close()
        from src.review_hub.app import sio
        await sio.emit("drawing_save", {"media_id": body.media_id, "author": body.author}, room="review")
```

- [ ] **Step 2: Add socket emit to feedback POST handler**

In `src/review_hub/routes/feedback.py`, update `add_feedback`:

```python
@router.post("/feedback")
async def add_feedback(body: FeedbackBody):
    db = await get_db()
    try:
        fid = await q.add_feedback(
            db,
            message=body.message,
            category=body.category,
            author=body.author,
            urgent=body.urgent,
        )
        return {"id": fid}
    finally:
        await db.close()
        from src.review_hub.app import sio
        await sio.emit("feedback_new", {"id": fid, "category": body.category, "urgent": body.urgent}, room="review")
```

- [ ] **Step 3: Run backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 4: Commit**

```bash
git add src/review_hub/routes/drawings.py src/review_hub/routes/feedback.py && git commit -m "[feat] Add socket emits for drawing_save and feedback_new"
```

---

### Task 7: Delete dead frontend files

**Files:**
- Delete: `frontend/src/review/components/AnnotationCanvas.tsx`
- Delete: `frontend/src/review/components/FolderManager.tsx`
- Delete: `frontend/src/review/components/UserNameModal.tsx`
- Delete: `frontend/src/review/hooks/useDrawing.ts`

- [ ] **Step 1: Delete dead files**

```bash
cd C:/Users/upper/Documents/00_aycb_v2
git rm frontend/src/review/components/AnnotationCanvas.tsx
git rm frontend/src/review/components/FolderManager.tsx
git rm frontend/src/review/components/UserNameModal.tsx
git rm frontend/src/review/hooks/useDrawing.ts
```

- [ ] **Step 2: Run frontend type check**

Run: `cd C:/Users/upper/Documents/00_aycb_v2/frontend && npx tsc --noEmit`
Expected: clean (no errors, these files were never imported)

- [ ] **Step 3: Run frontend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run`
Expected: 115 passing

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "[refactor] Delete dead frontend components and hooks"
```

---

### Task 8: Remove dead API methods from frontend

**Files:**
- Modify: `frontend/src/review/services/api.ts:29,32,46-48,55-61,76`

- [ ] **Step 1: Remove 7 dead methods from rhApi**

In `frontend/src/review/services/api.ts`, remove these properties from the `rhApi` object:

```typescript
// DELETE these lines:
  getMedia: (id: number) => get<unknown>(`/media/${id}`),
  getStats: () => get<{ count: number; total_size: number }>('/media/stats'),
  uploadMedia: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return post<{ filename: string; path: string }>('/upload/media', fd)
  },
  listFolders: () => get<{ folders: string[] }>('/folders'),
  getSubfolders: (project: string) =>
    get<unknown[]>('/folders', { project }),
  renameFolder: (name: string, body: { new_name: string }) =>
    post<unknown>(`/folders/${encodeURIComponent(name)}/rename`, body),
  streamUrl: (id: number) => `${BASE}/media/${id}/stream`,
```

Keep all other methods.

- [ ] **Step 2: Run frontend type check**

Run: `cd C:/Users/upper/Documents/00_aycb_v2/frontend && npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Run frontend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run`
Expected: 115 passing

- [ ] **Step 4: Commit**

```bash
git add frontend/src/review/services/api.ts && git commit -m "[refactor] Remove 7 dead API methods from Review Hub frontend"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2 && python -m pytest tests/ -q`
Expected: 10 passed

- [ ] **Step 2: Run all frontend tests**

Run: `cd C:/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run`
Expected: 115 passing

- [ ] **Step 3: TypeScript type check**

Run: `cd C:/Users/upper/Documents/00_aycb_v2/frontend && npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Verify bridge review endpoint returns DB data**

Run: `python -c "from src.routers.bridge import _get_review_from_db; print(_get_review_from_db.__doc__)"`
Expected: prints docstring confirming DB-based implementation

- [ ] **Step 5: Verify no sidecar references remain**

Run: `grep -r "sidecar\|review\.json" src/ --include="*.py" | grep -v __pycache__`
Expected: no matches (or only the `.meta.json` filter)

- [ ] **Step 6: Verify no localhost:3002 references remain**

Run: `grep -r "localhost:300[0-9]" src/ --include="*.py" | grep -v __pycache__`
Expected: no matches
