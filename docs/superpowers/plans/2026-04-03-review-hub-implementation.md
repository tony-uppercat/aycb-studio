# Review Hub v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Review Hub to Python FastAPI with python-socketio, aiosqlite, and Pillow. Same v0 UI, no Node.js.

**Architecture:** Single FastAPI process serves both AYCB and Review Hub. Socket.io mounted via ASGI. Review Hub is a self-contained package at `src/review_hub/`. Frontend adds `/review` route via pathname check.

**Tech Stack:** FastAPI, python-socketio[asyncio], aiosqlite, Pillow, socket.io-client, Fabric.js 6

**Spec:** `docs/superpowers/specs/2026-04-03-review-hub-design.md`

---

## Task 1: Dependencies + Project Setup

**Files:**
- Modify: `pyproject.toml`
- Modify: `frontend/vite.config.ts`
- Create: `src/review_hub/__init__.py`
- Create: `src/review_hub/queries/__init__.py`
- Create: `src/review_hub/routes/__init__.py`

- [ ] **Step 1: Add Python dependencies**

In `pyproject.toml`, add to `[project.optional-dependencies] api`:
```
"python-socketio[asyncio]>=5.10,<6.0",
"aiosqlite>=0.20,<1.0",
```

- [ ] **Step 2: Install**

```bash
cd /c/Users/upper/Documents/00_aycb_v2
pip install -e ".[api]"
```

- [ ] **Step 3: Add frontend dependencies**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend
npm install socket.io-client@^4.8.0 fabric@^6.5.0
```

- [ ] **Step 4: Update vite.config.ts**

Add proxies for `/api/rh`, `/socket.io` (with `ws: true`), `/media`, `/references`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:5101',
    changeOrigin: true,
  },
  '/socket.io': {
    target: 'http://localhost:5101',
    changeOrigin: true,
    ws: true,
  },
  '/media': {
    target: 'http://localhost:5101',
    changeOrigin: true,
  },
  '/references': {
    target: 'http://localhost:5101',
    changeOrigin: true,
  },
},
```

- [ ] **Step 5: Create package skeleton**

```bash
mkdir -p src/review_hub/queries src/review_hub/routes
touch src/review_hub/__init__.py src/review_hub/queries/__init__.py src/review_hub/routes/__init__.py
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "[review-hub] Dependencies + package skeleton"
```

---

## Task 2: Database Layer

**Files:**
- Create: `src/review_hub/schema.sql`
- Create: `src/review_hub/db.py`
- Create: `tests/test_review_hub_db.py`

- [ ] **Step 1: Write schema.sql**

