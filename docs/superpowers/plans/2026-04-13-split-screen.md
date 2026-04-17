# Split Screen (Gallery + Assets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a split-screen mode to Review Hub showing Gallery and Assets side-by-side with drag-to-link from Gallery cards into asset folders.

**Architecture:** New `media_asset_links` DB table stores references (no file copy). A "Split" toggle in the tab bar renders both panels with a draggable divider. Native HTML5 drag-and-drop carries `media_id` from MediaCard to AssetsPanel drop zones.

**Tech Stack:** React 19, aiosqlite, FastAPI, Socket.IO, native HTML5 DnD API

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/review_hub/queries/asset_links.py` | DB queries: create_link, delete_link, list_links_for_directory |
| `src/review_hub/routes/asset_links.py` | REST endpoints: POST /link, DELETE /link/{id} |
| `frontend/src/review/components/SplitDivider.tsx` | Draggable vertical divider between panels |

### Modified Files

| File | Change |
|---|---|
| `src/review_hub/schema.sql` | Add `media_asset_links` table + index |
| `src/review_hub/app.py` | Import asset_links route, add socket relay events |
| `src/review_hub/routes/assets.py` | Merge linked media into list_assets response |
| `frontend/src/review/services/api.ts` | Add linkAsset(), unlinkAsset() methods |
| `frontend/src/review/pages/ReviewGallery.tsx` | Split toggle state, dual-panel layout |
| `frontend/src/review/components/MediaCard.tsx` | Add draggable + onDragStart when split_mode |
| `frontend/src/review/components/MediaGrid.tsx` | Pass split_mode prop to cards |
| `frontend/src/review/components/AssetsPanel.tsx` | Accept split_mode, drop handlers, show linked items |
| `frontend/src/review/styles/review.css` | Split layout, divider, drag feedback styles |

---

### Task 1: DB Schema — media_asset_links Table

**Files:**
- Modify: `src/review_hub/schema.sql:112` (append after last line)
- Test: `tests/test_rh_asset_links.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_rh_asset_links.py`:

```python
"""Tests for media_asset_links table and queries."""
from __future__ import annotations
import pytest
import aiosqlite
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "src" / "review_hub" / "schema.sql"

@pytest.fixture
async def db(tmp_path):
    db_path = tmp_path / "test.db"
    conn = await aiosqlite.connect(str(db_path))
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys=ON")
    schema = SCHEMA.read_text(encoding="utf-8")
    await conn.executescript(schema)
    await conn.commit()
    # Insert a media row for FK
    await conn.execute(
        "INSERT INTO media (id, filename) VALUES (1, 'test.png')"
    )
    await conn.commit()
    yield conn
    await conn.close()

@pytest.mark.asyncio
async def test_media_asset_links_table_exists(db):
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='media_asset_links'"
    )
    row = await cursor.fetchone()
    assert row is not None

@pytest.mark.asyncio
async def test_insert_link(db):
    await db.execute(
        "INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'characters/heroes')"
    )
    await db.commit()
    cursor = await db.execute("SELECT * FROM media_asset_links WHERE media_id=1")
    row = await cursor.fetchone()
    assert row is not None
    assert row["directory"] == "characters/heroes"

@pytest.mark.asyncio
async def test_unique_constraint(db):
    await db.execute(
        "INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'heroes')"
    )
    await db.commit()
    with pytest.raises(aiosqlite.IntegrityError):
        await db.execute(
            "INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'heroes')"
        )

@pytest.mark.asyncio
async def test_cascade_delete(db):
    await db.execute(
        "INSERT INTO media_asset_links (media_id, directory) VALUES (1, 'heroes')"
    )
    await db.commit()
    await db.execute("DELETE FROM media WHERE id=1")
    await db.commit()
    cursor = await db.execute("SELECT * FROM media_asset_links")
    rows = await cursor.fetchall()
    assert len(rows) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_rh_asset_links.py -v`
Expected: FAIL — `media_asset_links` table does not exist.

- [ ] **Step 3: Add the table to schema.sql**

Append to `src/review_hub/schema.sql` after line 111:

```sql

