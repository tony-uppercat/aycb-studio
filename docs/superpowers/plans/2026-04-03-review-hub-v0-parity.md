# Review Hub v0 Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the v0 Review Hub UI to v2 with identical feature set — gallery with filters/sort/stats, full lightbox with drawing+comments, toast notifications, console panel, name modal, and enhanced connection status.

**Architecture:** Component-per-file in `frontend/src/review/`, CSS in `review.css` (continuing v2 pattern). Zustand stores for shared state (drawing, toast, user). Socket.io events match v0 protocol. All components under 300 lines (CLAUDE.md rule). v0 source is read-only reference at `C:\Users\upper\Uppercat Dropbox\Antonio Cottone\00_aycb\aycb-review-hub\client\src\`.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, socket.io-client 4.8, existing design tokens

**v0 reference:** `C:\Users\upper\Uppercat Dropbox\Antonio Cottone\00_aycb\aycb-review-hub\client\src\`

---

## File Structure

### New files to create:
```
frontend/src/review/
  stores/
    toastStore.ts              — Toast notification state + API
    drawingStore.ts            — Drawing tools, strokes, undo/redo, remote cursors
  components/
    Toast.tsx                  — Toast container + individual toast items
    NameModal.tsx              — Welcome/name-change modal
    ConsolePanel.tsx           — Debug console (Server/Network/Errors tabs)
    FeedbackPanel.tsx          — Feedback submission + list (right side of console)
    MediaCard.tsx              — Single media card with badges, checkbox, admin delete
    StatsBar.tsx               — Total/favorites/comments counts
    DirectorySidebar.tsx       — Finder-style directory tree with expand/collapse
    LightboxToolbar.tsx        — Lightbox header actions (fav/approve/reject/draw/comments)
    LightboxFooter.tsx         — Metadata chips + prompt text + counter
    VideoPlayer.tsx            — Video element with streaming URL
    AnnotationCanvas.tsx       — Pin/box annotation layer
    DeleteConfirmModal.tsx     — Delete confirmation dialog
    ContextMenu.tsx            — Right-click context menu
    MoveDialog.tsx             — Move-to-folder picker dialog
    BulkBar.tsx                — Multi-selection bulk actions bar
```

### Existing files to modify:
```
  stores/socketStore.ts        — Add users array, latency, reconnecting state
  stores/userStore.ts          — Add initials helper, admin check
  services/api.ts              — Add missing endpoints (comments, annotations, download, stream, folders CRUD, bulk delete, feedback, logs)
  services/socket.ts           — Add auto-join, helpers (onEvent, offEvent, emit)
  components/ConnectionStatus.tsx — Rewrite: latency, user dropdown, reconnecting
  components/CommentThread.tsx — Rewrite: threaded, real-time, annotation positioning
  components/DrawingCanvas.tsx — Rewrite: pressure, tools, dual-canvas, real-time sync
  components/DrawingToolbar.tsx — Rewrite: full tool palette, colors, sizes, opacity, export
  components/MediaGrid.tsx     — Use MediaCard, add checkbox/selection support
  components/FilterBar.tsx     — Add filter chips, enhanced sort
  components/Sidebar.tsx       — Keep as-is (info panel when media selected)
  components/Lightbox.tsx      — Rewrite: full toolbar, comment panel, video, keyboard shortcuts, drawing, annotations
  pages/ReviewGallery.tsx      — Rewrite: sidebar layout, filters, stats, multi-select, context menu, bulk actions
  ReviewApp.tsx                — Add name modal, toast container, console panel, enhanced nav
  styles/review.css            — Add all new CSS classes
```

---

## Phase 1: Foundation (Toast + Stores + API)

### Task 1: Toast notification system

**Files:**
- Create: `frontend/src/review/stores/toastStore.ts`
- Create: `frontend/src/review/components/Toast.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** `components/Toast.jsx` (171 lines)

- [ ] **Step 1: Create toastStore.ts**