Full SQL with all 7 tables, indexes, WAL pragma, foreign_keys pragma. Use `[references]` bracket syntax. Include `ON DELETE CASCADE` on all FK constraints. Exact schema from spec.

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT,
    directory TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    thumbnail_path TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    author TEXT,
    content TEXT,
    x_position REAL,
    y_position REAL,
    annotation_type TEXT DEFAULT 'pin',
    box_width REAL,
    box_height REAL,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    status TEXT DEFAULT 'favorite',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(media_id, user_name),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    author TEXT,
    strokes_json TEXT,
    thumbnail_data TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS [references] (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_path TEXT,
    processed_path TEXT,
    thumbnail_path TEXT,
    uploaded_by TEXT,
    tags TEXT,
    notes TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'bug',
    author TEXT,
    urgent INTEGER DEFAULT 0,
    resolved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT,
    device TEXT,
    socket_id TEXT,
    connected_at TEXT DEFAULT (datetime('now')),
    disconnected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_directory ON media(directory);
CREATE INDEX IF NOT EXISTS idx_media_filename ON media(filename);
CREATE INDEX IF NOT EXISTS idx_comments_media_id ON comments(media_id);
CREATE INDEX IF NOT EXISTS idx_favorites_media_id ON favorites(media_id);
CREATE INDEX IF NOT EXISTS idx_drawings_media_id ON drawings(media_id);
CREATE INDEX IF NOT EXISTS idx_references_uploaded_by ON [references](uploaded_by);
```

- [ ] **Step 2: Write db.py**

```python
"""Review Hub database — aiosqlite connection pool + schema init."""
from __future__ import annotations

import aiosqlite
from pathlib import Path

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "data" / "review-hub.db"
_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

async def get_db() -> aiosqlite.Connection:
    """Open a connection with WAL mode and foreign keys enabled."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(_DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db

async def init_db() -> None:
    """Create tables if they don't exist."""
    schema = _SCHEMA_PATH.read_text(encoding="utf-8")
    db = await get_db()
    try:
        await db.executescript(schema)
        await db.commit()
    finally:
        await db.close()
```

- [ ] **Step 3: Write test**

```python
import asyncio
import pytest
from pathlib import Path

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Patch DB path to temp dir."""
    import src.review_hub.db as db_mod
    monkeypatch.setattr(db_mod, "_DB_PATH", tmp_path / "test.db")
    return tmp_path / "test.db"

def test_init_db_creates_tables(tmp_db):
    from src.review_hub.db import init_db, get_db
    asyncio.run(init_db())
    assert tmp_db.exists()

    async def check():
        db = await get_db()
        cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in await cursor.fetchall()}
        await db.close()
        return tables

    tables = asyncio.run(check())
    assert "media" in tables
    assert "comments" in tables
    assert "favorites" in tables
    assert "drawings" in tables
    assert "references" in tables
    assert "feedback" in tables
    assert "sessions" in tables
```

- [ ] **Step 4: Run test**

```bash
cd /c/Users/upper/Documents/00_aycb_v2
python -m pytest tests/test_review_hub_db.py -v
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "[review-hub] Database layer — schema + aiosqlite connection"
```

---

## Task 3: Query Modules

**Files:**
- Create: `src/review_hub/queries/media.py`
- Create: `src/review_hub/queries/comments.py`
- Create: `src/review_hub/queries/favorites.py`
- Create: `src/review_hub/queries/drawings.py`
- Create: `src/review_hub/queries/references.py`
- Create: `src/review_hub/queries/feedback.py`
- Create: `src/review_hub/queries/sessions.py`
- Create: `tests/test_review_hub_queries.py`

Each query module follows the same pattern: async functions that take a `db: aiosqlite.Connection` and return rows or dicts.

- [ ] **Step 1: Write all 7 query modules**

**media.py** — `list_media(db, directory?, sort?, order?)`, `get_media(db, id)`, `insert_media(db, **fields)`, `delete_media(db, id)`, `get_directories(db)`, `get_stats(db)`

**comments.py** — `list_comments(db, media_id)`, `add_comment(db, media_id, author, content, x, y, annotation_type, box_w, box_h, parent_id?)`, `delete_comment(db, id)`

**favorites.py** — `toggle_favorite(db, media_id, user_name, status)`, `get_favorites(db, media_id)`, `get_status(db, media_id, user_name)`

**drawings.py** — `get_drawing(db, media_id)`, `save_drawing(db, media_id, author, strokes_json, thumbnail_data?)`

**references.py** — `list_references(db, search?, tag?)`, `add_reference(db, **fields)`, `delete_reference(db, id)`. Use `[references]` bracket syntax in all queries.

**feedback.py** — `list_feedback(db, urgent_only?)`, `add_feedback(db, message, category, author, urgent?)`, `resolve_feedback(db, id)`

**sessions.py** — `add_session(db, user_name, device, socket_id)`, `end_session(db, socket_id)`, `get_active_sessions(db)`

- [ ] **Step 2: Write tests for media + comments + favorites queries**

Test insert → list → verify fields. Test FK cascade (delete media → comments disappear). Test favorites unique constraint.

- [ ] **Step 3: Run tests**

```bash
python -m pytest tests/test_review_hub_queries.py -v
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "[review-hub] Query modules — 7 tables, async"
```

---

## Task 4: Thumbnails + Scanner

**Files:**
- Create: `src/review_hub/thumbnails.py`
- Create: `src/review_hub/scanner.py`
- Create: `tests/test_review_hub_scanner.py`

- [ ] **Step 1: Write thumbnails.py**

```python
"""Generate 300px-wide JPEG thumbnails using Pillow."""
from pathlib import Path
from PIL import Image

THUMB_DIR = Path(__file__).resolve().parent.parent.parent / "shared" / "data" / "thumbnails"
THUMB_WIDTH = 300

def generate_thumbnail(source_path: Path, media_id: int) -> str:
    """Generate thumbnail, return relative path."""
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    thumb_path = THUMB_DIR / f"{media_id}.jpg"
    with Image.open(source_path) as img:
        ratio = THUMB_WIDTH / img.width
        size = (THUMB_WIDTH, int(img.height * ratio))
        img.thumbnail(size, Image.LANCZOS)
        img.convert("RGB").save(thumb_path, "JPEG", quality=80)
    return str(thumb_path)

def get_image_dimensions(path: Path) -> tuple[int, int]:
    """Return (width, height)."""
    with Image.open(path) as img:
        return img.size
```

- [ ] **Step 2: Write scanner.py**

```python
"""Polling scanner — indexes shared/Media/ every 5 seconds."""
from __future__ import annotations

import asyncio
import mimetypes
import time
from pathlib import Path

from src.review_hub.db import get_db
from src.review_hub.queries.media import insert_media, list_media, delete_media
from src.review_hub.thumbnails import generate_thumbnail, get_image_dimensions

MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "shared" / "Media"
SCAN_INTERVAL = 5
SETTLE_TIME = 2  # seconds — skip files modified less than this ago

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
ALL_EXTS = IMAGE_EXTS | VIDEO_EXTS

_sio = None  # set by app.py

def set_sio(sio):
    global _sio
    _sio = sio

async def scan_once() -> int:
    """Scan directory, index new files, remove deleted. Returns change count."""
    if not MEDIA_DIR.exists():
        return 0
    now = time.time()
    db = await get_db()
    changes = 0
    try:
        # Get existing filenames from DB
        existing = await list_media(db)
        known = {row["filepath"] for row in existing}

        # Scan filesystem
        on_disk = set()
        for f in MEDIA_DIR.rglob("*"):
            if f.suffix.lower() not in ALL_EXTS:
                continue
            if now - f.stat().st_mtime < SETTLE_TIME:
                continue
            on_disk.add(str(f))

        # New files
        for filepath in on_disk - known:
            p = Path(filepath)
            mime = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
            w, h = (0, 0)
            thumb = None
            if p.suffix.lower() in IMAGE_EXTS:
                try:
                    w, h = get_image_dimensions(p)
                except Exception:
                    pass
            media_id = await insert_media(db, filename=p.name, filepath=filepath,
                directory=str(p.parent.relative_to(MEDIA_DIR)) if p.is_relative_to(MEDIA_DIR) else str(p.parent),
                file_size=p.stat().st_size, mime_type=mime, width=w, height=h)
            if p.suffix.lower() in IMAGE_EXTS and media_id:
                try:
                    thumb = generate_thumbnail(p, media_id)
                    await db.execute("UPDATE media SET thumbnail_path=? WHERE id=?", (thumb, media_id))
                except Exception:
                    pass
            changes += 1

        # Deleted files
        for filepath in known - on_disk:
            row = next((r for r in existing if r["filepath"] == filepath), None)
            if row:
                await delete_media(db, row["id"])
                changes += 1

        if changes:
            await db.commit()
    finally:
        await db.close()
    return changes

async def run_scanner():
    """Background loop."""
    while True:
        try:
            changes = await scan_once()
            if changes and _sio:
                await _sio.emit("media_update", {"changes": changes}, room="review")
        except Exception:
            pass
        await asyncio.sleep(SCAN_INTERVAL)
```

- [ ] **Step 3: Write test**

Test `scan_once()` with a temp directory containing test images. Verify DB gets populated.

- [ ] **Step 4: Run test and commit**

```bash
python -m pytest tests/test_review_hub_scanner.py -v
git add -A && git commit -m "[review-hub] Scanner + thumbnails — polling with Pillow"
```

---

## Task 5: Sidecar Writer

**Files:**
- Create: `src/review_hub/sidecar.py`

- [ ] **Step 1: Write sidecar.py**

```python
"""Write .review.json sidecar next to media files."""
from __future__ import annotations

import json
from pathlib import Path
from src.review_hub.db import get_db
from src.review_hub.queries.favorites import get_favorites
from src.review_hub.queries.comments import list_comments

async def write_sidecar(media_id: int, filepath: str) -> None:
    """Write review data as JSON sidecar."""
    p = Path(filepath)
    if not p.exists():
        return
    sidecar_path = p.with_suffix(p.suffix + ".review.json")
    db = await get_db()
    try:
        favs = await get_favorites(db, media_id)
        comments = await list_comments(db, media_id)
        status = None
        reviewed_by = None
        for f in favs:
            if f["status"] in ("approved", "rejected"):
                status = f["status"]
                reviewed_by = f["user_name"]
                break
        data = {
            "status": status,
            "reviewed_by": reviewed_by,
            "favorite": any(f["status"] == "favorite" for f in favs),
            "comments_count": len(comments),
        }
        sidecar_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    finally:
        await db.close()
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "[review-hub] Sidecar writer — .review.json"
```

---

## Task 6: API Routes

**Files:**
- Create: `src/review_hub/routes/media.py`
- Create: `src/review_hub/routes/comments.py`
- Create: `src/review_hub/routes/favorites.py`
- Create: `src/review_hub/routes/drawings.py`
- Create: `src/review_hub/routes/references.py`
- Create: `src/review_hub/routes/upload.py`
- Create: `src/review_hub/routes/download.py`
- Create: `src/review_hub/routes/folders.py`

All routers use `prefix="/api/rh"` sub-paths. All endpoints are `async def`.

- [ ] **Step 1: Write media routes**

`GET /api/rh/media` — list media with optional `directory`, `sort`, `order` query params
`GET /api/rh/media/{id}` — single media item
`DELETE /api/rh/media/{id}` — delete media + file
`GET /api/rh/media/directories` — list subdirectories
`GET /api/rh/media/stats` — count, total size

- [ ] **Step 2: Write comments routes**

`GET /api/rh/comments/{media_id}` — list comments for media
`POST /api/rh/comments` — add comment (body: media_id, author, content, x, y, annotation_type, box_w, box_h, parent_id)
`DELETE /api/rh/comments/{id}` — delete comment (cascades to replies)

- [ ] **Step 3: Write favorites routes**

`POST /api/rh/favorites/toggle` — toggle favorite/approved/rejected (body: media_id, user_name, status)
`GET /api/rh/favorites/{media_id}` — get all favorites for media

- [ ] **Step 4: Write drawings routes**

`GET /api/rh/drawings/{media_id}` — get drawing for media
`POST /api/rh/drawings` — save drawing (body: media_id, author, strokes_json, thumbnail_data)

- [ ] **Step 5: Write references routes**

`GET /api/rh/references` — list with optional `search`, `tag` params
`POST /api/rh/references` — add reference
`DELETE /api/rh/references/{id}` — delete reference
Use `[references]` bracket syntax in queries.

- [ ] **Step 6: Write upload route**

`POST /api/rh/upload/media` — upload media file (multipart/form-data)
`POST /api/rh/upload/reference` — upload reference image

- [ ] **Step 7: Write download route**

`GET /api/rh/download/{media_id}` — download single file
`POST /api/rh/download/batch` — download multiple as ZIP (body: list of media_ids)

- [ ] **Step 8: Write folders route**

`GET /api/rh/folders` — list folders in shared/Media/
`POST /api/rh/folders/move` — move media to folder (body: media_id, target_dir)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "[review-hub] API routes — 8 routers, all async"
```

---

## Task 7: Socket.io Server + App Mount

**Files:**
- Create: `src/review_hub/app.py`
- Modify: `src/api.py`

- [ ] **Step 1: Write app.py**

```python
"""Review Hub — Socket.io server + FastAPI mount."""
from __future__ import annotations

import socketio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from src.review_hub.db import init_db
from src.review_hub.scanner import run_scanner, set_sio
from src.review_hub.routes import media, comments, favorites, drawings, references, upload, download, folders

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=[])

# ── Socket.io event handlers ──────────────────────────────────────────────

@sio.event
async def connect(sid, environ):
    pass

@sio.event
async def disconnect(sid):
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import end_session
    db = await get_db()
    try:
        await end_session(db, sid)
        await db.commit()
    finally:
        await db.close()
    await sio.emit("users_update", await _get_users(), room="review")

@sio.event
async def join_room(sid, data):
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import add_session
    room = data.get("room", "review")
    await sio.enter_room(sid, room)
    db = await get_db()
    try:
        await add_session(db, data.get("user", "Anonymous"), data.get("device", "unknown"), sid)
        await db.commit()
    finally:
        await db.close()
    await sio.emit("users_update", await _get_users(), room=room)

@sio.event
async def leave_room(sid, data):
    room = data.get("room", "review")
    await sio.leave_room(sid, room)

@sio.event
async def drawing_stroke(sid, data):
    await sio.emit("drawing_stroke", data, room="review", skip_sid=sid)

@sio.event
async def drawing_clear(sid, data):
    await sio.emit("drawing_clear", data, room="review", skip_sid=sid)

@sio.event
async def drawing_undo(sid, data):
    await sio.emit("drawing_undo", data, room="review", skip_sid=sid)

@sio.event
async def cursor_move(sid, data):
    await sio.emit("cursor_move", data, room="review", skip_sid=sid)

@sio.event
async def comment_new(sid, data):
    await sio.emit("comment_new", data, room="review", skip_sid=sid)

@sio.event
async def favorite_toggle(sid, data):
    await sio.emit("favorite_toggle", data, room="review", skip_sid=sid)

@sio.event
async def ping_check(sid, data):
    return data  # echo back for latency measurement

async def _get_users():
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import get_active_sessions
    db = await get_db()
    try:
        sessions = await get_active_sessions(db)
        return [{"id": s["socket_id"], "user": s["user_name"], "device": s["device"]} for s in sessions]
    finally:
        await db.close()

# ── Mount helper ──────────────────────────────────────────────────────────

def mount_review_hub(app: FastAPI) -> None:
    """Mount Review Hub routes, socket.io, and static files onto the FastAPI app."""
    import asyncio

    # Routes (BEFORE static mounts)
    for router_mod in [media, comments, favorites, drawings, references, upload, download, folders]:
        app.include_router(router_mod.router)

    # Socket.io
    set_sio(sio)
    sio_app = socketio.ASGIApp(sio, other_app=app)

    # DB init + scanner on startup
    original_startup = app.router.on_startup
    @app.on_event("startup")
    async def _rh_startup():
        await init_db()
        asyncio.create_task(run_scanner())

    # Static file mounts (AFTER routes)
    media_dir = Path(__file__).resolve().parent.parent.parent / "shared" / "Media"
    refs_dir = Path(__file__).resolve().parent.parent.parent / "shared" / "References"
    media_dir.mkdir(parents=True, exist_ok=True)
    refs_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="rh-media")
    app.mount("/references", StaticFiles(directory=str(refs_dir)), name="rh-references")

    # Replace ASGI app to include socket.io
    app.mount("/socket.io", sio_app)
```

- [ ] **Step 2: Modify api.py — add mount call**

After auto-discovery section, before static files section, add:

```python
# ── Review Hub ─────────────────────────────────────────────────────────
from src.review_hub.app import mount_review_hub
mount_review_hub(app)
```

- [ ] **Step 3: Test backend starts**

```bash
cd /c/Users/upper/Documents/00_aycb_v2
python -m uvicorn src.api:app --host 0.0.0.0 --port 5101
```

Expected: "AYCB backend ready" + "Router loaded: ..." + no errors from review_hub import.

- [ ] **Step 4: Test socket.io connection**

```bash
python -c "
import socketio
sio = socketio.Client()
sio.connect('http://localhost:5101')
print('Connected:', sio.sid)
sio.disconnect()
"
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "[review-hub] Socket.io server + app mount — real-time events"
```

---

## Task 8: Frontend — Routing + ReviewApp Shell

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/review/ReviewApp.tsx`
- Create: `frontend/src/review/services/api.ts`
- Create: `frontend/src/review/services/socket.ts`
- Create: `frontend/src/review/stores/userStore.ts`
- Create: `frontend/src/review/styles/review.css`

- [ ] **Step 1: Modify App.tsx — pathname routing**

Add at top of App component:

```tsx
const isReview = window.location.pathname.startsWith('/review')
if (isReview) return <ReviewApp />
// ... existing FlowCanvas render
```

Import `ReviewApp` lazily:

```tsx
import { lazy, Suspense } from 'react'
const ReviewApp = lazy(() => import('./review/ReviewApp'))
// In render: <Suspense fallback={<div>Loading...</div>}><ReviewApp /></Suspense>
```

- [ ] **Step 2: Write ReviewApp.tsx**

Shell with nav bar, route switching (`/review` → Gallery, `/review/references` → References), connection status, user count. Port structure from v0 `App.jsx`. Use v2 design tokens for colors.

- [ ] **Step 3: Write api.ts**

HTTP client for `/api/rh/*` endpoints. Functions: `listMedia()`, `getDirectories()`, `addComment()`, `toggleFavorite()`, `getDrawing()`, `saveDrawing()`, etc.

- [ ] **Step 4: Write socket.ts**

Socket.io client setup. Connect to `/` (same origin). Export `socket` instance.

- [ ] **Step 5: Write userStore.ts**

Zustand store for user name + device. Persists to localStorage.

- [ ] **Step 6: Write review.css**

Base styles for Review Hub layout. Use `var(--amber)`, `var(--surface-*)`, `var(--text-*)` tokens.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "[review-hub] Frontend shell — routing, API client, socket, stores"
```

---

## Task 9: Frontend — Gallery + MediaGrid

**Files:**
- Create: `frontend/src/review/pages/ReviewGallery.tsx`
- Create: `frontend/src/review/components/MediaGrid.tsx`
- Create: `frontend/src/review/components/FilterBar.tsx`
- Create: `frontend/src/review/components/FolderManager.tsx`
- Create: `frontend/src/review/components/Sidebar.tsx`
- Create: `frontend/src/review/stores/socketStore.ts`

- [ ] **Step 1: Write ReviewGallery.tsx**

Main page. Port from v0 `ReviewGallery.jsx` (1665 lines — must split aggressively). This component orchestrates: FilterBar, FolderManager, MediaGrid, Sidebar. State: selected media, filter, sort, folder.

Keep under 250 lines — delegate everything to child components.

- [ ] **Step 2: Write MediaGrid.tsx**

Grid of media thumbnails. Lazy loading. Click to select. Double-click to open lightbox. Shows favorite/approval badges. Port from v0 gallery grid section.

- [ ] **Step 3: Write FilterBar, FolderManager, Sidebar**

FilterBar: sort/filter controls.
FolderManager: folder tree navigation.
Sidebar: selected media details, comments list, favorite toggle.

- [ ] **Step 4: Write socketStore.ts**

Zustand store that listens to socket events (`media_update`, `comment_new`, `favorite_toggle`, `users_update`) and updates gallery state.

- [ ] **Step 5: Verify gallery loads**

Start both servers. Navigate to `http://localhost:5100/review`. Gallery should show media from `shared/Media/`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "[review-hub] Gallery + MediaGrid — browse and filter media"
```

---

## Task 10: Frontend — Lightbox + Drawing

**Files:**
- Create: `frontend/src/review/components/Lightbox.tsx`
- Create: `frontend/src/review/components/DrawingCanvas.tsx`
- Create: `frontend/src/review/components/DrawingToolbar.tsx`
- Create: `frontend/src/review/hooks/useDrawing.ts`
- Create: `frontend/src/review/utils/drawingUtils.ts`
- Create: `frontend/src/review/stores/drawingToolStore.ts`

- [ ] **Step 1: Write Lightbox.tsx**

Fullscreen media viewer. Shows image at full resolution. Hosts DrawingCanvas overlay. Keyboard nav (arrows, escape). Port from v0.

- [ ] **Step 2: Write useDrawing.ts**

Hook: Fabric.js canvas init, stroke handling, pressure-to-width mapping, undo stack, export strokes as JSON, import from server. < 250 lines.

- [ ] **Step 3: Write drawingUtils.ts**

Stroke smoothing (Bezier), pressure-to-width curve. < 100 lines.

- [ ] **Step 4: Write DrawingCanvas.tsx**

Container component. Renders Fabric.js canvas element. Uses `useDrawing` hook. Emits socket events on stroke. < 200 lines.

- [ ] **Step 5: Write DrawingToolbar.tsx**

Tool selection (pen, eraser, color, size), undo button. Uses drawingToolStore.

- [ ] **Step 6: Write drawingToolStore.ts**

Zustand store: active tool, color, size, opacity.

- [ ] **Step 7: Test drawing round-trip**

Open lightbox → draw → save → reload → drawing persists. Open in two tabs → draw in one → appears in other (real-time).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "[review-hub] Lightbox + Drawing — Fabric.js with real-time sync"
```

---

## Task 11: Frontend — Comments + Annotations

**Files:**
- Create: `frontend/src/review/components/CommentThread.tsx`
- Create: `frontend/src/review/components/AnnotationCanvas.tsx`
- Create: `frontend/src/review/components/UserNameModal.tsx`

- [ ] **Step 1: Write CommentThread.tsx**

Threaded comments for a media item. Shows pin/box annotations. Reply button. Delete button. Port from v0.

- [ ] **Step 2: Write AnnotationCanvas.tsx**

Overlay on lightbox image. Click to place pin annotation. Drag to create box annotation. Shows existing annotations as markers.

- [ ] **Step 3: Write UserNameModal.tsx**

First-time prompt for user name. Stores in userStore. Shows on first comment/favorite action.

- [ ] **Step 4: Test comment flow**

Click image → place pin → type comment → save → appears in sidebar. Reply to comment → thread nests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "[review-hub] Comments + Annotations — threaded, real-time"
```

---

## Task 12: Frontend — References Page

**Files:**
- Create: `frontend/src/review/pages/ReferencePage.tsx`
- Create: `frontend/src/review/components/ConnectionStatus.tsx`

- [ ] **Step 1: Write ReferencePage.tsx**

Reference image library. Upload, tag, search, delete. Grid view. Port from v0 `ReferenceLibrary.jsx`.

- [ ] **Step 2: Write ConnectionStatus.tsx**

WebSocket connection indicator (green dot = connected, red = disconnected). Shows in nav bar.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "[review-hub] References page + ConnectionStatus"
```

---

## Task 13: Integration Test

**Files:** No new files.

- [ ] **Step 1: End-to-end flow**

1. Start backend: `python -m uvicorn src.api:app --host 0.0.0.0 --port 5101`
2. Start frontend: `cd frontend && npm run dev`
3. Open `http://localhost:5100` → AYCB canvas works
4. Generate an image in AYCB → saved to `shared/Media/`
5. Open `http://localhost:5100/review` → gallery shows the generated image (scanner picked it up)
6. Click image → lightbox opens
7. Draw on image → strokes persist
8. Add comment with pin annotation
9. Toggle favorite
10. Open in second browser tab → changes sync in real-time
11. Navigate to `/review/references` → reference library works

- [ ] **Step 2: Run all tests**

```bash
cd /c/Users/upper/Documents/00_aycb_v2
python -m pytest tests/ -v
cd frontend && npx vitest run
```

- [ ] **Step 3: Commit gate**

```bash
git add -A && git commit -m "[gate] Review Hub v2 complete — Python backend + React frontend"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Dependencies + setup | 5 |
| 2 | Database layer | 3 |
| 3 | Query modules | 8 |
| 4 | Scanner + thumbnails | 3 |
| 5 | Sidecar writer | 1 |
| 6 | API routes | 8 |
| 7 | Socket.io + mount | 2 |
| 8 | Frontend shell | 6 |
| 9 | Gallery + grid | 6 |
| 10 | Lightbox + drawing | 6 |
| 11 | Comments + annotations | 3 |
| 12 | References page | 2 |
| 13 | Integration test | 0 |
| **Total** | | **~53 files** |
