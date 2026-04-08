import { useState, useRef, useEffect, useCallback } from 'react'
import { NodeResizer, Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { useCanvasStore } from '../../stores/canvasStore'
import type { GroupNodeData } from '../../types'

const GROUP_COLORS = [
  { name: 'None', value: '' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f59e0b' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Pink', value: '#ec4899' },
]

export function GroupNode({ id, data, selected }: NodeProps) {
  const d = data as GroupNodeData
  const { updateNodeData, setNodes } = useReactFlow()
  const snapshotCanvas = useCanvasStore(s => s.snapshotCanvas)
  const [collapsed, setCollapsed] = useState(d.collapsed ?? false)
  const locked = d.locked ?? false

  // Store original size before collapse so we can restore it
  const originalSizeRef = useRef<{ width: number; height: number } | null>(null)

  // Apply lock/unlock extent on children — only when locked changes
  useEffect(() => {
    setNodes(ns => {
      const target = locked ? 'parent' : undefined
      let changed = false
      const next = ns.map(n => {
        if (n.parentId === id && n.extent !== target) {
          changed = true
          return { ...n, extent: target as 'parent' | undefined }
        }
        return n
      })
      return changed ? next : ns
    })
  }, [locked, id, setNodes])

  // Hide/show child nodes + resize group when collapsed/expanded
  // React Flow auto-hides edges connected to hidden nodes
  useEffect(() => {
    setNodes(ns => ns.map(n => {
      if (n.parentId === id) return { ...n, hidden: collapsed }
      if (n.id === id) {
        if (collapsed) {
          // Save original size before collapsing
          const w = (n.style?.width as number) ?? n.measured?.width ?? 200
          const h = (n.style?.height as number) ?? n.measured?.height ?? 150
          originalSizeRef.current = { width: w, height: h }
          return { ...n, style: { ...n.style, width: 200, height: 36 } }
        } else if (originalSizeRef.current) {
          // Restore original size
          const { width, height } = originalSizeRef.current
          return { ...n, style: { ...n.style, width, height } }
        }
      }
      return n
    }))
  }, [collapsed, id, setNodes])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const spanRef = useRef<HTMLSpanElement>(null)

  const color = d.color || ''
  const borderColor = color || (selected ? 'rgba(245,158,11,0.4)' : '#333')
  const headerBg = color ? `${color}22` : 'rgba(0,0,0,0.3)'

  // Close color menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Track the label value at the time the span receives focus so we can
  // snapshot ONLY when the label actually changes (avoids polluting undo stack).
  const labelOnFocusRef = useRef<string>(d.label || 'Group')

  const handleBlur = useCallback((e: React.FocusEvent<HTMLSpanElement>) => {
    const newLabel = (e.currentTarget.textContent || '').trim() || 'Group'
    // Only snapshot and update if the label actually changed
    if (newLabel !== labelOnFocusRef.current) {
      snapshotCanvas?.()
      updateNodeData(id, { label: newLabel })
    }
  }, [id, updateNodeData, snapshotCanvas])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLSpanElement>) => {
    // Stop all keyboard events from propagating while editing (prevents canvas shortcuts)
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
    if (e.key === 'Escape') {
      // Revert to original label (before editing began)
      e.currentTarget.textContent = labelOnFocusRef.current
      e.currentTarget.blur()
    }
    if (e.key === 'Tab') {
      // Prevent Tab from toggling add-node menu while renaming
      e.preventDefault()
    }
  }, [])

  // Sync span text when data.label changes externally (e.g. undo/redo)
  useEffect(() => {
    if (spanRef.current && document.activeElement !== spanRef.current) {
      spanRef.current.textContent = d.label || 'Group'
    }
  }, [d.label])

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: selected
        ? `1px solid ${borderColor}`
        : color
          ? `1px solid ${color}66`
          : '1px dashed #333',
      borderRadius: 4,
      width: '100%',
      height: '100%',
      minWidth: collapsed ? 160 : undefined,
      minHeight: collapsed ? 32 : undefined,
      overflow: collapsed ? 'hidden' : undefined,
    }}>
      <NodeResizer minWidth={180} minHeight={100} isVisible={selected && !collapsed} color={color || '#f59e0b'} />
      <Handle type="target" position={Position.Left} id="in" />
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 8px', background: headerBg, borderRadius: '3px 3px 0 0',
          position: 'relative',
        }}
      >
        <span
          ref={spanRef}
          className="nodrag nokey nopan"
          style={{
            fontSize: 11, fontWeight: 600,
            color: color || '#888',
            cursor: 'text', outline: 'none', minWidth: 40,
            flex: 1,
          }}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onFocus={e => {
            // Record the label at focus time so Escape can revert correctly
            labelOnFocusRef.current = e.currentTarget.textContent?.trim() || 'Group'
            // Select all text on focus for easy replacement
            const range = document.createRange()
            range.selectNodeContents(e.currentTarget)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }}
        >{d.label || 'Group'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* 3-dot menu button */}
          <button
            className="nodrag"
            onClick={e => { e.stopPropagation(); setMenuOpen(m => !m) }}
            style={{
              background: 'none', border: 'none', color: '#666',
              fontSize: 14, cursor: 'pointer', padding: '0 2px',
              lineHeight: 1, letterSpacing: 1,
            }}
            title="Group options"
          >&#x2022;&#x2022;&#x2022;</button>
          {/* Lock toggle */}
          <button
            className="nodrag"
            onClick={() => updateNodeData(id, { locked: !locked })}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 2, color: locked ? '#f59e0b' : '#666', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
            title={locked ? 'Unlock children' : 'Lock children inside'}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              {locked
                ? <path d="M7 11V7a5 5 0 0110 0v4" />
                : <path d="M7 11V7a5 5 0 019.9-1" />
              }
            </svg>
          </button>
          {/* Collapse toggle */}
          <button
            className="nodrag"
            onClick={() => setCollapsed(c => {
              const next = !c
              updateNodeData(id, { collapsed: next })
              return next
            })}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 2, color: '#666', fontSize: 9, cursor: 'pointer', padding: '1px 4px' }}
          >{collapsed ? '\u25B6' : '\u25BC'}</button>
        </div>
        {/* Color picker dropdown */}
        {menuOpen && (
          <div
            ref={menuRef}
            className="nodrag nokey nopan"
            style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 100,
              background: '#27272a', border: '1px solid #3f3f46', borderRadius: 6,
              padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
              minWidth: 120, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            <span style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Color</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {GROUP_COLORS.map(c => (
                <button
                  key={c.name}
                  onClick={e => {
                    e.stopPropagation()
                    updateNodeData(id, { color: c.value })
                    setMenuOpen(false)
                  }}
                  title={c.name}
                  style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: c.value || '#3f3f46',
                    border: (d.color || '') === c.value ? '2px solid #fff' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {!c.value && <span style={{ fontSize: 10, color: '#888' }}>&#x2715;</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export default GroupNode