```typescript
import { create } from 'zustand'

interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: Toast['type'], message: string, duration?: number) => void
  removeToast: (id: string) => void
}

const DURATIONS: Record<Toast['type'], number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 5000,
}

let _id = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message, duration) => {
    const id = String(++_id)
    const ms = duration ?? DURATIONS[type]
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration: ms }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (msg: string) => useToastStore.getState().addToast('success', msg),
  error: (msg: string) => useToastStore.getState().addToast('error', msg),
  info: (msg: string) => useToastStore.getState().addToast('info', msg),
  warning: (msg: string) => useToastStore.getState().addToast('warning', msg),
}
```

- [ ] **Step 2: Create Toast.tsx**

```typescript
import { useToastStore } from '../stores/toastStore'

const ICONS: Record<string, string> = {
  success: '\u2713',
  error: '\u2717',
  info: 'i',
  warning: '!',
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.removeToast)
  if (toasts.length === 0) return null
  return (
    <div className="rh-toast-container" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`rh-toast rh-toast-${t.type}`}>
          <span className="rh-toast-icon">{ICONS[t.type]}</span>
          <span className="rh-toast-msg">{t.message}</span>
          <button className="rh-toast-close" onClick={() => remove(t.id)}>&times;</button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Add toast CSS to review.css**

```css
/* Toast notifications */
.rh-toast-container {
  position: fixed; bottom: 20px; right: 20px; z-index: 9000;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.rh-toast {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-radius: 6px; font-size: 13px; pointer-events: auto;
  background: var(--surface-1, #1a1a1a); border: 1px solid var(--border, #2a2a2a);
  color: var(--text-primary, #e8e8e8); box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  animation: rh-toast-in 0.2s ease;
}
@keyframes rh-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.rh-toast-success { border-left: 3px solid var(--color-success, #22c55e); }
.rh-toast-error { border-left: 3px solid var(--color-error, #ef4444); }
.rh-toast-info { border-left: 3px solid #4a9eff; }
.rh-toast-warning { border-left: 3px solid var(--color-warning, #eab308); }
.rh-toast-icon { font-size: 14px; font-weight: 700; flex-shrink: 0; width: 18px; text-align: center; }
.rh-toast-msg { flex: 1; }
.rh-toast-close { background: none; border: none; color: var(--text-dim, #666); font-size: 16px; cursor: pointer; padding: 0 2px; }
```

- [ ] **Step 4: Wire ToastContainer into ReviewApp.tsx**

Add `<ToastContainer />` just before closing `</div>` in ReviewApp.

- [ ] **Step 5: Run tests, verify build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`

---

### Task 2: Drawing store (Zustand)

**Files:**
- Create: `frontend/src/review/stores/drawingStore.ts`

**Reference:** `stores/drawingStore.js` (192 lines)

- [ ] **Step 1: Create drawingStore.ts**

Full Zustand store with:
- State: `isDrawingMode`, `currentTool`, `color`, `strokeWidth`, `opacity`, `strokes[]`, `undoStack[]`, `remoteStrokes[]`, `remoteCursors`, `drawingVisible`
- Actions: `toggleDrawingMode`, `setTool`, `setColor`, `setStrokeWidth`, `setOpacity`, `toggleVisibility`, `addStroke`, `undo`, `redo`, `clearAll`, `resetForMedia`, `addRemoteStroke`, `updateRemoteCursor`, `removeRemoteCursor`
- Socket auto-subscribe: `drawing_stroke`, `drawing_clear`, `drawing_undo`, `cursor_move`

Port directly from v0 `stores/drawingStore.js`, converting to TypeScript with proper types.

- [ ] **Step 2: Run tsc check**

---

### Task 3: Expand API service

**Files:**
- Modify: `frontend/src/review/services/api.ts`

**Reference:** `services/api.js` (114 lines)

- [ ] **Step 1: Add all missing endpoints to rhApi**

Add to the existing `rhApi` object:
```typescript
// Comments
listComments: (mediaId: number) => get('/comments/' + mediaId),
addComment: (body) => post('/comments', body),
deleteComment: (id: number) => del('/comments/' + id),

// Favorites (already exists)
// toggleFavorite, getFavorites (already exist)

// Drawings
getDrawing: (mediaId: number) => get('/drawings/' + mediaId),
saveDrawing: (body) => post('/drawings', body),

// Folders
listFolders: () => get('/folders'),                           // already exists
createFolder: (body) => post('/folders', body),
renameFolder: (name: string, body) => post('/folders/' + name + '/rename', body),
deleteFolder: (name: string) => del('/folders/' + name),
moveToFolder: (body) => post('/folders/move', body),          // already exists
getSubfolders: (project: string) => get('/folders?project=' + encodeURIComponent(project)),

// Admin
deleteMediaFile: (id: number, username: string) =>
  fetch(BASE + '/media/' + id, { method: 'DELETE', headers: { 'X-Username': username } }).then(r => r.json()),
bulkDeleteMedia: (ids: number[], username: string) =>
  post('/media/bulk-delete', { ids }, { 'X-Username': username }),

// Download/stream
downloadUrl: (id: number) => BASE + '/download/media/' + id,
streamUrl: (id: number) => BASE + '/media/' + id + '/stream',

// Server logs
getLogs: () => get('/logs'),

// Feedback (already exists from earlier task)
```

- [ ] **Step 2: Run tsc check**

---

### Task 4: Enhance socket service

**Files:**
- Modify: `frontend/src/review/services/socket.ts`

**Reference:** `services/socket.js` (63 lines)

- [ ] **Step 1: Add helpers and auto-join**

```typescript
// Add onEvent/offEvent/emit helpers
export const onEvent = (event: string, cb: (...args: any[]) => void) => socket.on(event, cb)
export const offEvent = (event: string, cb: (...args: any[]) => void) => socket.off(event, cb)
export const emitEvent = (event: string, data?: unknown) => socket.emit(event, data)
```

- [ ] **Step 2: Run tsc check**

---

### Task 5: Enhance socket store + user store

**Files:**
- Modify: `frontend/src/review/stores/socketStore.ts`
- Modify: `frontend/src/review/stores/userStore.ts`

- [ ] **Step 1: Add to socketStore:** `users` array, `latency` number, `reconnecting` boolean, setters for each.

- [ ] **Step 2: Add to userStore:** `getInitials()` helper, `isAdmin()` check (username === 'admin').

- [ ] **Step 3: Run tsc check**

---

## Phase 2: Gallery Rebuild

### Task 6: DirectorySidebar component

**Files:**
- Create: `frontend/src/review/components/DirectorySidebar.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 ReviewGallery sidebar section (~200 lines JSX), ReviewGallery.module.css sidebar styles

- [ ] **Step 1: Create DirectorySidebar.tsx**

Props: `directories`, `subfolders`, `activeDirectory`, `expandedDirs`, `onSelectDir`, `onToggleExpand`, `onCreateFolder`

Features:
- "Projects" header with + button for new folder
- List of directories with folder icon, name, item count
- Expandable with arrow toggle, loads subfolders
- Active state with accent border
- New folder input row (inline)

Keep under 150 lines.

- [ ] **Step 2: Add sidebar CSS** (port from v0 `.sidebar`, `.dirItem*`, `.subfolder*` classes, prefix with `rh-`)

- [ ] **Step 3: Run tsc check**

---

### Task 7: MediaCard component

**Files:**
- Create: `frontend/src/review/components/MediaCard.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 ReviewGallery `.mediaCard` section + CSS

- [ ] **Step 1: Create MediaCard.tsx**

Props: `media`, `selected`, `isAdmin`, `onSelect`, `onClick`, `onContextMenu`, `onDelete`

Features:
- Thumbnail with aspect ratio 4/3
- Video play overlay + duration badge (if video)
- Checkbox overlay (top-left) when multi-select active
- Badges: favorite star, comment count, drawing icon, approved/rejected
- Info bar: filename, directory, model name
- Admin delete button (top-left, visible on hover)
- Fade-in animation on mount
- Hover: translateY(-2px) + accent border

Keep under 120 lines.

- [ ] **Step 2: Add media card CSS** (port `.mediaCard`, `.thumbWrapper`, `.mediaBadges`, `.badge*`, `.mediaInfo`, `.selectCheckbox` etc.)

- [ ] **Step 3: Run tsc check**

---

### Task 8: StatsBar + BulkBar components

**Files:**
- Create: `frontend/src/review/components/StatsBar.tsx`
- Create: `frontend/src/review/components/BulkBar.tsx`
- Modify: `frontend/src/review/styles/review.css`

- [ ] **Step 1: Create StatsBar.tsx**

Props: `total`, `favoriteCount`, `commentCount`

Simple bar showing: "X total | Y favorites | Z with comments"

- [ ] **Step 2: Create BulkBar.tsx**

Props: `selectedCount`, `totalCount`, `onSelectAll`, `onClear`, `onApprove`, `onReject`, `onDownload`, `onDelete`, `onMove`, `isAdmin`

Animated slide-in bar with selection info + action buttons.

- [ ] **Step 3: Add CSS for stats bar + bulk bar**

- [ ] **Step 4: Run tsc check**

---

### Task 9: FilterBar enhancement

**Files:**
- Modify: `frontend/src/review/components/FilterBar.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 toolbar with filter chips + sort dropdown

- [ ] **Step 1: Rewrite FilterBar**

Props: `search`, `activeFilter`, `sortBy`, `onSearchChange`, `onFilterChange`, `onSortChange`

Features:
- Search input with search icon + clear button
- Filter chips: All, Favorites, Approved, Rejected, With Comments, With Drawings
- Sort dropdown: Newest, Oldest, Name A-Z, Name Z-A
- Wrap on small screens

- [ ] **Step 2: Add filter chip CSS**

- [ ] **Step 3: Run tsc check**

---

### Task 10: ContextMenu + MoveDialog + DeleteConfirmModal

**Files:**
- Create: `frontend/src/review/components/ContextMenu.tsx`
- Create: `frontend/src/review/components/MoveDialog.tsx`
- Create: `frontend/src/review/components/DeleteConfirmModal.tsx`
- Modify: `frontend/src/review/styles/review.css`

- [ ] **Step 1: Create ContextMenu.tsx** (~60 lines)

Props: `x`, `y`, `items: { label, onClick }[]`, `onClose`

Positioned absolutely at x,y. Closes on click-outside.

- [ ] **Step 2: Create MoveDialog.tsx** (~80 lines)

Props: `folders`, `onSelect`, `onClose`

Modal with folder list. Click folder to move.

- [ ] **Step 3: Create DeleteConfirmModal.tsx** (~60 lines)

Props: `filename` or `count`, `onConfirm`, `onCancel`

Danger modal with confirmation.

- [ ] **Step 4: Add CSS for all three**

- [ ] **Step 5: Run tsc check**

---

### Task 11: ReviewGallery full rewrite

**Files:**
- Modify: `frontend/src/review/pages/ReviewGallery.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 ReviewGallery.jsx (1665 lines) — ported via smaller components from Tasks 6-10

- [ ] **Step 1: Rewrite ReviewGallery.tsx**

This is the orchestrator. State: mediaList, directories, activeDirectory, activeFilter, sortBy, searchQuery, selectedIds, lightboxIndex, contextMenu, moveTarget, deleteConfirm, subfolders, expandedDirs.

Layout:
```
<div className="rh-page">
  <DirectorySidebar ... />
  <div className="rh-content">
    {tab bar: Gallery | References}
    <FilterBar ... />
    {selectedIds.size > 0 && <BulkBar ... />}
    <StatsBar ... />
    <div className="rh-gallery-area">
      <MediaGrid with MediaCard ... />
    </div>
  </div>
  {lightboxIndex >= 0 && <Lightbox ... />}
  {contextMenu && <ContextMenu ... />}
  {moveTarget && <MoveDialog ... />}
  {deleteConfirm && <DeleteConfirmModal ... />}
</div>
```

Client-side filter/sort logic (same as v0).
Socket listeners for silent refresh.
Multi-select with shift+click range selection.
References tab content stays inline.

Target: ~250 lines (complex but within limit thanks to extracted components).

- [ ] **Step 2: Update MediaGrid.tsx** — accept `onContextMenu`, `selectedIds`, pass through to MediaCard.

- [ ] **Step 3: Add page layout CSS** (`.rh-page`, `.rh-content`, `.rh-gallery-area`, breadcrumb styles)

- [ ] **Step 4: Run tsc + tests**

---

## Phase 3: Lightbox Rebuild

### Task 12: LightboxToolbar + LightboxFooter

**Files:**
- Create: `frontend/src/review/components/LightboxToolbar.tsx`
- Create: `frontend/src/review/components/LightboxFooter.tsx`
- Modify: `frontend/src/review/styles/review.css`

- [ ] **Step 1: Create LightboxToolbar.tsx** (~80 lines)

Props: `media`, `isFavorite`, `status`, `showComments`, `isDrawing`, `onToggleFav`, `onApprove`, `onReject`, `onToggleComments`, `onToggleDrawing`, `onDownload`, `onDelete`, `onClose`, `isAdmin`

Row of circular icon buttons: Star, Check, X, Chat, Pencil, Download, Trash (admin), Close.

- [ ] **Step 2: Create LightboxFooter.tsx** (~60 lines)

Props: `media`, `currentIndex`, `total`

Shows: metadata chips (model, cost, aspect ratio from sidecar), prompt text (truncated), counter "3/42".

- [ ] **Step 3: Add CSS for lightbox header/footer**

- [ ] **Step 4: Run tsc check**

---

### Task 13: Lightbox full rewrite

**Files:**
- Modify: `frontend/src/review/components/Lightbox.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 lightbox section (~400 lines in ReviewGallery.jsx)

- [ ] **Step 1: Rewrite Lightbox.tsx**

Props: `media`, `items`, `onClose`, `onNavigate`, `onRefresh`

Features:
- Full-screen overlay
- LightboxToolbar header
- Image/video display area with prev/next arrows
- DrawingCanvas + DrawingToolbar overlay (when drawing mode on)
- AnnotationCanvas overlay
- CommentThread side panel (animated, 340px)
- LightboxFooter
- Keyboard shortcuts: arrows, C, D, A, R, S, Esc
- Video detection + streaming URL

Target: ~200 lines (using extracted toolbar/footer/drawing/comments).

- [ ] **Step 2: Add lightbox CSS** (rewrite existing, add `.rh-lightbox-body`, `.rh-lightbox-image-area`, `.rh-lightbox-comment-panel`, nav arrows, etc.)

- [ ] **Step 3: Run tsc check**

---

## Phase 4: Drawing System

### Task 14: DrawingCanvas rewrite

**Files:**
- Modify: `frontend/src/review/components/DrawingCanvas.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 `components/DrawingCanvas.jsx` (836 lines) — split into component + render logic

- [ ] **Step 1: Rewrite DrawingCanvas.tsx**

Props: `mediaId`, `imageWidth`, `imageHeight`

Features:
- Dual canvas (local interactive + remote read-only)
- Pointer events with coalesced events for Apple Pencil
- Pressure sensitivity (PointerEvent.pressure)
- Tools: pen, highlighter, eraser, line, arrow, text
- Smooth bezier rendering for strokes
- Socket emit: `drawing_stroke`, `cursor_move`
- Socket receive: strokes from drawingStore
- Remote cursor display (colored dots + name)
- Save via API
- Export: overlay-only + merged

This is the largest single component. Target ~280 lines by using the drawingStore for state and keeping rendering logic focused.

- [ ] **Step 2: Add drawing canvas CSS**

- [ ] **Step 3: Run tsc check**

---

### Task 15: DrawingToolbar rewrite

**Files:**
- Modify: `frontend/src/review/components/DrawingToolbar.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 `components/DrawingToolbar.jsx` (339 lines)

- [ ] **Step 1: Rewrite DrawingToolbar.tsx**

State from drawingStore. Features:
- Tool buttons: Pen, Highlight, Eraser, Line, Arrow, Text
- Color swatches (8 presets) + custom color picker
- Brush size dots (1, 3, 5, 10, 20)
- Opacity slider
- Undo/Redo buttons
- Visibility toggle
- Clear (with confirmation), Export dropdown, Save, Close

Target: ~180 lines.

- [ ] **Step 2: Add/update drawing toolbar CSS**

- [ ] **Step 3: Run tsc check**

---

### Task 16: AnnotationCanvas

**Files:**
- Create: `frontend/src/review/components/AnnotationCanvas.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 `components/AnnotationCanvas.jsx` (319 lines)

- [ ] **Step 1: Create AnnotationCanvas.tsx**

Props: `mediaId`, `annotations`, `onAddAnnotation`, `onAnnotationClick`, `width`, `height`, `selectedAnnotationId`

Features:
- Normalized coordinate system (0-1)
- Click = pin annotation, drag = box annotation (min 8px threshold)
- Numbered markers with cycling colors (8 colors)
- Hover tooltip (author + content)
- Selected state highlight

Target: ~200 lines.

- [ ] **Step 2: Add annotation CSS**

- [ ] **Step 3: Run tsc check**

---

## Phase 5: App Shell

### Task 17: NameModal

**Files:**
- Create: `frontend/src/review/components/NameModal.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 App.jsx NameModal (~40 lines JSX), App.module.css nameModal styles

- [ ] **Step 1: Create NameModal.tsx** (~60 lines)

Props: `initialName`, `onConfirm`

Features:
- Centered modal with backdrop blur
- "Welcome to Review Hub" branding
- Name input with min 2 char validation
- Join button (disabled when invalid)
- Auto-focus input

- [ ] **Step 2: Add name modal CSS** (port from v0)

- [ ] **Step 3: Run tsc check**

---

### Task 18: ConnectionStatus rewrite

**Files:**
- Modify: `frontend/src/review/components/ConnectionStatus.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 `components/ConnectionStatus.jsx` (209 lines)

- [ ] **Step 1: Rewrite ConnectionStatus.tsx**

Features:
- Status dot: green (connected), yellow (reconnecting), red (disconnected) with pulse animation
- Latency display with color coding (<100ms green, <300ms yellow, else red)
- Ping every 5s via `socket.volatile.emit('ping_check')`
- Users dropdown: "N online" button, expandable list with avatar+name+device
- Click-outside to close

Target: ~140 lines.

- [ ] **Step 2: Add connection status CSS** (pulse animation, dropdown styles)

- [ ] **Step 3: Run tsc check**

---

### Task 19: ConsolePanel + FeedbackPanel

**Files:**
- Create: `frontend/src/review/components/ConsolePanel.tsx`
- Create: `frontend/src/review/components/FeedbackPanel.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 `components/ConsolePanel.jsx` (535 lines)

- [ ] **Step 1: Create ConsolePanel.tsx** (~200 lines)

Props: `isOpen`, `onClose`

Features:
- Three tabs: Server, Network, Errors
- Server tab: fetches `/api/logs` every 3s, shows timestamped messages
- Network tab: patches `window.fetch` to intercept requests, logs method/url/status/duration
- Errors tab: listens to `window.onerror` + `unhandledrejection`
- Toggle with backtick key
- Resizable height (optional, stretch goal)

- [ ] **Step 2: Create FeedbackPanel.tsx** (~150 lines)

Rendered as right side of ConsolePanel.

Features:
- Feedback list: unresolved + collapsed resolved
- Category tags (bug, ux, idea, prompt) with colors
- Urgent badge
- Submit form: category buttons + input + send
- Mark as resolved (checkmark button)
- Socket: `feedback_new`, `feedback_resolve`
- Export as JSON

- [ ] **Step 3: Add console + feedback CSS**

- [ ] **Step 4: Run tsc check**

---

### Task 20: ReviewApp shell rewrite

**Files:**
- Modify: `frontend/src/review/ReviewApp.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 App.jsx (309 lines)

- [ ] **Step 1: Rewrite ReviewApp.tsx**

Features:
- Name modal on first visit (check localStorage)
- Enhanced nav: brand icon + "Review Hub" title, user avatar with initials (click to change name), console toggle button
- Console panel (bottom, togglable with backtick)
- Toast container
- iOS gesture prevention (double-tap zoom, long-press context menu, overscroll)
- Socket event toasts (comment_new, favorite_toggle, drawing_save, feedback_new)

Target: ~180 lines.

- [ ] **Step 2: Update nav CSS** (brand icon gradient, user avatar, console toggle)

- [ ] **Step 3: Run tsc + tests**

---

## Phase 6: Comments Rewrite

### Task 21: CommentThread rewrite

**Files:**
- Modify: `frontend/src/review/components/CommentThread.tsx`
- Modify: `frontend/src/review/styles/review.css`

**Reference:** v0 `components/CommentThread.jsx` (270 lines)

- [ ] **Step 1: Rewrite CommentThread.tsx**

Props: `mediaId`, `position?` (for annotation positioning)

Features:
- Fetch comments on mount, threaded tree building from flat array
- Real-time: `comment_new`, `comment_delete` socket events
- Reply nesting with parent author indicator
- Avatar (first initial) + author + relative time + delete button
- Reply link (non-nested only)
- Input area: textarea + send button, Enter submits, Shift+Enter newline
- Auto-scroll to newest
- Optional floating position for in-image annotations

Target: ~200 lines.

- [ ] **Step 2: Update comment CSS**

- [ ] **Step 3: Run tsc check**

---

## Phase 7: Integration + Polish

### Task 22: Wire everything together

- [ ] **Step 1: Verify ReviewApp renders all pieces:** name modal, nav, gallery, console, toasts
- [ ] **Step 2: Verify lightbox with drawing + comments + annotations**
- [ ] **Step 3: Verify multi-select + bulk actions + context menu**
- [ ] **Step 4: Run full test suite:** `npx tsc --noEmit && npx vitest run`
- [ ] **Step 5: Manual smoke test in browser**

---

### Task 23: Backend endpoints for missing features

**Files:**
- May need new routes in `src/review_hub/routes/` for: `bulk-delete`, `download`, `stream`, `folder CRUD`, `logs`

- [ ] **Step 1: Check which API endpoints from v0 are missing in v2 backend**

The v0 server had these endpoints our v2 may not have:
- `GET /api/media/:id/stream` — video streaming
- `GET /api/download/media/:id` — file download
- `POST /api/media/bulk-delete` — bulk delete (admin)
- `GET /api/folders?project=X` — subfolders
- `POST /api/folders` — create folder
- `PUT /api/folders/:name` — rename folder
- `DELETE /api/folders/:name` — delete folder
- `POST /api/folders/move-media` — move media
- `GET /api/logs` — server log buffer
- `PATCH /api/feedback/:id/resolve` — resolve feedback (we have POST)

- [ ] **Step 2: Implement missing backend routes** (create new files in `src/review_hub/routes/` as needed)

- [ ] **Step 3: Run backend tests**

---

### Task 24: Final CSS polish

- [ ] **Step 1: Responsive breakpoints** — iPad (1024px), mobile (600px)
  - Sidebar hides on tablet, becomes dropdown
  - Grid columns adjust
  - Lightbox comment panel slides over on mobile
  - Toolbar wraps filter chips

- [ ] **Step 2: Animations** — card fade-in, bulk bar slide-in, comment panel slide-in, modal transitions

- [ ] **Step 3: Run tsc + tests**

- [ ] **Step 4: Commit all changes**
