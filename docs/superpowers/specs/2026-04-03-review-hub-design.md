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
socket.io-client: ^4.8.0   # already used in v0, check if in v2
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

Same 7 tables as v0:

```sql
-- Core
media          (id, filename, filepath, directory, file_size, mime_type,
                width, height, thumbnail_path, metadata, is_favorite,
                favorite_by, created_at, updated_at)
comments       (id, media_id, author, content, x_position, y_position,
                annotation_type, box_width, box_height, parent_id,
                created_at)
favorites      (id, media_id, user_name, status, created_at,
                UNIQUE(media_id, user_name))
drawings       (id, media_id, author, strokes_json, thumbnail_data,
                created_at, updated_at)

-- Reference library
references     (id, filename, original_path, processed_path,
                thumbnail_path, uploaded_by, tags, notes, file_size,
                width, height, created_at)

-- System
feedback       (id, message, category, author, urgent, resolved,
                created_at)
sessions       (id, user_name, device, socket_id, connected_at,
                disconnected_at)
```

DB file: `shared/data/review-hub.db` (WAL mode, same location as v0).

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

In v2's main `App.tsx`, add a route:

```tsx
// If URL starts with /review, render ReviewApp
// Otherwise render FlowCanvas (AYCB editor)
```

ReviewApp has its own internal router:
- `/review` → ReviewGallery
- `/review/references` → ReferencePage

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
# 2. Compare with media table
# 3. New files → generate thumbnail (Pillow) → insert into DB
# 4. Deleted files → mark as removed in DB
# 5. Emit 'media_update' socket event if changes detected
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

1. **`src/api.py`** — add `mount_review_hub(app)` call + static file mounts
2. **`frontend/src/App.tsx`** — add route split: `/review*` → ReviewApp, else → FlowCanvas
3. **`pyproject.toml`** — add `python-socketio[asyncio]` and `aiosqlite` to `[api]` group
4. **`frontend/package.json`** — add `socket.io-client` if not present
5. **`frontend/vite.config.ts`** — add proxy for `/socket.io` → `:5101`

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
| DrawingCanvas | < 300 (v0 was 835 — needs major split) |

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