CREATE TABLE IF NOT EXISTS media_asset_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    directory TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(media_id, directory),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_asset_links_media ON media_asset_links(media_id);
CREATE INDEX IF NOT EXISTS idx_media_asset_links_dir ON media_asset_links(directory);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_rh_asset_links.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/review_hub/schema.sql tests/test_rh_asset_links.py
git commit -m "[feat] media_asset_links table — link media to asset folders"
```

---

### Task 2: Backend Queries — asset_links.py

**Files:**
- Create: `src/review_hub/queries/asset_links.py`
- Modify: `tests/test_rh_asset_links.py` (add query tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_rh_asset_links.py`:

```python
from src.review_hub.queries import asset_links as alq

@pytest.mark.asyncio
async def test_create_link(db):
    link = await alq.create_link(db, media_id=1, directory="chars")
    assert link["media_id"] == 1
    assert link["directory"] == "chars"
    assert link["id"] is not None

@pytest.mark.asyncio
async def test_create_link_duplicate_returns_existing(db):
    link1 = await alq.create_link(db, media_id=1, directory="chars")
    link2 = await alq.create_link(db, media_id=1, directory="chars")
    assert link1["id"] == link2["id"]

@pytest.mark.asyncio
async def test_delete_link(db):
    link = await alq.create_link(db, media_id=1, directory="chars")
    deleted = await alq.delete_link(db, link["id"])
    assert deleted is True
    cursor = await db.execute("SELECT * FROM media_asset_links WHERE id=?", (link["id"],))
    assert await cursor.fetchone() is None

@pytest.mark.asyncio
async def test_delete_nonexistent_link(db):
    deleted = await alq.delete_link(db, 9999)
    assert deleted is False

@pytest.mark.asyncio
async def test_list_links_for_directory(db):
    await alq.create_link(db, media_id=1, directory="chars")
    links = await alq.list_links_for_directory(db, "chars")
    assert len(links) == 1
    assert links[0]["media_id"] == 1
    # Should include media fields from JOIN
    assert links[0]["filename"] == "test.png"

@pytest.mark.asyncio
async def test_list_links_empty_directory(db):
    links = await alq.list_links_for_directory(db, "empty")
    assert links == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_rh_asset_links.py -v -k "create_link or delete_link or list_links"`
Expected: FAIL — module `asset_links` does not exist.

- [ ] **Step 3: Implement queries**

Create `src/review_hub/queries/asset_links.py`:

```python
"""Query helpers for the media_asset_links table."""
from __future__ import annotations

import aiosqlite


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)


def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


async def create_link(
    db: aiosqlite.Connection,
    *,
    media_id: int,
    directory: str,
) -> dict:
    """Create a link or return existing if duplicate."""
    try:
        await db.execute(
            "INSERT INTO media_asset_links (media_id, directory) VALUES (?, ?)",
            (media_id, directory),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        pass  # duplicate — return existing
    cursor = await db.execute(
        "SELECT * FROM media_asset_links WHERE media_id=? AND directory=?",
        (media_id, directory),
    )
    return _row_to_dict(await cursor.fetchone())


async def delete_link(db: aiosqlite.Connection, link_id: int) -> bool:
    """Delete a link by id. Returns True if deleted."""
    cursor = await db.execute(
        "DELETE FROM media_asset_links WHERE id=?", (link_id,)
    )
    await db.commit()
    return cursor.rowcount > 0


async def list_links_for_directory(
    db: aiosqlite.Connection, directory: str
) -> list[dict]:
    """List all links in a directory, joined with media fields."""
    cursor = await db.execute(
        """SELECT l.id AS link_id, l.media_id, l.directory, l.created_at AS linked_at,
                  m.filename, m.filepath, m.thumbnail_path, m.mime_type,
                  m.file_size, m.width, m.height
           FROM media_asset_links l
           JOIN media m ON m.id = l.media_id
           WHERE l.directory = ?
           ORDER BY l.created_at DESC""",
        (directory,),
    )
    return _rows_to_list(await cursor.fetchall())
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_rh_asset_links.py -v`
Expected: All 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/review_hub/queries/asset_links.py tests/test_rh_asset_links.py
git commit -m "[feat] asset_links queries — create, delete, list with media JOIN"
```

---

### Task 3: Backend Route — asset_links.py

**Files:**
- Create: `src/review_hub/routes/asset_links.py`
- Modify: `src/review_hub/app.py:111` (add to router list)
- Modify: `src/review_hub/app.py:74-76` (add socket relay events)

- [ ] **Step 1: Write the route module**

Create `src/review_hub/routes/asset_links.py`:

```python
"""Routes for media-to-asset linking."""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from src.review_hub.db import get_db
from src.review_hub.queries import asset_links as q
from src.review_hub.queries import media as mq

