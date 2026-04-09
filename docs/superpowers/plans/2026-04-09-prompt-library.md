# Prompt Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Prompt Library button next to Run in the Text Input node that opens a floating panel for saving, tagging, and loading reusable prompts.

**Architecture:** Backend stores prompts in `config/prompts/library.json` via CRUD endpoints on the existing `/api/prompt` router. Frontend adds a floating panel component inside the `prompt-editor/` folder, wired into `PromptEditorNode` via a small hook. A `footerExtra` prop on `NodeShell` allows the button to sit next to Run without polluting the shared component.

**Tech Stack:** FastAPI (backend CRUD), React + CSS Modules (panel), uuid (prompt IDs)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/routers/prompt.py` | Add library CRUD endpoints (list, create, update, delete) |
| Modify | `src/shared.py` | Add `PromptLibraryEntry` Pydantic model |
| Create | `tests/test_prompt_library.py` | Backend tests for library endpoints |
| Modify | `frontend/src/nodes/_shared/NodeShell.tsx` | Add optional `footerExtra` prop |
| Create | `frontend/src/nodes/prompt-editor/usePromptLibrary.ts` | Hook: fetch, save, delete, state |
| Create | `frontend/src/nodes/prompt-editor/PromptLibraryPanel.tsx` | Floating panel UI |
| Create | `frontend/src/nodes/prompt-editor/PromptLibraryPanel.module.css` | Panel styles |
| Modify | `frontend/src/nodes/prompt-editor/PromptEditorNode.tsx` | Wire button + panel |

---

### Task 1: Backend — Pydantic model

**Files:**
- Modify: `src/shared.py`

- [ ] **Step 1: Add PromptLibraryEntry and request models**

After the existing `PromptBody` class in `src/shared.py`, add:

```python
class PromptLibraryEntry(BaseModel):
    id: str
    name: str
    text: str
    tags: list[str] = []
    created_at: str

class PromptLibrarySave(BaseModel):
    name: str
    text: str
    tags: list[str] = []

class PromptLibraryUpdate(BaseModel):
    name: str | None = None
    text: str | None = None
    tags: list[str] | None = None
```

---

### Task 2: Backend — Library CRUD endpoints

**Files:**
- Modify: `src/routers/prompt.py`

- [ ] **Step 1: Add library file path and helpers**

Add after the existing `_PROMPT_HISTORY_FILE` line:

```python
import uuid

_LIBRARY_FILE = _PROMPTS_DIR / "library.json"

def _load_library() -> list[dict]:
    if not _LIBRARY_FILE.exists():
        return []
    try:
        return _json.loads(_LIBRARY_FILE.read_text(encoding="utf-8"))
    except _json.JSONDecodeError as e:
        _log(f"Prompt library corrupt — backing up and resetting: {e}")
        _LIBRARY_FILE.rename(_LIBRARY_FILE.with_suffix(".json.corrupt"))
        return []

def _save_library(entries: list[dict]) -> None:
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    _LIBRARY_FILE.write_text(
        _json.dumps(entries, indent=2, ensure_ascii=False),
        encoding="utf-8",
        newline="\n",
    )
```

- [ ] **Step 2: Add CRUD endpoints**

Add the import at top: `from src.shared import PromptBody, PromptLibrarySave, PromptLibraryUpdate, _log`

Add endpoints after existing ones:

```python
@router.get("/library")
def list_library():
    return {"prompts": _load_library()}

@router.post("/library", status_code=201)
def create_library_entry(body: PromptLibrarySave):
    entries = _load_library()
    entry = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "text": body.text,
        "tags": [t.strip().lower() for t in body.tags if t.strip()],
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    entries.append(entry)
    _save_library(entries)
    return entry

@router.put("/library/{entry_id}")
def update_library_entry(entry_id: str, body: PromptLibraryUpdate):
    entries = _load_library()
    for e in entries:
        if e["id"] == entry_id:
            if body.name is not None:
                e["name"] = body.name.strip()
            if body.text is not None:
                e["text"] = body.text
            if body.tags is not None:
                e["tags"] = [t.strip().lower() for t in body.tags if t.strip()]
            _save_library(entries)
            return e
    raise HTTPException(404, detail="Prompt not found")

@router.delete("/library/{entry_id}")
def delete_library_entry(entry_id: str):
    entries = _load_library()
    before = len(entries)
    entries = [e for e in entries if e["id"] != entry_id]
    if len(entries) == before:
        raise HTTPException(404, detail="Prompt not found")
    _save_library(entries)
    return {"status": "deleted"}
