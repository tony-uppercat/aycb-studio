# Split Screen — Gallery + Assets (Drag-to-Link)

## Overview

Add a split-screen mode to Review Hub that shows Gallery and Assets side-by-side, with drag-and-drop from Gallery → Assets to create DB links (no file copy).

## Layout

- **Activation:** "Split" toggle button in the tab bar, next to Gallery / References / Assets.
- **Panels:** Gallery on the left, Assets on the right, separated by a draggable divider.
- **Default split:** 50/50. Minimum 30% per side.
- **Directory sidebar:** Shared (left edge), shows media directories as it does today in Gallery tab.
- **Info sidebar:** Hidden in split mode — insufficient space.
- **Exit:** Click any other tab (Gallery, References, Assets) to leave split mode.

## Drag-and-Drop

- **Direction:** Gallery → Assets only (one-way).
- **MediaCard:** Becomes `draggable` in split mode. Carries `media_id` in `dataTransfer`.
- **Drop targets:**
  - Assets grid area → links to the currently open assets folder.
  - Visible folder items in assets sidebar/breadcrumb → links to that specific folder.
- **Visual feedback:**
  - Dragged card: reduced opacity + accent outline.
  - Valid drop target: dashed accent border + highlight background.
  - Toast notification on successful link.

## Data Model

New table `media_asset_links`:

```sql
CREATE TABLE IF NOT EXISTS media_asset_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    directory TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(media_id, directory),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
```

- `media_id` — references the media table (the generated image in shared/Media/).
- `directory` — the assets folder path (e.g. `characters/heroes`). Empty string = root.
- `UNIQUE(media_id, directory)` — prevents duplicate links.
- `ON DELETE CASCADE` — removing the media entry removes all its links.

The scanner does NOT manage this table. It only manages the `assets` table for real files in shared/Assets/.

## Backend

### New endpoint: `POST /api/rh/assets/link`

```
Body (JSON): { "media_id": int, "directory": string }
Response: { "status": "ok", "id": int } | { "status": "error", "detail": string }
```

- Validates media_id exists in media table.
- Validates directory is not path-traversal.
- Inserts into `media_asset_links` (UNIQUE constraint handles duplicates).
- Emits Socket.IO `asset_link_new` event.

### New endpoint: `DELETE /api/rh/assets/link/{link_id}`

```
Response: { "status": "ok" }
```

- Removes a link. Emits `asset_link_delete` event.

### Modified: `GET /api/rh/assets` (or bridge equivalent)

Assets panel query merges two sources:
1. Real files from `assets` table (as today).
2. Linked media from `media_asset_links` JOIN `media` — enriched with `is_link: true` flag and source media fields (thumbnail_path, filename, filepath, mime_type).

Both are returned in a single list, sorted together.

## Frontend

### ReviewGallery.tsx

- Add `splitMode` state (boolean, default false).
- Render "Split" button in tab bar.
- When `splitMode`:
  - Render Gallery content + divider + AssetsPanel side-by-side.
  - Hide right info sidebar.
  - Pass `splitMode` prop to MediaGrid (enables draggable).

### New component: SplitDivider.tsx

- Thin vertical bar (4-5px) between gallery and assets.
- Mouse drag to resize. Stores ratio in local state.
- Accent color grip indicator.
- Clamp: 30% min per side.

### MediaGrid.tsx / MediaCard.tsx

- When `splitMode` prop is true:
  - `draggable={true}` on card.
  - `onDragStart`: set `dataTransfer` with `text/x-media-id` = media_id.
  - Visual: reduce opacity on drag.

### AssetsPanel.tsx

- Accept `splitMode` prop.
- When `splitMode`:
  - Grid area: `onDragOver` / `onDrop` handlers — link to current directory.
  - Folder items: `onDragOver` / `onDrop` handlers — link to that folder.
  - Visual: highlight valid drop targets with accent dashed border.
- Display linked items with a small link icon badge to distinguish from real files.
- Linked items show the media thumbnail (served via `/api/rh/media/{id}/thumbnail` or original path).

### Socket events

- `asset_link_new` → refresh assets panel.
- `asset_link_delete` → refresh assets panel.

## Files to Create

| File | Purpose |
|---|---|
| `frontend/src/review/components/SplitDivider.tsx` | Draggable divider component |
| `src/review_hub/routes/asset_links.py` | Link CRUD endpoints |
| `src/review_hub/queries/asset_links.py` | DB query helpers |

## Files to Modify

| File | Change |
|---|---|
| `frontend/src/review/pages/ReviewGallery.tsx` | Split toggle state, layout switch, Split button |
| `frontend/src/review/components/AssetsPanel.tsx` | Drop handlers, linked items display, splitMode prop |
| `frontend/src/review/components/MediaGrid.tsx` | Pass splitMode to cards |
| `frontend/src/review/components/MediaCard.tsx` | draggable + onDragStart in split mode |
| `frontend/src/review/styles/review.css` | Split layout, divider, drag feedback styles |
| `frontend/src/review/services/api.ts` | linkAsset(), unlinkAsset() API calls |
| `src/review_hub/db.py` | Add media_asset_links table to schema init |
| `src/review_hub/app.py` | Relay asset_link_new / asset_link_delete socket events |

## Out of Scope

- Assets → Assets drag (move between folders).
- Assets → Gallery drag.
- Multi-select drag (drag one card at a time).
- Keyboard shortcut for split toggle.
- Persisting split ratio across sessions.
