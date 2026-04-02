# Review Hub v2 — Design Spec

## Goal

Port Review Hub from v0 (Node.js/Express/Socket.io) to v2's Python stack (FastAPI + python-socketio + aiosqlite). Same UI, same features, no Node.js.

## Architecture

```
Frontend (:5100)                         Backend (:5101)
Vite dev server                          FastAPI + uvicorn
├── AYCB canvas (/)                      ├── AYCB routers (existing)
└── Review Hub (/review)                 ├── Review Hub API (/api/rh/*)
    ├── ReviewGallery                    ├── Socket.io (python-socketio ASGI)
    ├── ReferenceLibrary                 ├── aiosqlite (review-hub.db)
    └── socket.io-client                 ├── Media file scanner (polling)
                                         └── Static files (/media/*, /references/*)
```

Single process. FastAPI serves both AYCB and Review Hub APIs. Socket.io mounts on the same ASGI app.

## Decisions

| Choice | Decision | Why |
|--------|----------|-----|
| Real-time | `python-socketio` (ASGI mount) | Same protocol as v0, frontend reuses socket.io-client |
| Database | `aiosqlite` | Async, non-blocking for online use with multiple clients |
| File scanner | Polling background task (5s) | No extra deps, works on cloud/remote deploys |
| Thumbnails | Pillow | Already in pyproject.toml |
| UI | Same as v0 | "La UI del v0 era perfetta" |
| Route prefix | `/api/rh/*` | Avoids collision with existing `/api/review/*` (checklist system) |

## New Dependencies

```
# pyproject.toml [api] group
python-socketio[asyncio]>=5.10,<6.0
aiosqlite>=0.20,<1.0

# frontend/package.json
socket.io-client: ^4.8.0
fabric: ^6.5.0              # Canvas drawing (iPad/Pencil support)
```

## Backend Structure

```
src/
├── review_hub/                    # New package — all Review Hub code
│   ├── __init__.py
│   ├── app.py                     # Socket.io server + mount helper
│   ├── db.py                      # aiosqlite connection + schema init
│   ├── schema.sql                 # 7 tables (from v0)
│   ├── queries/                   # Query modules
│   │   ├── __init__.py
│   │   ├── media.py               # Media CRUD
│   │   ├── comments.py            # Comments CRUD + threading
│   │   ├── favorites.py           # Favorites + approval status
│   │   ├── drawings.py            # Drawing strokes persistence
│   │   ├── references.py          # Reference images
│   │   ├── feedback.py            # Console feedback
│   │   └── sessions.py            # User sessions
│   ├── routes/                    # FastAPI routers (all prefixed /api/rh/)
│   │   ├── __init__.py
│   │   ├── media.py               # GET /api/rh/media, /api/rh/media/directories, etc.
│   │   ├── comments.py            # CRUD /api/rh/comments
│   │   ├── favorites.py           # POST /api/rh/favorites/toggle
│   │   ├── drawings.py            # GET/POST /api/rh/drawings
│   │   ├── references.py          # CRUD /api/rh/references
│   │   ├── upload.py              # POST /api/rh/upload (media + references)
│   │   ├── download.py            # GET /api/rh/download (batch zip)
│   │   └── folders.py             # GET /api/rh/folders
│   ├── scanner.py                 # Polling background task (5s interval)
│   ├── thumbnails.py              # Pillow thumbnail generation
│   └── sidecar.py                 # .review.json sidecar writer
```

