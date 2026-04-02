import { useCallback, useEffect, useRef, useState } from 'react'
import { useNodes, useReactFlow, useViewport } from '@xyflow/react'
import { loadMedia } from '../mediaStore'
import { downloadFile } from '../utils/downloadManager'
import styles from './AlignToolbar.module.css'
import {
  alignLeft,
  alignHCenter,
  alignRight,
  distributeH,
  alignTop,
  alignVCenter,
  alignBottom,
  distributeV,
  stackH,
  stackV,
  autoArrange,
  nodeW,
  nodeH,
} from '../utils/alignOps'
import type { PositionMap } from '../utils/alignOps'
import type { Node } from '@xyflow/react'

interface AlignToolbarProps {
  doSnapshot: () => void
  containerRef: { current: HTMLDivElement | null }
}

const TOOLBAR_ABOVE = 48 // px above the bounding box top edge

export function AlignToolbar({ doSnapshot, containerRef }: AlignToolbarProps) {
  const allNodes = useNodes()
  const { setNodes, flowToScreenPosition } = useReactFlow()
  useViewport() // re-render on pan/zoom so position tracks the selection

  const selected = allNodes.filter(n => n.selected)
  const selKey = selected.map(n => n.id).sort().join(',')

  const [dismissed, setDismissed] = useState(false)
  const prevKeyRef = useRef('')

  // Reset dismissed when the selection set changes.
  // We also update prevKeyRef when selKey becomes '' (empty selection) so that
  // re-selecting the same set of nodes after dismissing and deselecting will
  // correctly register as a change and re-show the toolbar.
  useEffect(() => {
    if (selKey !== prevKeyRef.current) {
      prevKeyRef.current = selKey
      if (selKey !== '') {
        setDismissed(false)
      }
    }
  }, [selKey])

  // Bounding box of selected nodes in flow coordinates
  let bbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null
  if (selected.length >= 2) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of selected) {
      const w = nodeW(n), h = nodeH(n)
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    }
    bbox = { minX, minY, maxX, maxY }
  }

  // Check if any selected nodes have media (for download button)
  const hasMedia = selected.some(n => {
    const d = n.data as Record<string, unknown>
    return typeof d.mediaId === 'string'
  })
  const mediaCount = selected.filter(n => {
    const d = n.data as Record<string, unknown>
    return typeof d.mediaId === 'string'
  }).length

  const handleDownloadSelected = useCallback(async () => {
    const mediaNodes = allNodes.filter(n => n.selected).filter(n => {
      const d = n.data as Record<string, unknown>
      return typeof d.mediaId === 'string'
    })
    for (const n of mediaNodes) {
      const d = n.data as Record<string, unknown>
      if (typeof d.mediaId !== 'string') continue
      const file = await loadMedia(d.mediaId)
      if (!file) continue
      downloadFile(file, { filename: file.name || `image_${n.id}.png` })
    }
  }, [allNodes])

  // Convert to container-relative screen coordinates
  let toolbarStyle: React.CSSProperties | null = null
  let bottomBarStyle: React.CSSProperties | null = null
  // eslint-disable-next-line react-hooks/refs
  if (bbox && containerRef.current && !dismissed) {
    const cx = (bbox.minX + bbox.maxX) / 2
    // eslint-disable-next-line react-hooks/refs
    const rect = containerRef.current.getBoundingClientRect()

    const screenTop = flowToScreenPosition({ x: cx, y: bbox.minY })
    const rawTop = screenTop.y - rect.top - TOOLBAR_ABOVE
    toolbarStyle = {
      left: screenTop.x - rect.left,
      top: Math.max(8, rawTop),
    }

    if (hasMedia) {
      const screenBottom = flowToScreenPosition({ x: cx, y: bbox.maxY })
      bottomBarStyle = {
        left: screenBottom.x - rect.left,
        top: screenBottom.y - rect.top + 12,
      }
    }
  }

  // Core executor: snapshot then apply position updates
  const run = useCallback(
    (fn: (sel: Node[]) => PositionMap) => {
      const sel = allNodes.filter(n => n.selected)
      if (sel.length < 2) return
      doSnapshot()
      const updates = fn(sel)
      setNodes(ns =>
        ns.map(n => {
          const upd = updates[n.id]
          if (!upd) return n
          return { ...n, position: { x: upd.x ?? n.position.x, y: upd.y ?? n.position.y } }
        }),
      )
    },
    [allNodes, doSnapshot, setNodes],
  )

  if (!toolbarStyle) return null

  return (
    <>
    <div className={styles.toolbar} style={toolbarStyle}>
      {/* Close */}
      <button className={styles.closeBtn} onClick={() => setDismissed(true)} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>

      <div className={styles.sep} />

      {/* Auto-arrange */}
      <button className={styles.btn} onClick={() => run(autoArrange)} title="Auto-arrange (grid)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="1" y="1" width="5" height="5" rx="0.5" />
          <rect x="8" y="1" width="5" height="5" rx="0.5" />
          <rect x="1" y="8" width="5" height="5" rx="0.5" />
          <rect x="8" y="8" width="5" height="5" rx="0.5" />
        </svg>
      </button>

      <div className={styles.sep} />

      {/* Align left edges */}
      <button className={styles.btn} onClick={() => run(alignLeft)} title="Align left edges">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
          <line x1="2.5" y1="1" x2="2.5" y2="13" strokeWidth="1.5" />
          <rect x="2.5" y="2" width="8" height="2.5" fill="currentColor" stroke="none" />
          <rect x="2.5" y="6" width="5" height="2.5" fill="currentColor" stroke="none" />
          <rect x="2.5" y="10" width="6.5" height="2.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Align horizontal centers */}
      <button className={styles.btn} onClick={() => run(alignHCenter)} title="Align horizontal centers">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
          <line x1="7" y1="1" x2="7" y2="13" strokeWidth="1.5" />
          <rect x="3" y="2" width="8" height="2.5" fill="currentColor" stroke="none" />
          <rect x="4.5" y="6" width="5" height="2.5" fill="currentColor" stroke="none" />
          <rect x="2" y="10" width="10" height="2.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Align right edges */}
      <button className={styles.btn} onClick={() => run(alignRight)} title="Align right edges">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
          <line x1="11.5" y1="1" x2="11.5" y2="13" strokeWidth="1.5" />
          <rect x="3.5" y="2" width="8" height="2.5" fill="currentColor" stroke="none" />
          <rect x="6.5" y="6" width="5" height="2.5" fill="currentColor" stroke="none" />
          <rect x="5" y="10" width="6.5" height="2.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Distribute horizontally */}
      <button className={styles.btn} onClick={() => run(distributeH)} title="Distribute horizontally">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="0.5" y="3" width="2.5" height="8" rx="0.5" />
          <rect x="5.75" y="4.5" width="2.5" height="5" rx="0.5" />
          <rect x="11" y="3" width="2.5" height="8" rx="0.5" />
          <rect x="3" y="6.5" width="2.75" height="1" opacity="0.5" />
          <rect x="8.25" y="6.5" width="2.75" height="1" opacity="0.5" />
        </svg>
      </button>

      <div className={styles.sep} />

      {/* Align top edges */}
      <button className={styles.btn} onClick={() => run(alignTop)} title="Align top edges">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
          <line x1="1" y1="2.5" x2="13" y2="2.5" strokeWidth="1.5" />
          <rect x="2" y="2.5" width="2.5" height="8" fill="currentColor" stroke="none" />
          <rect x="6" y="2.5" width="2.5" height="5" fill="currentColor" stroke="none" />
          <rect x="10" y="2.5" width="2.5" height="6.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Align vertical centers */}
      <button className={styles.btn} onClick={() => run(alignVCenter)} title="Align vertical centers">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
          <line x1="1" y1="7" x2="13" y2="7" strokeWidth="1.5" />
          <rect x="2" y="3" width="2.5" height="8" fill="currentColor" stroke="none" />
          <rect x="6" y="4.5" width="2.5" height="5" fill="currentColor" stroke="none" />
          <rect x="10" y="2" width="2.5" height="10" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Align bottom edges */}
      <button className={styles.btn} onClick={() => run(alignBottom)} title="Align bottom edges">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
          <line x1="1" y1="11.5" x2="13" y2="11.5" strokeWidth="1.5" />
          <rect x="2" y="3.5" width="2.5" height="8" fill="currentColor" stroke="none" />
          <rect x="6" y="6.5" width="2.5" height="5" fill="currentColor" stroke="none" />
          <rect x="10" y="5" width="2.5" height="6.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Distribute vertically */}
      <button className={styles.btn} onClick={() => run(distributeV)} title="Distribute vertically">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="3" y="0.5" width="8" height="2.5" rx="0.5" />
          <rect x="4.5" y="5.75" width="5" height="2.5" rx="0.5" />
          <rect x="3" y="11" width="8" height="2.5" rx="0.5" />
          <rect x="6.5" y="3" width="1" height="2.75" opacity="0.5" />
          <rect x="6.5" y="8.25" width="1" height="2.75" opacity="0.5" />
        </svg>
      </button>

      <div className={styles.sep} />

      {/* Pack horizontally */}
      <button className={styles.btn} onClick={() => run(stackH)} title="Pack horizontally">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="1" y="3" width="3" height="8" rx="0.5" />
          <rect x="5" y="3" width="3" height="8" rx="0.5" />
          <rect x="9" y="3" width="4" height="8" rx="0.5" />
        </svg>
      </button>

      {/* Pack vertically */}
      <button className={styles.btn} onClick={() => run(stackV)} title="Pack vertically">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="3" y="1" width="8" height="3" rx="0.5" />
          <rect x="3" y="5" width="8" height="3" rx="0.5" />
          <rect x="3" y="9" width="8" height="4" rx="0.5" />
        </svg>
      </button>
    </div>

    {/* Bottom bar — Download selected */}
    {bottomBarStyle && (
      <div className={styles.bottomBar} style={bottomBarStyle}>
        <button className={styles.downloadBtn} onClick={handleDownloadSelected} title={`Download ${mediaCount} images`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          <span>Download {mediaCount}</span>
        </button>
      </div>
    )}
    </>
  )
}