```

---

### Task 3: Backend tests

**Files:**
- Create: `tests/test_prompt_library.py`

- [ ] **Step 1: Write tests for all CRUD operations + failure paths**

```python
"""Tests for prompt library CRUD endpoints."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    prompts_dir = tmp_path / "prompts"
    prompts_dir.mkdir()
    import src.routers.prompt as mod
    monkeypatch.setattr(mod, "_PROMPTS_DIR", prompts_dir)
    monkeypatch.setattr(mod, "_LIBRARY_FILE", prompts_dir / "library.json")
    monkeypatch.setattr(mod, "_PROMPT_FILE", prompts_dir / "analyze.txt")
    monkeypatch.setattr(mod, "_PROMPT_HISTORY_FILE", prompts_dir / "history.json")
    from src.api import app
    return TestClient(app)


def test_list_empty(client):
    r = client.get("/api/prompt/library")
    assert r.status_code == 200
    assert r.json()["prompts"] == []


def test_create_and_list(client):
    r = client.post("/api/prompt/library", json={
        "name": "Hero prompt",
        "text": "A brave hero...",
        "tags": ["character", "Fantasy"],
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Hero prompt"
    assert data["tags"] == ["character", "fantasy"]  # lowercased
    assert "id" in data

    r2 = client.get("/api/prompt/library")
    assert len(r2.json()["prompts"]) == 1


def test_update(client):
    r = client.post("/api/prompt/library", json={
        "name": "Old name", "text": "old text", "tags": [],
    })
    eid = r.json()["id"]
    r2 = client.put(f"/api/prompt/library/{eid}", json={"name": "New name"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "New name"
    assert r2.json()["text"] == "old text"  # unchanged


def test_update_not_found(client):
    r = client.put("/api/prompt/library/fake-id", json={"name": "x"})
    assert r.status_code == 404


def test_delete(client):
    r = client.post("/api/prompt/library", json={
        "name": "To delete", "text": "bye", "tags": [],
    })
    eid = r.json()["id"]
    r2 = client.delete(f"/api/prompt/library/{eid}")
    assert r2.status_code == 200
    r3 = client.get("/api/prompt/library")
    assert len(r3.json()["prompts"]) == 0


def test_delete_not_found(client):
    r = client.delete("/api/prompt/library/fake-id")
    assert r.status_code == 404


def test_corrupt_library_backup(client, tmp_path):
    lib_file = tmp_path / "prompts" / "library.json"
    lib_file.write_text("NOT JSON", encoding="utf-8")
    r = client.get("/api/prompt/library")
    assert r.status_code == 200
    assert r.json()["prompts"] == []
    assert (tmp_path / "prompts" / "library.json.corrupt").exists()
```

- [ ] **Step 2: Run tests**

Run: `python -m pytest tests/test_prompt_library.py -v`
Expected: All 7 tests PASS

---

### Task 4: NodeShell — footerExtra prop

**Files:**
- Modify: `frontend/src/nodes/_shared/NodeShell.tsx`

- [ ] **Step 1: Add `footerExtra` prop**

Add to the `Props` interface:

```typescript
footerExtra?: React.ReactNode
```

- [ ] **Step 2: Render footerExtra in footer**

In the footer `<div>`, render `footerExtra` before the Run button:

```tsx
{onRun && (
  <div className={styles.footer}>
    {lastCost !== undefined && lastCost > 0 ? (...) : estimatedCost ? (...) : null}
    {footerExtra}
    {onAutoUpdateToggle && (...)}
    <button className={...} ...>Run</button>
  </div>
)}
```

---

### Task 5: Frontend — usePromptLibrary hook

**Files:**
- Create: `frontend/src/nodes/prompt-editor/usePromptLibrary.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'

export interface LibraryEntry {
  id: string
  name: string
  text: string
  tags: string[]
  created_at: string
}

export function usePromptLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const fetchEntries = useCallback(async () => {
    controllerRef.current?.abort()
    const ctrl = new AbortController()
    controllerRef.current = ctrl
    setLoading(true)
    try {
      const r = await fetch('/api/prompt/library', { signal: ctrl.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setEntries(data.prompts)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error('Prompt library fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveEntry = useCallback(async (name: string, text: string, tags: string[]) => {
    const r = await fetch('/api/prompt/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, text, tags }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const entry = await r.json()
    setEntries(prev => [...prev, entry])
    return entry
  }, [])

  const deleteEntry = useCallback(async (id: string) => {
    const r = await fetch(`/api/prompt/library/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    setEntries(prev => prev.filter(e => e.id !== id))
  }, [])

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  return { entries, loading, fetchEntries, saveEntry, deleteEntry }
}
```

---

### Task 6: Frontend — PromptLibraryPanel component

**Files:**
- Create: `frontend/src/nodes/prompt-editor/PromptLibraryPanel.tsx`
- Create: `frontend/src/nodes/prompt-editor/PromptLibraryPanel.module.css`

- [ ] **Step 1: Write the panel component**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { LibraryEntry } from './usePromptLibrary'
import styles from './PromptLibraryPanel.module.css'

interface Props {
  entries: LibraryEntry[]
  loading: boolean
  onLoad: (text: string) => void
  onSave: (name: string, text: string, tags: string[]) => Promise<unknown>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
  currentText: string
}

export function PromptLibraryPanel({ entries, loading, onLoad, onSave, onDelete, onClose, currentText }: Props) {
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveTags, setSaveTags] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const allTags = [...new Set(entries.flatMap(e => e.tags))].sort()
  const filtered = filterTag ? entries.filter(e => e.tags.includes(filterTag)) : entries

  async function handleSave() {
    if (!saveName.trim() || !currentText.trim()) return
    const tags = saveTags.split(',').map(t => t.trim()).filter(Boolean)
    await onSave(saveName.trim(), currentText, tags)
    setSaveName('')
    setSaveTags('')
    setSaving(false)
  }

  return (
    <div className={styles.panel} ref={panelRef}>
      <div className={styles.header}>
        <span className={styles.title}>Prompt Library</span>
        <button className={styles.closeBtn} onClick={onClose}>x</button>
      </div>

      {allTags.length > 0 && (
        <div className={styles.tagBar}>
          <button
            className={`${styles.tag} ${!filterTag ? styles.tagActive : ''}`}
            onClick={() => setFilterTag(null)}
          >All</button>
          {allTags.map(t => (
            <button
              key={t}
              className={`${styles.tag} ${filterTag === t ? styles.tagActive : ''}`}
              onClick={() => setFilterTag(filterTag === t ? null : t)}
            >{t}</button>
          ))}
        </div>
      )}

      <div className={styles.list}>
        {loading && <p className={styles.empty}>Loading...</p>}
        {!loading && filtered.length === 0 && <p className={styles.empty}>No saved prompts</p>}
        {filtered.map(entry => (
          <div key={entry.id} className={styles.entry} onClick={() => { onLoad(entry.text); onClose() }}>
            <div className={styles.entryHeader}>
              <span className={styles.entryName}>{entry.name}</span>
              <button
                className={styles.deleteBtn}
                onClick={e => { e.stopPropagation(); onDelete(entry.id) }}
                title="Delete"
              >x</button>
            </div>
            <p className={styles.entryPreview}>{entry.text.slice(0, 80)}{entry.text.length > 80 ? '...' : ''}</p>
            {entry.tags.length > 0 && (
              <div className={styles.entryTags}>
                {entry.tags.map(t => <span key={t} className={styles.entryTag}>{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>

      {saving ? (
        <div className={styles.saveForm}>
          <input
            className={styles.saveInput}
            placeholder="Prompt name..."
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          />
          <input
            className={styles.saveInput}
            placeholder="Tags (comma separated)..."
            value={saveTags}
            onChange={e => setSaveTags(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          />
          <div className={styles.saveActions}>
            <button className={styles.cancelBtn} onClick={() => setSaving(false)}>Cancel</button>
            <button className={styles.confirmBtn} onClick={handleSave} disabled={!saveName.trim()}>Save</button>
          </div>
        </div>
      ) : (
        <button
          className={styles.saveCurrentBtn}
          onClick={() => setSaving(true)}
          disabled={!currentText.trim()}
        >Save Current</button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write the CSS module**

```css
.panel {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 6px;
  width: 280px;
  max-height: 360px;
  background: #1c1c20;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  z-index: 50;
  font-size: 11px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.title {
  font-weight: 600;
  color: #fafafa;
  font-size: 11px;
}

.closeBtn {
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1;
}
.closeBtn:hover { color: #fafafa; }

.tagBar {
  display: flex;
  gap: 3px;
  padding: 4px 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.tag {
  background: #27272a;
  border: 1px solid transparent;
  border-radius: 3px;
  color: #a1a1aa;
  font-size: 9px;
  padding: 2px 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.tag:hover { color: #fafafa; border-color: rgba(255,255,255,0.1); }
.tagActive { background: #F52776; color: #fff; }

.list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  min-height: 40px;
}

.empty {
  color: #52525b;
  text-align: center;
  padding: 16px 8px;
  margin: 0;
  font-size: 10px;
}

.entry {
  padding: 6px 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.entry:hover { background: rgba(255,255,255,0.04); }

.entryHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.entryName {
  color: #fafafa;
  font-weight: 500;
  font-size: 11px;
}

.deleteBtn {
  background: none;
  border: none;
  color: #52525b;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.entry:hover .deleteBtn { opacity: 1; }
.deleteBtn:hover { color: #ef4444; }

.entryPreview {
  color: #71717a;
  font-size: 10px;
  margin: 2px 0 0;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.entryTags {
  display: flex;
  gap: 3px;
  margin-top: 3px;
}

.entryTag {
  background: rgba(245,39,118,0.1);
  color: #F52776;
  font-size: 8px;
  padding: 1px 4px;
  border-radius: 2px;
}

.saveForm {
  padding: 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.saveInput {
  background: #111113;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 3px;
  color: #fafafa;
  font-size: 10px;
  padding: 4px 6px;
  outline: none;
}
.saveInput:focus { border-color: #F52776; }

.saveActions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.cancelBtn {
  background: none;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 3px;
  color: #a1a1aa;
  font-size: 10px;
  padding: 3px 8px;
  cursor: pointer;
}

.confirmBtn {
  background: #F52776;
  border: none;
  border-radius: 3px;
  color: #fff;
  font-size: 10px;
  padding: 3px 10px;
  cursor: pointer;
}
.confirmBtn:disabled { opacity: 0.4; cursor: not-allowed; }

.saveCurrentBtn {
  margin: 4px 8px 6px;
  background: #27272a;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 3px;
  color: #a1a1aa;
  font-size: 10px;
  padding: 4px 0;
  cursor: pointer;
  transition: all 0.15s;
}
.saveCurrentBtn:hover { color: #fafafa; border-color: rgba(255,255,255,0.12); }
.saveCurrentBtn:disabled { opacity: 0.3; cursor: not-allowed; }
```

---

### Task 7: Frontend — Wire into PromptEditorNode

**Files:**
- Modify: `frontend/src/nodes/prompt-editor/PromptEditorNode.tsx`

- [ ] **Step 1: Import hook and panel**

```typescript
import { usePromptLibrary } from './usePromptLibrary'
import { PromptLibraryPanel } from './PromptLibraryPanel'
```

- [ ] **Step 2: Add state and hook inside the component**

Inside `PromptEditorNode`, add:

```typescript
const [libraryOpen, setLibraryOpen] = useState(false)
const { entries, loading, fetchEntries, saveEntry, deleteEntry } = usePromptLibrary()
```

- [ ] **Step 3: Add the library button as footerExtra**

Pass `footerExtra` to `NodeShell`:

```tsx
<NodeShell
  name="Text Input"
  selected={selected}
  icon="📝"
  inputSlots={[...]}
  outputSlots={[...]}
  onRun={handleRun}
  autoUpdate={autoUpdate}
  onAutoUpdateToggle={hasInput ? () => {...} : undefined}
  footerExtra={
    <div style={{ position: 'relative' }}>
      <button
        style={{
          background: 'none',
          border: 'none',
          color: libraryOpen ? '#F52776' : '#52525b',
          cursor: 'pointer',
          padding: '2px 4px',
          lineHeight: 1,
          transition: 'color 0.15s',
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (!libraryOpen) fetchEntries()
          setLibraryOpen(!libraryOpen)
        }}
        title="Prompt Library"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
        </svg>
      </button>
      {libraryOpen && (
        <PromptLibraryPanel
          entries={entries}
          loading={loading}
          currentText={text}
          onLoad={(t) => {
            setText(t)
            updateNodeData(id, { outputText: t, text: t, prompt: t })
          }}
          onSave={saveEntry}
          onDelete={deleteEntry}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  }
>
```

- [ ] **Step 4: Run all tests**

Run: `cd frontend && npx vitest run && cd .. && python -m pytest`
Expected: All tests pass

---

### Task 8: Commit

- [ ] **Step 1: Commit**

```bash
git add src/shared.py src/routers/prompt.py tests/test_prompt_library.py \
  frontend/src/nodes/_shared/NodeShell.tsx \
  frontend/src/nodes/prompt-editor/usePromptLibrary.ts \
  frontend/src/nodes/prompt-editor/PromptLibraryPanel.tsx \
  frontend/src/nodes/prompt-editor/PromptLibraryPanel.module.css \
  frontend/src/nodes/prompt-editor/PromptEditorNode.tsx
git commit -m "[feat] Prompt Library — save, tag, and load reusable prompts from Text Input node"
```
