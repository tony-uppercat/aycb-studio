import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, NodeResizer, type NodeProps } from '@xyflow/react'
import styles from './TextNote.module.css'

interface TextNoteData {
  text?: string
  fontSize?: number
  fontFamily?: string
  color?: string
  align?: string
}

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32]
const FONT_FAMILIES = [
  { value: 'system', label: 'System' },
  { value: 'monospace', label: 'Mono' },
  { value: 'serif', label: 'Serif' },
]
const COLORS = ['#fafafa', '#a1a1aa', '#F52776', '#22c55e', '#eab308', '#3b82f6', '#a855f7']

function TextNoteNode({ id, data, selected }: NodeProps) {
  const d = data as TextNoteData
  const { updateNodeData } = useReactFlow()
  const [editing, setEditing] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const text = d.text ?? 'New Note'
  const fontSize = d.fontSize ?? 12
  const fontFamily = d.fontFamily === 'monospace' ? 'monospace'
    : d.fontFamily === 'serif' ? 'Georgia, serif'
    : 'inherit'
  const color = d.color ?? '#fafafa'
  const align = (d.align ?? 'left') as 'left' | 'center' | 'right'

  const update = useCallback((patch: Partial<TextNoteData>) => {
    updateNodeData(id, patch)
  }, [id, updateNodeData])

  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus()
      textRef.current.select()
    }
  }, [editing])

  // Exit edit mode on deselect
  useEffect(() => {
    if (!selected) setEditing(false)
  }, [selected])

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={40}
        lineStyle={{ borderColor: 'var(--accent)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }}
      />

      {/* Toolbar — only when selected */}
      {selected && (
        <div className={styles.toolbar}>
          <select
            className={styles.toolbarSelect}
            value={fontSize}
            onChange={e => update({ fontSize: Number(e.target.value) })}
            title="Font Size"
          >
            {FONT_SIZES.map(s => <option key={s} value={s} style={{ background: '#0a0a0b', color: '#fafafa' }}>{s}</option>)}
          </select>
          <select
            className={styles.toolbarSelect}
            value={d.fontFamily ?? 'system'}
            onChange={e => update({ fontFamily: e.target.value })}
            title="Font Family"
          >
            {FONT_FAMILIES.map(f => <option key={f.value} value={f.value} style={{ background: '#0a0a0b', color: '#fafafa' }}>{f.label}</option>)}
          </select>
          <span className={styles.toolbarSep} />
          {COLORS.map(c => (
            <button
              key={c}
              className={`${styles.colorDot} ${c === color ? styles.colorDotActive : ''}`}
              style={{ background: c }}
              onClick={() => update({ color: c })}
              title={c}
            />
          ))}
          <span className={styles.toolbarSep} />
          {(['left', 'center', 'right'] as const).map(a => (
            <button
              key={a}
              className={`${styles.alignBtn} ${a === align ? styles.alignBtnActive : ''}`}
              onClick={() => update({ align: a })}
              title={a}
            >
              {a === 'left' ? '\u2261' : a === 'center' ? '\u2263' : '\u2261'}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div
        className={`${styles.noteBody} nodrag nowheel nokey`}
        style={{ fontSize, fontFamily, color, textAlign: align }}
        onDoubleClick={() => setEditing(true)}
      >
        {editing ? (
          <textarea
            ref={textRef}
            className={styles.editor}
            value={text}
            onChange={e => update({ text: e.target.value })}
            onBlur={() => setEditing(false)}
            style={{ fontSize, fontFamily, color, textAlign: align }}
          />
        ) : (
          <div className={styles.display}>{text || '\u00A0'}</div>
        )}
      </div>
    </>
  )
}

export default memo(TextNoteNode)
