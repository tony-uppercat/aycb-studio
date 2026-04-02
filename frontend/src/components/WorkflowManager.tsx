import { useState, useRef, useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { getDefaultPreset, LS_PRESETS_KEY, DEFAULT_PRESET_NAME, type SavedPreset } from '../presets'
import styles from './WorkflowManager.module.css'

interface Props {
  nodes: Node[]
  edges: Edge[]
  onLoad: (nodes: Node[], edges: Edge[]) => void
}

function loadPresets(): SavedPreset[] {
  try { return JSON.parse(localStorage.getItem(LS_PRESETS_KEY) ?? '[]') } catch { return [] }
}
function savePresets(presets: SavedPreset[]) {
  try { localStorage.setItem(LS_PRESETS_KEY, JSON.stringify(presets)) } catch { /* quota */ }
}

export function WorkflowManager({ nodes, edges, onLoad }: Props) {
  const [mode, setMode] = useState<'closed' | 'load' | 'save'>('closed')
  const [name, setName] = useState('')
  const [presets, setPresets] = useState<SavedPreset[]>(loadPresets)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setMode('closed')
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function confirmSave() {
    if (!name.trim()) return
    const updated = [...presets.filter(p => p.name !== name.trim()), { name: name.trim(), nodes, edges }]
    setPresets(updated)
    savePresets(updated)
    setMode('closed')
    setName('')
  }

  function deletePreset(presetName: string) {
    const updated = presets.filter(p => p.name !== presetName)
    setPresets(updated)
    savePresets(updated)
  }

  function loadPreset(preset: SavedPreset) {
    onLoad(preset.nodes, preset.edges)
    setMode('closed')
  }

  return (
    <div className={styles.wrap} ref={ref} style={{ position: 'relative' }}>
      <button className={styles.btn} onClick={() => setMode(m => m === 'save' ? 'closed' : 'save')} aria-label="Save workflow">
        Save
      </button>
      <button className={styles.btn} onClick={() => setMode(m => m === 'load' ? 'closed' : 'load')} aria-label="Load workflow">
        Load
      </button>

      {mode === 'save' && (
        <div className={styles.dropdown}>
          <div className={styles.saveForm}>
            <input
              className={styles.input}
              placeholder="Workflow name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmSave()}
              autoFocus
            />
            <button className={styles.confirmBtn} onClick={confirmSave} aria-label="Confirm save">
              Save
            </button>
          </div>
        </div>
      )}

      {mode === 'load' && (
        <div className={styles.dropdown}>
          <div
            className={styles.item}
            onClick={() => { const d = getDefaultPreset(); onLoad(d.nodes, d.edges); setMode('closed') }}
          >
            {DEFAULT_PRESET_NAME}
          </div>
          {presets.map(p => (
            <div key={p.name} className={styles.item}>
              <span onClick={() => loadPreset(p)} style={{ flex: 1 }}>{p.name}</span>
              <button
                className={styles.deleteBtn}
                onClick={e => { e.stopPropagation(); deletePreset(p.name) }}
                aria-label={`Delete ${p.name}`}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