Separated from `src/routers/` to keep Review Hub self-contained. Mounted in `api.py` via explicit import (not auto-discovered — it's a subsystem, not a single router).

## Database Schema

7 tables. Cleaned up from v0: removed `is_favorite`/`favorite_by` redundancy from `media` (use `favorites` table instead), added FK constraints.

**Note:** `[references]` is a reserved word in SQLite — always use bracket syntax in queries.

```sql
-- Core
media          (id INTEGER PRIMARY KEY, filename TEXT NOT NULL,
                filepath TEXT, directory TEXT, file_size INTEGER,
                mime_type TEXT, width INTEGER, height INTEGER,
                thumbnail_path TEXT, metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP)

comments       (id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL,
                author TEXT, content TEXT, x_position REAL,
                y_position REAL, annotation_type TEXT DEFAULT 'pin',
                box_width REAL, box_height REAL,
                parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE)

favorites      (id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL,
                user_name TEXT NOT NULL, status TEXT DEFAULT 'favorite',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(media_id, user_name),
                FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE)

drawings       (id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL,
                author TEXT, strokes_json TEXT, thumbnail_data TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE)

-- Reference library
[references]   (id INTEGER PRIMARY KEY, filename TEXT NOT NULL,
                original_path TEXT, processed_path TEXT,
                thumbnail_path TEXT, uploaded_by TEXT,
                tags TEXT, notes TEXT, file_size INTEGER,
                width INTEGER, height INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP)

-- System
feedback       (id INTEGER PRIMARY KEY, message TEXT NOT NULL,
                category TEXT DEFAULT 'bug', author TEXT,
                urgent INTEGER DEFAULT 0, resolved INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP)

sessions       (id INTEGER PRIMARY KEY, user_name TEXT,
                device TEXT, socket_id TEXT,
                connected_at TEXT DEFAULT CURRENT_TIMESTAMP,
                disconnected_at TEXT)
```

**Indexes:** media.directory, media.filename, comments.media_id, favorites.media_id, drawings.media_id, [references].uploaded_by

DB file: `shared/data/review-hub.db` (WAL mode, PRAGMA foreign_keys=ON).

## Socket.io Events

Same events as v0:

**Room management:**
- `join_room` → server broadcasts `users_update`
- `leave_room` → server broadcasts `users_update`

**Drawing (real-time):**
- `drawing_stroke` → broadcast to room
- `drawing_clear` → broadcast to room
- `drawing_undo` → broadcast to room
- `cursor_move` → broadcast to room

**Collaboration:**
- `comment_new` → broadcast to room
- `favorite_toggle` → broadcast to room

**Utility:**
- `ping_check` → latency measurement

## Frontend Structure

```
frontend/src/
├── review/                        # New — Review Hub frontend
│   ├── ReviewApp.tsx              # Router: / → Gallery, /references → Library
│   ├── pages/
│   │   ├── ReviewGallery.tsx      # Main gallery (port from v0, split if >300)
│   │   └── ReferencePage.tsx      # Reference library
│   ├── components/
│   │   ├── MediaGrid.tsx          # Image grid with lazy loading
│   │   ├── Lightbox.tsx           # Fullscreen media viewer
│   │   ├── DrawingCanvas.tsx      # Fabric.js iPad/Pencil drawing
│   │   ├── DrawingToolbar.tsx     # Drawing tools
│   │   ├── AnnotationCanvas.tsx   # Pin/box annotations
│   │   ├── CommentThread.tsx      # Threaded comments
│   │   ├── FilterBar.tsx          # Gallery filters
│   │   ├── FolderManager.tsx      # Folder navigation
│   │   ├── Sidebar.tsx            # Media detail sidebar
│   │   ├── ConnectionStatus.tsx   # WebSocket status indicator
│   │   └── UserNameModal.tsx      # First-time user name prompt
│   ├── stores/
│   │   ├── socketStore.ts         # Socket.io connection + event handling
│   │   ├── drawingToolStore.ts    # Drawing tool state
│   │   └── userStore.ts           # User name/device persistence
│   ├── services/
│   │   ├── socket.ts              # Socket.io client setup
│   │   └── api.ts                 # HTTP client for /api/rh/* endpoints
│   └── styles/
│       └── review.css             # Review Hub styles (uses v2 design tokens)
```

## Frontend Routing

No react-router-dom. Simple `pathname` check in App.tsx:

```tsx
const isReview = window.location.pathname.startsWith('/review')
return isReview ? <ReviewApp /> : <FlowCanvas />
```

ReviewApp uses the same pattern internally:
- `/review` → ReviewGallery
- `/review/references` → ReferencePage

Vite config needs `historyApiFallback` for `/review*` to serve index.html.

## API Mount in api.py

```python
# In src/api.py, after auto-discovery:
from src.review_hub.app import mount_review_hub
mount_review_hub(app)  # Mounts routes + socket.io
```

This adds:
- All `/api/rh/*` routes
- Socket.io ASGI mount at `/socket.io`
- Background scanner task on startup
- Static file mounts for `/media/*` and `/references/*`

## Scanner (Polling)

```python
# src/review_hub/scanner.py
# Runs every 5 seconds as asyncio background task
# 1. List files in shared/Media/**
# 2. Skip files modified less than 2 seconds ago (avoids reading incomplete writes)
# 3. Compare with media table
# 4. New files → generate thumbnail (Pillow) → insert into DB
# 5. Deleted files → mark as removed in DB
# 6. Emit 'media_update' socket event if changes detected
```

## Thumbnail Generation

```python
# src/review_hub/thumbnails.py
# Uses Pillow to generate 300px-wide thumbnails
# Saves to shared/data/thumbnails/{media_id}.jpg
# Returns thumbnail path for DB storage
```

## Sidecar Writer

```python
# src/review_hub/sidecar.py
# Writes .review.json next to original media file
# Contains: status, reviewed_by, comments_count, favorite
# Triggered on favorite_toggle and comment creation
```

## CORS & Static Files

For online use, CORS origins in `api.py` need to include the deployment domain. Currently defaults to `localhost:5100`.

Static media files served via FastAPI `StaticFiles`:
- `/media/` → `shared/Media/`
- `/references/` → `shared/References/`

## What Changes in Existing Code

1. **`src/api.py`** — add `mount_review_hub(app)` call. **Mount API routes BEFORE static file mounts** to prevent path interception.
2. **`frontend/src/App.tsx`** — add pathname check: `/review*` → ReviewApp, else → FlowCanvas
3. **`pyproject.toml`** — add `python-socketio[asyncio]` and `aiosqlite` to `[api]` group
4. **`frontend/package.json`** — add `socket.io-client`, `fabric`
5. **`frontend/vite.config.ts`** — add proxy for `/socket.io` → `:5101` **with `ws: true`** for WebSocket upgrade, add proxy for `/api/rh` → `:5101`, add proxy for `/media` and `/references` → `:5101`

## What Does NOT Change

- All 20 existing nodes
- All existing AYCB routers
- Existing review.py (checklist system — different feature)
- Canvas, stores, hooks, providers
- Design tokens, accent color

## File Size Targets

| File | Target |
|------|--------|
| Backend route files | < 150 lines each |
| Query modules | < 200 lines each |
| scanner.py | < 100 lines |
| thumbnails.py | < 50 lines |
| sidecar.py | < 50 lines |
| db.py | < 80 lines |
| app.py (mount) | < 60 lines |
| Frontend components | < 300 lines each |
| ReviewGallery | Split into sub-components if > 300 |
| DrawingCanvas.tsx | < 200 (container + Fabric.js canvas element) |
| useDrawing.ts | < 250 (Fabric.js init, stroke handling, pressure mapping, undo) |
| drawingUtils.ts | < 100 (stroke smoothing, Bezier, pressure-to-width) |

## Async Convention

Review Hub routes use `async def` (required by aiosqlite). Existing AYCB routers remain `def` (sync). FastAPI handles both — no conflict. New Review Hub code must always be async.

## Out of Scope (Future)

- Auth/HTTPS for online deployment — separate spec when needed
- Multi-room support (currently single 'review' room)
- Video streaming/transcoding
- Cloud storage (S3/GCS) — currently filesystem only

## Implementation Order

1. Backend: DB + schema + queries
2. Backend: Routes (media, comments, favorites, drawings)
3. Backend: Socket.io server + events
4. Backend: Scanner + thumbnails
5. Frontend: Socket client + stores
6. Frontend: ReviewGallery + MediaGrid
7. Frontend: Lightbox + DrawingCanvas
8. Frontend: Comments + Annotations
9. Frontend: References page
10. Integration test: AYCB generates → scanner picks up → appears in gallery
