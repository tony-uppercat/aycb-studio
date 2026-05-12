import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { pullText, resolveSourceText } from '../../hooks/useDataPropagation'
import { usePromptLibrary } from './usePromptLibrary'
import { PromptLibraryPanel } from './PromptLibraryPanel'
import type { PromptEditorNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

export function PromptEditorNode({ id, data, selected }: NodeProps) {
  const d = data as PromptEditorNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { openPreview } = useMediaPreview()

  // Track upstream text for auto-update. resolveSourceText walks subnet
  // boundaries and bypass chains, and honors per-pin outputPins (JsonParser
  // unpack) — the inline read here used to return '' for any subnet source.
  const upstreamText = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'text-in')
    if (!edge) return ''
    return resolveSourceText(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges)
  })

  const hasInput = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'text-in')
  )

  const initialText = (d.outputText as string) || (d.text as string) || (d.prompt as string) || ''
  const [text, setText] = useState(initialText)
  const [autoUpdate, setAutoUpdate] = useState(
    typeof d.autoUpdate === 'boolean' ? d.autoUpdate : false
  )

  // Sync local state from external data changes (undo, import)
  useEffect(() => {
    const incoming = (typeof d.outputText === 'string' ? d.outputText : null)
                  ?? (typeof d.text === 'string' ? d.text : null)
                  ?? (typeof d.prompt === 'string' ? d.prompt : null)
    if (incoming != null && incoming !== text) {
      setText(incoming)
      updateNodeData(id, { outputText: incoming, text: incoming, prompt: incoming })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.outputText, d.text, d.prompt])

  // Auto-update: when upstream changes and toggle is on, pull automatically
  const prevUpstreamRef = useRef(upstreamText)
  useEffect(() => {
    if (!autoUpdate || !hasInput) return
    if (upstreamText === prevUpstreamRef.current) return
    prevUpstreamRef.current = upstreamText
    if (upstreamText) {
      setText(upstreamText)
      updateNodeData(id, { outputText: upstreamText, text: upstreamText, prompt: upstreamText })
    }
  }, [upstreamText, autoUpdate, hasInput, id, updateNodeData])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const t = e.target.value
    setText(t)
    updateNodeData(id, { outputText: t, text: t, prompt: t })
  }

  const [libraryOpen, setLibraryOpen] = useState(false)
  const { entries, loading, fetchEntries, saveEntry, deleteEntry } = usePromptLibrary()

  const hoveredRef = useRef(false)
  const openFullscreen = useCallback(() => {
    if (!text) return
    openPreview(text, 'text', { onEdit: (t) => { setText(t); updateNodeData(id, { outputText: t }) } })
  }, [text, id, openPreview, updateNodeData])

  const openRef = useRef(openFullscreen)
  openRef.current = openFullscreen

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && hoveredRef.current) {
        e.preventDefault()
        e.stopPropagation()
        openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Detect hex colors in text and render swatches
  const hexColors = useMemo(() => {
    const matches = text.match(/#(?:[0-9a-fA-F]{3,4}){1,2}\b/g)
    return matches ? [...new Set(matches)] : []
  }, [text])

  function handleRun() {
    const upstream = pullText(id, 'text-in', getNodes, getEdges)
    if (upstream) {
      setText(upstream)
      updateNodeData(id, { outputText: upstream, text: upstream, prompt: upstream })
    }
  }

  return (
    <NodeShell
      name="Text Input"
      selected={selected}
      icon="📝"
      inputSlots={[
        { id: 'text-in', label: 'Text', type: 'text' },
      ]}
      outputSlots={[
        { id: 'text-out', label: 'Prompt', type: 'prompt' },
      ]}
      onRun={handleRun}
      autoUpdate={autoUpdate}
      onAutoUpdateToggle={hasInput ? () => {
        setAutoUpdate(!autoUpdate)
        updateNodeData(id, { autoUpdate: !autoUpdate })
      } : undefined}
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
      <div className={styles.nodeContent}>
        <div
          className={styles.expandWrap}
          onMouseEnter={() => { hoveredRef.current = true }}
          onMouseLeave={() => { hoveredRef.current = false }}
        >
          <textarea
            className={styles.promptInput}
            placeholder="Enter text or prompt..."
            value={text}
            onChange={handleChange}
            rows={2}
          />
          {text && (
            <button
              className={styles.expandBtn}
              onClick={(e) => { e.stopPropagation(); openFullscreen() }}
              title="Full screen (Ctrl+Shift)"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          )}
        </div>
        {hexColors.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 0' }}>
            {hexColors.map(hex => (
              <div key={hex} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#1a1a1e', borderRadius: 4, padding: '2px 6px' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: hex, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
                <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{hex}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(PromptEditorNode)