router = APIRouter(prefix="/api/rh", tags=["review-hub"])


class LinkBody(BaseModel):
    media_id: int
    directory: str = ""


@router.post("/assets/link")
async def create_asset_link(body: LinkBody):
    db = await get_db()
    try:
        media = await mq.get_media(db, body.media_id)
        if media is None:
            raise HTTPException(status_code=404, detail="Media not found")
        link = await q.create_link(
            db, media_id=body.media_id, directory=body.directory
        )
        return {"status": "ok", "id": link["id"], "link": link}
    finally:
        await db.close()


@router.delete("/assets/link/{link_id}")
async def delete_asset_link(link_id: int):
    db = await get_db()
    try:
        deleted = await q.delete_link(db, link_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Link not found")
        return {"status": "ok"}
    finally:
        await db.close()
```

- [ ] **Step 2: Register the route in app.py**

In `src/review_hub/app.py`, add import at the top with other route imports and add `asset_links` to the router list at line 111:

Import (add near other route imports):
```python
from src.review_hub.routes import asset_links
```

Modify line 111 — add `asset_links` to the list:
```python
    for router_mod in [media, comments, favorites, drawings, references, upload, download, folders, feedback, logs, assets, asset_folders, asset_links]:
```

- [ ] **Step 3: Add socket relay events in app.py**

Add after the existing `favorite_toggle` event relay (after line 76):

```python
@sio.event
async def asset_link_new(sid, data):
    await sio.emit("asset_link_new", data, room="review", skip_sid=sid)

@sio.event
async def asset_link_delete(sid, data):
    await sio.emit("asset_link_delete", data, room="review", skip_sid=sid)
```

- [ ] **Step 4: Run full backend tests**

Run: `python -m pytest --tb=short -q`
Expected: All pass (168 existing + 10 new).

- [ ] **Step 5: Commit**

```bash
git add src/review_hub/routes/asset_links.py src/review_hub/app.py
git commit -m "[feat] asset link route — POST/DELETE /api/rh/assets/link"
```

---

### Task 4: Merge Linked Items into Assets List

**Files:**
- Modify: `src/review_hub/routes/assets.py:40-47`

- [ ] **Step 1: Modify list_assets to include linked media**

In `src/review_hub/routes/assets.py`, update the `list_assets` endpoint to merge linked items.

Add import at top:
```python
from src.review_hub.queries import asset_links as alq
```

Replace the `list_assets` function (lines 40-47):

```python
@router.get("/assets")
async def list_assets(directory: str | None = None):
    db = await get_db()
    try:
        items = await q.list_assets(db, directory=directory)
        enriched = [_enrich(i) for i in items]
        # Merge linked media for this directory
        links = await alq.list_links_for_directory(db, directory or "")
        for link in links:
            thumb = link.get("thumbnail_path")
            thumb_url = None
            if thumb:
                try:
                    from config.settings import settings
                    thumb_url = "/thumbnails/" + Path(thumb).relative_to(settings.thumbnails_dir).as_posix()
                except (ValueError, TypeError):
                    pass
            fp = link.get("filepath")
            media_url = None
            if fp:
                from config.settings import settings
                try:
                    media_url = "/media/" + Path(fp).relative_to(settings.media_dir).as_posix()
                except (ValueError, TypeError):
                    media_url = f"/media/{link.get('filename', '')}"
            enriched.append({
                "id": link["link_id"],
                "filename": link["filename"],
                "directory": link["directory"],
                "file_size": link.get("file_size"),
                "mime_type": link.get("mime_type"),
                "width": link.get("width"),
                "height": link.get("height"),
                "asset_url": media_url,
                "thumbnail_url": thumb_url,
                "is_link": True,
                "media_id": link["media_id"],
                "link_id": link["link_id"],
            })
        return {"items": enriched, "total": len(enriched)}
    finally:
        await db.close()
```

- [ ] **Step 2: Run backend tests**

Run: `python -m pytest --tb=short -q`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/review_hub/routes/assets.py
git commit -m "[feat] assets list merges linked media items"
```

---

### Task 5: Frontend API — linkAsset / unlinkAsset

**Files:**
- Modify: `frontend/src/review/services/api.ts:84` (add before closing brace)

- [ ] **Step 1: Add API methods**

In `frontend/src/review/services/api.ts`, add before the closing `}` of `rhApi` (before line 95):

```typescript
  // Asset links
  linkAsset: (body: { media_id: number; directory: string }) =>
    post<{ status: string; id: number }>('/assets/link', body),
  unlinkAsset: (link_id: number) => del(`/assets/link/${link_id}`),
```

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All 280 pass (no new tests needed — API methods are thin wrappers).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/review/services/api.ts
git commit -m "[feat] frontend API — linkAsset / unlinkAsset methods"
```

---

### Task 6: SplitDivider Component

**Files:**
- Create: `frontend/src/review/components/SplitDivider.tsx`
- Modify: `frontend/src/review/styles/review.css` (append styles)

- [ ] **Step 1: Create SplitDivider component**

Create `frontend/src/review/components/SplitDivider.tsx`:

```tsx
import { useCallback, useRef } from 'react'

interface Props {
  on_ratio_change: (ratio: number) => void
}

export function SplitDivider({ on_ratio_change }: Props) {
  const dragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const parent = (e.currentTarget as HTMLElement).parentElement
    if (!parent) return

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const rect = parent.getBoundingClientRect()
      // Subtract the directory sidebar width (220px)
      const contentLeft = rect.left + 220
      const contentWidth = rect.width - 220
      const x = ev.clientX - contentLeft
      let ratio = x / contentWidth
      if (ratio < 0.3) ratio = 0.3
      if (ratio > 0.7) ratio = 0.7
      on_ratio_change(ratio)
    }

    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [on_ratio_change])

  return (
    <div className="rh-split-divider" onMouseDown={handleMouseDown}>
      <div className="rh-split-divider-grip" />
    </div>
  )
}
```

- [ ] **Step 2: Add CSS styles**

Append to `frontend/src/review/styles/review.css`:

```css
/* ── Split Screen ─────────────────────────── */
.rh-split-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.rh-split-left {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.rh-split-right {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.rh-split-divider {
  width: 5px;
  flex-shrink: 0;
  background: var(--border, #272727);
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.rh-split-divider:hover,
.rh-split-divider:active {
  background: var(--accent, #F52776);
}
.rh-split-divider-grip {
  width: 3px;
  height: 24px;
  background: var(--text-dim, #555);
  border-radius: 2px;
}
.rh-split-divider:hover .rh-split-divider-grip {
  background: var(--text-primary, #fafafa);
}

/* Tab: Split active */
.rh-tab-split { margin-left: auto; }
.rh-tab-split-active {
  color: var(--accent, #F52776);
  border-bottom-color: var(--accent, #F52776);
  background: var(--accent-glow, #F5277615);
}

/* Drag feedback */
.rh-card--dragging {
  opacity: 0.4;
  outline: 2px solid var(--accent, #F52776);
  outline-offset: -2px;
}
.rh-assets-drop-active {
  outline: 2px dashed var(--accent, #F52776);
  outline-offset: -2px;
  background: var(--accent-glow, #F5277610);
}
.rh-assets-folder-drop-active {
  background: var(--accent-glow, #F5277620);
  outline: 1px dashed var(--accent, #F52776);
}
.rh-asset-link-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 10px;
  color: var(--accent, #F52776);
  background: var(--surface-1, #111);
  padding: 1px 4px;
  border-radius: 2px;
  line-height: 1;
}
```

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/review/components/SplitDivider.tsx frontend/src/review/styles/review.css
git commit -m "[feat] SplitDivider component + split screen CSS"
```

---

### Task 7: MediaCard — Draggable in Split Mode

**Files:**
- Modify: `frontend/src/review/components/MediaCard.tsx:19-27,58-79`
- Modify: `frontend/src/review/components/MediaGrid.tsx:4-15,17-53`

- [ ] **Step 1: Add split_mode prop to MediaCard**

In `frontend/src/review/components/MediaCard.tsx`, add `split_mode` to `MediaCardProps` (line 19):

```typescript
interface MediaCardProps {
  media: MediaCardMedia
  selected: boolean
  show_checkbox: boolean
  is_admin: boolean
  split_mode?: boolean
  on_click: () => void
  on_select: (e: React.MouseEvent) => void
  on_context_menu: (e: React.MouseEvent) => void
  on_delete?: () => void
}
```

Update the component destructuring (line 58) to include `split_mode`:

```typescript
export function MediaCard({
  media,
  selected,
  show_checkbox,
  is_admin,
  split_mode,
  on_click,
  on_select,
  on_context_menu,
  on_delete,
}: MediaCardProps) {
```

Add drag state and handlers before the return (after line 70):

```typescript
  const [isDragging, setIsDragging] = React.useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/x-media-id', String(media.id))
    e.dataTransfer.effectAllowed = 'link'
    setIsDragging(true)
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }
```

Update the root div (line 73) to include drag props:

```tsx
    <div
      className={`rh-card${selected ? ' rh-card--selected' : ''}${isDragging ? ' rh-card--dragging' : ''}`}
      tabIndex={0}
      draggable={!!split_mode}
      onDragStart={split_mode ? handleDragStart : undefined}
      onDragEnd={split_mode ? handleDragEnd : undefined}
      onClick={on_click}
      onContextMenu={on_context_menu}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); on_click() } }}
    >
```

- [ ] **Step 2: Add split_mode prop to MediaGrid**

In `frontend/src/review/components/MediaGrid.tsx`, add `split_mode` to Props (line 4):

```typescript
interface Props {
  items: MediaCardMedia[]
  selectedId: number | null
  onSelect: (id: number) => void
  onDoubleClick: (id: number) => void
  selected_ids?: Set<number>
  show_checkboxes?: boolean
  is_admin?: boolean
  split_mode?: boolean
  on_card_select?: (id: number, e: React.MouseEvent) => void
  on_context_menu?: (id: number, e: React.MouseEvent) => void
  on_delete?: (id: number) => void
}
```

Destructure `split_mode` in the component and pass it to MediaCard:

```tsx
export function MediaGrid({
  items,
  selectedId,
  onSelect,
  onDoubleClick,
  selected_ids,
  show_checkboxes = false,
  is_admin = false,
  split_mode = false,
  on_card_select,
  on_context_menu,
  on_delete,
}: Props) {
```

In the MediaCard render (around line 42), add the prop:

```tsx
        <MediaCard
          key={item.id}
          media={item}
          selected={selected_ids?.has(item.id) ?? selectedId === item.id}
          show_checkbox={show_checkboxes}
          is_admin={is_admin}
          split_mode={split_mode}
          on_click={() => handleClick(item.id)}
          on_select={(e) => on_card_select?.(item.id, e)}
          on_context_menu={(e) => on_context_menu?.(item.id, e)}
          on_delete={on_delete ? () => on_delete(item.id) : undefined}
        />
```

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/review/components/MediaCard.tsx frontend/src/review/components/MediaGrid.tsx
git commit -m "[feat] MediaCard/Grid — draggable in split mode"
```

---

### Task 8: AssetsPanel — Drop Handlers + Linked Items

**Files:**
- Modify: `frontend/src/review/components/AssetsPanel.tsx`

- [ ] **Step 1: Add split_mode prop and drop handlers**

In `frontend/src/review/components/AssetsPanel.tsx`:

Update Props interface (line 20):

```typescript
interface Props {
  active: boolean
  split_mode?: boolean
}
```

Update destructuring (line 24):

```typescript
export function AssetsPanel({ active, split_mode }: Props) {
```

Add drop state after existing state declarations (after line 35):

```typescript
  const [dropTarget, setDropTarget] = useState<string | null>(null)
```

Add drag-and-drop handlers after `handleAssetContext` (after line 155):

```typescript
  const handleGridDragOver = (e: React.DragEvent) => {
    if (!split_mode) return
    if (!e.dataTransfer.types.includes('text/x-media-id')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'link'
    setDropTarget('grid')
  }

  const handleGridDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTarget(null)
    }
  }

  const handleGridDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
    const mediaId = e.dataTransfer.getData('text/x-media-id')
    if (!mediaId) return
    try {
      await rhApi.linkAsset({ media_id: Number(mediaId), directory: activeFolder || '' })
      toast.success('Linked to assets')
      void loadAssets(activeFolder)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed')
    }
  }

  const handleFolderDragOver = (e: React.DragEvent, folder: string) => {
    if (!split_mode) return
    if (!e.dataTransfer.types.includes('text/x-media-id')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'link'
    const fullPath = activeFolder ? `${activeFolder}/${folder}` : folder
    setDropTarget(fullPath)
  }

  const handleFolderDragLeave = () => {
    setDropTarget(null)
  }

  const handleFolderDrop = async (e: React.DragEvent, folder: string) => {
    e.preventDefault()
    setDropTarget(null)
    const mediaId = e.dataTransfer.getData('text/x-media-id')
    if (!mediaId) return
    const fullPath = activeFolder ? `${activeFolder}/${folder}` : folder
    try {
      await rhApi.linkAsset({ media_id: Number(mediaId), directory: fullPath })
      toast.success(`Linked to ${folder}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed')
    }
  }

  const handleUnlink = async (linkId: number) => {
    try {
      await rhApi.unlinkAsset(linkId)
      toast.success('Link removed')
      void loadAssets(activeFolder)
    } catch { toast.error('Failed to remove link') }
  }
```

Update the `AssetItem` interface (line 8) to include link fields:

```typescript
interface AssetItem {
  id: number
  filename: string
  directory: string | null
  file_size: number | null
  mime_type: string | null
  width: number | null
  height: number | null
  asset_url: string
  thumbnail_url: string | null
  is_link?: boolean
  media_id?: number
  link_id?: number
}
```

- [ ] **Step 2: Wire drop handlers to JSX**

Update the folder row div (line 169) to accept drops:

```tsx
          <div
            key={folder}
            className={`rh-assets-folder-row ${activeFolder === folder ? 'rh-assets-folder-active' : ''}${dropTarget === (activeFolder ? `${activeFolder}/${folder}` : folder) ? ' rh-assets-folder-drop-active' : ''}`}
            onContextMenu={e => handleFolderContext(e, folder)}
            onDragOver={e => handleFolderDragOver(e, folder)}
            onDragLeave={handleFolderDragLeave}
            onDrop={e => handleFolderDrop(e, folder)}
          >
```

Update `.rh-assets-content` div (line 211) to accept drops on the grid:

```tsx
      <div
        className={`rh-assets-content${dropTarget === 'grid' ? ' rh-assets-drop-active' : ''}`}
        onContextMenu={handleGridContext}
        onDragOver={handleGridDragOver}
        onDragLeave={handleGridDragLeave}
        onDrop={handleGridDrop}
      >
```

In the asset card render (line 234), add link badge and unlink action:

```tsx
              <div key={asset.id} className="rh-asset-card" onClick={() => setViewUrl(asset.asset_url)} onContextMenu={e => handleAssetContext(e, asset)}>
                {asset.is_link && <span className="rh-asset-link-badge">Link</span>}
                <div className="rh-asset-thumb-wrap">
```

Update `handleAssetContext` to add unlink option for linked items (replace lines 145-155):

```typescript
  const handleAssetContext = (e: React.MouseEvent, asset: AssetItem) => {
    e.preventDefault()
    e.stopPropagation()
    const items: { label: string; danger?: boolean; on_click: () => void }[] = [
      { label: 'Open', on_click: () => setViewUrl(asset.asset_url) },
    ]
    if (asset.is_link && asset.link_id) {
      items.push({ label: 'Remove Link', danger: true, on_click: () => void handleUnlink(asset.link_id!) })
    } else if (is_admin) {
      items.push({ label: 'Delete', danger: true, on_click: () => void handleDeleteAsset(asset.id) })
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }
```

- [ ] **Step 3: Add socket listener for link events**

In the existing socket useEffect (line 64), add link event listeners:

```typescript
  useEffect(() => {
    if (!active) return
    const refresh = () => { void loadFolders(activeFolder); void loadAssets(activeFolder) }
    onEvent('assets_update', refresh)
    onEvent('asset_link_new', refresh)
    onEvent('asset_link_delete', refresh)
    return () => {
      offEvent('assets_update', refresh)
      offEvent('asset_link_new', refresh)
      offEvent('asset_link_delete', refresh)
    }
  }, [active, activeFolder, loadAssets, loadFolders])
```

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/review/components/AssetsPanel.tsx
git commit -m "[feat] AssetsPanel — drop handlers, linked items, unlink context menu"
```

---

### Task 9: ReviewGallery — Split Toggle + Dual Layout

**Files:**
- Modify: `frontend/src/review/pages/ReviewGallery.tsx`

- [ ] **Step 1: Add split state and imports**

At line 17, add the SplitDivider import:

```typescript
import { SplitDivider } from '../components/SplitDivider'
```

Update the Tab type (line 19):

```typescript
type Tab = 'gallery' | 'references' | 'assets'
```

Add split state after the tab state (after line 22):

```typescript
  const [splitMode, setSplitMode] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.5)
```

- [ ] **Step 2: Add Split button to tab bar**

Replace the tab bar (lines 234-238) with:

```tsx
        <div className="rh-tab-bar">
          <button className={`rh-tab ${tab === 'gallery' && !splitMode ? 'rh-tab-active' : ''}`} onClick={() => { setTab('gallery'); setSplitMode(false) }}>Gallery</button>
          <button className={`rh-tab ${tab === 'references' ? 'rh-tab-active' : ''}`} onClick={() => { setTab('references'); setSplitMode(false) }}>References</button>
          <button className={`rh-tab ${tab === 'assets' && !splitMode ? 'rh-tab-active' : ''}`} onClick={() => { setTab('assets'); setSplitMode(false) }}>Assets</button>
          <button className={`rh-tab rh-tab-split ${splitMode ? 'rh-tab-split-active' : ''}`} onClick={() => { setSplitMode(!splitMode); if (!splitMode) setTab('gallery') }}>Split</button>
        </div>
```

- [ ] **Step 3: Add split layout rendering**

After the tab bar and before the gallery tab conditional (between lines 238 and 240), add the split mode block:

```tsx
        {splitMode && (
          <div className="rh-split-container">
            <div className="rh-split-left" style={{ flex: splitRatio }}>
              <FilterBar search={search} active_filter={activeFilter} sort_by={sortBy}
                on_search_change={setSearch} on_filter_change={setActiveFilter} on_sort_change={setSortBy} />
              {selectedIds.size > 0 && (
                <BulkBar selected_count={selectedIds.size} total_count={filteredMedia.length} is_admin={is_admin}
                  on_select_all={handleSelectAll} on_clear={handleClearSelection}
                  on_approve={handleBulkApprove} on_reject={handleBulkReject}
                  on_download={handleBulkDownload} on_delete={handleBulkDelete} on_move={handleBulkMove} />
              )}
              <StatsBar total={stats.total} favorite_count={stats.favorite_count} comment_count={stats.comment_count} />
              <div className="rh-gallery-area">
                <MediaGrid items={filteredMedia} selectedId={selectedMediaId}
                  onSelect={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
                  onDoubleClick={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
                  selected_ids={selectedIds} show_checkboxes={selectedIds.size > 0} is_admin={is_admin}
                  split_mode={true}
                  on_card_select={handleSelect} on_context_menu={handleContextMenu}
                  on_delete={handleSingleDelete} />
              </div>
            </div>
            <SplitDivider on_ratio_change={setSplitRatio} />
            <div className="rh-split-right" style={{ flex: 1 - splitRatio }}>
              <AssetsPanel active={true} split_mode={true} />
            </div>
          </div>
        )}
```

Update the existing gallery tab to only show when NOT in split mode (line 240):

```tsx
        {tab === 'gallery' && !splitMode && <>
```

Update the AssetsPanel render at the bottom (line 299) to only show when NOT in split mode:

```tsx
        {!splitMode && <AssetsPanel active={tab === 'assets'} />}
```

- [ ] **Step 4: Run all tests**

Run: `cd frontend && npx vitest run`
Run: `python -m pytest --tb=short -q`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/review/pages/ReviewGallery.tsx
git commit -m "[feat] ReviewGallery — Split toggle + dual-panel layout"
```

---

### Task 10: Manual Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Start dev servers**

Verify backend + frontend are running:
```bash
# Backend
python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload

# Frontend
cd frontend && npm run dev
```

- [ ] **Step 2: Verify split toggle**

Open http://localhost:5100/review:
1. Click "Split" in the tab bar → Gallery left, Assets right appear side-by-side.
2. Click "Gallery" → returns to normal single gallery view.
3. Click "Split" again → split mode activates, tab highlights with accent color.

- [ ] **Step 3: Verify drag-and-drop**

In split mode:
1. Drag a media card from the Gallery panel → card shows reduced opacity + accent outline.
2. Drop on the Assets grid area → toast "Linked to assets", item appears in assets with "Link" badge.
3. Drag another card → drop on a visible folder in the assets sidebar → toast "Linked to {folder}".

- [ ] **Step 4: Verify divider**

1. Drag the divider left → gallery shrinks, assets grows.
2. Drag right → gallery grows, assets shrinks.
3. Verify it clamps at ~30% per side.

- [ ] **Step 5: Verify unlink**

1. Right-click a linked item in Assets → "Remove Link" option appears.
2. Click "Remove Link" → item disappears from assets, toast confirms.

- [ ] **Step 6: Run full test suites**

```bash
cd frontend && npx vitest run
python -m pytest --tb=short -q
```

Expected: All pass.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "[feat] split screen — Gallery + Assets drag-to-link"
```
