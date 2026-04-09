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
