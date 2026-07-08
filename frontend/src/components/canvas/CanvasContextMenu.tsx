/**
 * Canvas-level context menu — restructured.
 *
 * Handles four right-click targets:
 * 1. Empty canvas (pane) → Add Node submenu, Paste, Select All, Fit View
 * 2. Single node → Run, Bypass, Duplicate, Copy, Delete + media/export actions
 * 3. Multi-selection → same as node + Group, Collage, Templates
 * 4. Edge → Delete Edge
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { NODE_CATALOG, CATEGORY_LABELS, type NodeManifest } from '../../nodes/index'
import { saveUserTemplate, findTemplateByName, deleteUserTemplate } from '../../presets'
import { triggerDownload } from '../../utils/downloadManager'
import {
  downloadMediaFiles,
  saveMediaToAssets,
  downloadNodesFull,
  collectCollageImages,
} from '../../services/canvasExport'
import { stripNodeData, keepNodeContent } from '../../services/templateData'
import type { CollageImage } from '../CollageEditor'
import type { LayoutMode } from '../../utils/imageMergeRender'
import { hasRegisteredRun } from '../../utils/cascadeRun'
import styles from './CanvasContextMenu.module.css'

/* ── Types ── */

export type ContextMenuTarget =
  | { kind: 'pane'; canPaste: boolean }
  | { kind: 'node'; node: Node }
  | { kind: 'selection'; selectedNodes: Node[] }
  | { kind: 'edge'; edge: Edge }

export interface Props {
  x: number
  y: number
  target: ContextMenuTarget
  allEdges: Edge[]
  onClose: () => void
  /* Canvas actions */
  onAddNode?: (entry: NodeManifest, position: { x: number; y: number }) => void
  onPaste?: () => void
  onSelectAll?: () => void
  onFitView?: () => void
  onDuplicate?: (nodes: Node[]) => void
  onCopy?: (nodes: Node[]) => void
  onDelete?: (nodeIds: string[], edgeIds: string[]) => void
  onBypass?: (nodes: Node[]) => void
  onBlock?: (nodes: Node[]) => void
  onGroup?: () => void
  onUngroup?: () => void
  onOpenCollage?: (images: CollageImage[]) => void
  onMerge?: (layout: LayoutMode, imageNodes: Node[]) => void
  onFlip?: (nodes: Node[], axis: 'horizontal' | 'vertical') => void
  onRotate?: (nodes: Node[], angle: 90 | 180 | 270) => void
  onRunSelected?: (nodeIds: string[]) => void
  onUnpack?: (nodes: Node[]) => void
  onDeleteEdge?: (edgeId: string) => void
  /** Position in flow coordinates (for add-node placement) */
  flowPosition?: { x: number; y: number }
}

/* ── Helpers ── */

function collectMediaIds(nodes: Node[]): string[] {
  const ids = new Set<string>()
  for (const n of nodes) {
    const d = n.data as Record<string, unknown>
    if (typeof d.mediaId === 'string') ids.add(d.mediaId)
    if (Array.isArray(d.historyIds)) {
      for (const hid of d.historyIds) if (typeof hid === 'string') ids.add(hid)
    }
    if (Array.isArray(d.frameIds)) {
      for (const fid of d.frameIds) if (typeof fid === 'string') ids.add(fid)
    }
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('mediaId_') && typeof v === 'string') ids.add(v)
    }
  }
  return [...ids]
}

function getInternalEdges(nodes: Node[], allEdges: Edge[]): Edge[] {
  const nodeIds = new Set(nodes.map(n => n.id))
  return allEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
}

/* ── Submenu Wrapper ── */

function SubMenu({ label, icon, shortcut, children, menuX }: {
  label: string; icon: string; shortcut?: string
  children: React.ReactNode; menuX: number
}) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flipLeft = menuX + 480 > window.innerWidth

  const onEnter = () => { if (timerRef.current) clearTimeout(timerRef.current); setOpen(true) }
  const onLeave = () => { timerRef.current = setTimeout(() => setOpen(false), 200) }

  return (
    <div className={styles.subItem} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className={styles.item}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.label}>{label}</span>
        {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
        <span className={styles.arrow}>&#9656;</span>
      </div>
      {open && (
        <div className={`${styles.subMenu} ${flipLeft ? styles.subMenuLeft : ''}`}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ── Node Catalog submenu ── */

const CATEGORY_ORDER = ['input', 'media-model', 'llm', 'utility'] as const

function AddNodeSubMenu({ menuX, onAdd }: { menuX: number; onAdd: (entry: NodeManifest) => void }) {
  const grouped = useMemo(() =>
    CATEGORY_ORDER.map(cat => ({
      cat,
      label: CATEGORY_LABELS[cat],
      items: NODE_CATALOG.filter(n => n.category === cat),
    })).filter(g => g.items.length > 0),
  [])

  return (
    <SubMenu label="Add Node" icon="+" shortcut="Tab" menuX={menuX}>
      {grouped.map(g => (
        <div key={g.cat}>
          <div className={styles.subCatLabel}>{g.label}</div>
          {g.items.map(entry => (
            <button key={entry.type} className={styles.item} onClick={() => onAdd(entry)}>
              <span className={styles.icon}>{entry.icon}</span>
              <span className={styles.label}>{entry.label}</span>
            </button>
          ))}
        </div>
      ))}
    </SubMenu>
  )
}

/* ── Reusable menu item ── */

function Item({ icon, label, shortcut, badge, disabled, danger, onClick }: {
  icon: string; label: string; shortcut?: string; badge?: string | number
  disabled?: boolean; danger?: boolean; onClick?: () => void
}) {
  return (
    <button
      className={`${styles.item} ${disabled ? styles.itemDisabled : ''} ${danger ? styles.itemDanger : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
      {badge != null && <span className={styles.badge}>{badge}</span>}
      {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
    </button>
  )
}

function Sep() {
  return <div className={styles.separator} />
}

/* ── Main Component ── */

export function CanvasContextMenu({
  x, y, target, allEdges, onClose,
  onAddNode, onPaste, onSelectAll, onFitView,
  onDuplicate, onCopy, onDelete, onBypass, onBlock, onGroup, onUngroup,
  onOpenCollage, onMerge, onFlip, onRotate, onRunSelected, onUnpack, onDeleteEdge, flowPosition,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showNodeExportChoice, setShowNodeExportChoice] = useState(false)
  const [templateSaved, setTemplateSaved] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Clamp position to viewport
  const menuX = Math.min(x, window.innerWidth - 260)
  const menuY = Math.min(y, window.innerHeight - 300)

  // Derive selected nodes from target
  const selectedNodes = useMemo(() => {
    if (target.kind === 'node') return [target.node]
    if (target.kind === 'selection') return target.selectedNodes
    return []
  }, [target])

  const nodeCount = selectedNodes.length
  const mediaIds = collectMediaIds(selectedNodes)
  const hasMedia = mediaIds.length > 0
  const imageNodes = selectedNodes.filter(
    n => n.type === 'imageUpload' && typeof (n.data as Record<string, unknown>).mediaId === 'string',
  )
  const canCollage = imageNodes.length >= 2
  // Nodes carrying a single baked image we can mirror in place.
  const flippableNodes = selectedNodes.filter(
    n => typeof (n.data as Record<string, unknown>).mediaId === 'string',
  )
  const canFlip = flippableNodes.length > 0
  const canSaveTemplate = nodeCount >= 2
  const hasGroups = selectedNodes.some(n => n.type === 'group')
  const unpackCount = selectedNodes.reduce((sum, n) => {
    const hids = (n.data as Record<string, unknown>).historyIds as string[] | undefined
    return sum + (hids?.length ?? 0)
  }, 0)
  const canUnpack = unpackCount > 0
  // Selected nodes that have a registered run handler (skip notes/groups)
  const runnableNodes = selectedNodes.filter(n => hasRegisteredRun(n.id))

  // ── Action handlers ──

  const handleAddNode = useCallback((entry: NodeManifest) => {
    onAddNode?.(entry, flowPosition ?? { x: 0, y: 0 })
    onClose()
  }, [onAddNode, flowPosition, onClose])

  const handleBypass = useCallback(() => { onBypass?.(selectedNodes); onClose() }, [onBypass, selectedNodes, onClose])
  const handleBlock = useCallback(() => { onBlock?.(selectedNodes); onClose() }, [onBlock, selectedNodes, onClose])
  const handleDuplicate = useCallback(() => { onDuplicate?.(selectedNodes); onClose() }, [onDuplicate, selectedNodes, onClose])
  const handleUnpack = useCallback(() => { onUnpack?.(selectedNodes); onClose() }, [onUnpack, selectedNodes, onClose])
  const handleCopy = useCallback(() => { onCopy?.(selectedNodes); onClose() }, [onCopy, selectedNodes, onClose])

  const handleDelete = useCallback(() => {
    const nodeIds = selectedNodes.map(n => n.id)
    const edgeIds = allEdges
      .filter(e => nodeIds.includes(e.source) || nodeIds.includes(e.target))
      .map(e => e.id)
    onDelete?.(nodeIds, edgeIds)
    onClose()
  }, [selectedNodes, allEdges, onDelete, onClose])

  const handleGroup = useCallback(() => { onGroup?.(); onClose() }, [onGroup, onClose])
  const handleUngroup = useCallback(() => { onUngroup?.(); onClose() }, [onUngroup, onClose])

  const handleDeleteEdge = useCallback(() => {
    if (target.kind === 'edge') onDeleteEdge?.(target.edge.id)
    onClose()
  }, [target, onDeleteEdge, onClose])

  // ── Download Media ──
  async function handleDownloadMedia() {
    setBusy('media')
    try { await downloadMediaFiles(mediaIds) }
    finally { setBusy(null); onClose() }
  }

  // ── Save to Assets ──
  async function handleSaveToAssets() {
    setBusy('assets')
    try { await saveMediaToAssets(mediaIds) }
    finally { setBusy(null); onClose() }
  }

  // ── Download Nodes Full ──
  async function handleDownloadNodesFull() {
    setBusy('nodes-full')
    try { await downloadNodesFull(selectedNodes, allEdges, mediaIds) }
    finally { setBusy(null); onClose() }
  }

  // ── Download Nodes Clean ──
  function handleDownloadNodesClean() {
    setBusy('nodes-clean')
    try {
      const internalEdges = getInternalEdges(selectedNodes, allEdges)
      const cleanedNodes = selectedNodes.map(n => ({
        id: n.id, type: n.type, position: n.position,
        data: stripNodeData(n.data as Record<string, unknown>),
      }))
      const payload = {
        version: 1, type: 'aycb-nodes-clean', exportedAt: new Date().toISOString(),
        nodes: cleanedNodes,
        edges: internalEdges.map(e => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
        })),
      }
      triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `nodes-clean-${Date.now()}.geminishot.json`)
    } finally {
      setBusy(null)
      onClose()
    }
  }

  // ── Save as Template ──
  function saveTemplate(withContent: boolean) {
    if (!canSaveTemplate) return
    const suffix = withContent ? '' : ' (clean)'
    const raw = window.prompt(`Template name${suffix}:`)
    if (!raw) return
    // Sanitize: trim + strip control characters
    const name = raw.trim().replace(/[\x00-\x1f\x7f]/g, '')
    if (!name) return

    // Overwrite detection
    const existing = findTemplateByName(name)
    if (existing) {
      if (!window.confirm(`Template "${name}" exists. Overwrite?`)) return
      deleteUserTemplate(existing.id)
    }

    const internalEdges = getInternalEdges(selectedNodes, allEdges)
    const minX = Math.min(...selectedNodes.map(n => n.position.x))
    const minY = Math.min(...selectedNodes.map(n => n.position.y))

    const selectedIds = new Set(selectedNodes.map(n => n.id))
    const templateNodes = selectedNodes.map(n => {
      const base: Record<string, unknown> = {
        id: n.id, type: n.type,
        position: n.parentId && selectedIds.has(n.parentId)
          ? n.position  // child of group: keep relative position
          : { x: n.position.x - minX, y: n.position.y - minY },
        data: withContent
          ? keepNodeContent(n.data as Record<string, unknown>)
          : stripNodeData(n.data as Record<string, unknown>),
      }
      if (n.parentId && selectedIds.has(n.parentId)) base.parentId = n.parentId
      if (n.extent) base.extent = n.extent
      if (n.style) base.style = n.style
      return base
    })

    const templateEdges = internalEdges.map(e => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    }))

    saveUserTemplate({
      id: `ut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      description: `${templateNodes.length} nodes${withContent ? ' + content' : ''}`,
      nodes: templateNodes as import('@xyflow/react').Node[],
      edges: templateEdges as import('@xyflow/react').Edge[],
      createdAt: new Date().toISOString(),
    })

    setTemplateSaved(true)
    setTimeout(() => { setTemplateSaved(false); onClose() }, 1200)
  }

  // ── Quick Merge (right-click → pick layout → new image node) ──
  const handleMerge = useCallback((layout: LayoutMode) => {
    if (!onMerge || imageNodes.length < 2) return
    onMerge(layout, imageNodes)
    onClose()
  }, [onMerge, imageNodes, onClose])

  // ── Flip (right-click → mirror selected image nodes in place) ──
  const handleFlip = useCallback((axis: 'horizontal' | 'vertical') => {
    if (!onFlip || flippableNodes.length === 0) return
    onFlip(flippableNodes, axis)
    onClose()
  }, [onFlip, flippableNodes, onClose])

  // ── Rotate (right-click → rotate selected image nodes in place) ──
  const handleRotate = useCallback((angle: 90 | 180 | 270) => {
    if (!onRotate || flippableNodes.length === 0) return
    onRotate(flippableNodes, angle)
    onClose()
  }, [onRotate, flippableNodes, onClose])

  // ── Run Selected (async) — run every selected runnable node in parallel ──
  const handleRunSelected = useCallback(() => {
    const ids = runnableNodes.map(n => n.id)
    if (!onRunSelected || ids.length === 0) return
    onRunSelected(ids)
    onClose()
  }, [onRunSelected, runnableNodes, onClose])

  // ── Create Collage ──
  async function handleCreateCollage() {
    if (!canCollage || !onOpenCollage) return
    setBusy('collage')
    try {
      const collageImages = await collectCollageImages(imageNodes)
      if (collageImages.length >= 2) onOpenCollage(collageImages)
    } finally {
      setBusy(null)
      onClose()
    }
  }

  // ── Render ──

  return (
    <>
      <div className={styles.overlay} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div className={styles.menu} style={{ left: menuX, top: menuY }}>

        {/* ═══ PANE (empty canvas) ═══ */}
        {target.kind === 'pane' && (
          <>
            <AddNodeSubMenu menuX={menuX} onAdd={handleAddNode} />
            <Sep />
            <Item icon="📋" label="Paste" shortcut="Ctrl+V" disabled={!target.canPaste} onClick={() => { onPaste?.(); onClose() }} />
            <Item icon="⊞" label="Select All" shortcut="Ctrl+A" onClick={() => { onSelectAll?.(); onClose() }} />
            <Item icon="◎" label="Fit View" shortcut="F" onClick={() => { onFitView?.(); onClose() }} />
          </>
        )}

        {/* ═══ NODE / SELECTION ═══ */}
        {(target.kind === 'node' || target.kind === 'selection') && (
          <>
            <div className={styles.header}>
              {nodeCount} node{nodeCount > 1 ? 's' : ''} selected
            </div>

            {nodeCount >= 2 && onRunSelected && (
              <>
                <Item
                  icon="▶"
                  label="Run Selected (Async)"
                  badge={runnableNodes.length}
                  disabled={runnableNodes.length === 0}
                  onClick={handleRunSelected}
                />
                <Sep />
              </>
            )}

            <Item icon="⏩" label="Bypass" shortcut="B" onClick={handleBypass} />
            {onBlock && (
              <Item icon="🚫" label="Block Run" onClick={handleBlock} />
            )}
            <Item icon="⊕" label="Duplicate" shortcut="Ctrl+D" onClick={handleDuplicate} />
            {canUnpack && (
              <Item icon="⊟" label="Unpack History" shortcut="U" badge={unpackCount} onClick={handleUnpack} />
            )}
            <Item icon="📋" label="Copy" shortcut="Ctrl+C" onClick={handleCopy} />
            {canFlip && onFlip && (
              <SubMenu label="Flip" icon="🪞" menuX={menuX}>
                <button className={styles.item} onClick={() => handleFlip('horizontal')}>
                  <span className={styles.icon}>↔</span>
                  <span className={styles.label}>Horizontal</span>
                  <span className={styles.shortcut}>H</span>
                </button>
                <button className={styles.item} onClick={() => handleFlip('vertical')}>
                  <span className={styles.icon}>↕</span>
                  <span className={styles.label}>Vertical</span>
                  <span className={styles.shortcut}>V</span>
                </button>
              </SubMenu>
            )}
            {canFlip && onRotate && (
              <SubMenu label="Rotate" icon="⟳" menuX={menuX}>
                <button className={styles.item} onClick={() => handleRotate(90)}>
                  <span className={styles.icon}>⟳</span>
                  <span className={styles.label}>90° CW</span>
                </button>
                <button className={styles.item} onClick={() => handleRotate(270)}>
                  <span className={styles.icon}>⟲</span>
                  <span className={styles.label}>90° CCW</span>
                </button>
                <button className={styles.item} onClick={() => handleRotate(180)}>
                  <span className={styles.icon}>↻</span>
                  <span className={styles.label}>180°</span>
                </button>
              </SubMenu>
            )}
            <Item icon="🗑" label="Delete" shortcut="Del" danger onClick={handleDelete} />

            <Sep />

            {nodeCount >= 2 && (
              <Item icon="📦" label="Group Selected" shortcut="Ctrl+G" onClick={handleGroup} />
            )}
            {hasGroups && (
              <Item icon="📤" label="Ungroup" shortcut="Ctrl+Shift+G" onClick={handleUngroup} />
            )}
            {(nodeCount >= 2 || hasGroups) && <Sep />}

            {/* Media */}
            {hasMedia && (
              <Item
                icon="📥"
                label={busy === 'media' ? 'Downloading...' : 'Download Media'}
                badge={mediaIds.length}
                disabled={busy !== null}
                onClick={handleDownloadMedia}
              />
            )}
            {hasMedia && (
              <Item
                icon="📂"
                label={busy === 'assets' ? 'Saving...' : 'Save to Assets'}
                badge={mediaIds.length}
                disabled={busy !== null}
                onClick={handleSaveToAssets}
              />
            )}
            {canCollage && onMerge && (
              <SubMenu label="Merge" icon="🧩" menuX={menuX}>
                <button className={styles.item} onClick={() => handleMerge('grid')}>
                  <span className={styles.icon}>⊞</span>
                  <span className={styles.label}>Grid</span>
                  <span className={styles.badge}>{imageNodes.length}</span>
                </button>
                <button className={styles.item} onClick={() => handleMerge('horizontal')}>
                  <span className={styles.icon}>▭</span>
                  <span className={styles.label}>Horizontal</span>
                  <span className={styles.badge}>{imageNodes.length}</span>
                </button>
                <button className={styles.item} onClick={() => handleMerge('vertical')}>
                  <span className={styles.icon}>▯</span>
                  <span className={styles.label}>Vertical</span>
                  <span className={styles.badge}>{imageNodes.length}</span>
                </button>
              </SubMenu>
            )}
            {canCollage && onOpenCollage && (
              <Item
                icon="⊞"
                label={busy === 'collage' ? 'Opening...' : 'Create Collage'}
                badge={imageNodes.length}
                disabled={busy !== null}
                onClick={handleCreateCollage}
              />
            )}
            {(hasMedia || canCollage) && <Sep />}

            {/* Templates */}
            {canSaveTemplate && !templateSaved && (
              <>
                <Item icon="T" label="Save Template (Clean)" onClick={() => saveTemplate(false)} />
                <Item icon="T" label="Save Template (Content)" onClick={() => saveTemplate(true)} />
                <Sep />
              </>
            )}
            {canSaveTemplate && templateSaved && (
              <>
                <Item icon="&#10003;" label="Saved!" disabled />
                <Sep />
              </>
            )}

            {/* Export */}
            {!showNodeExportChoice ? (
              <Item
                icon="💾"
                label="Export Nodes"
                badge={nodeCount}
                disabled={busy !== null}
                onClick={() => setShowNodeExportChoice(true)}
              />
            ) : (
              <div className={styles.inlineSubMenu}>
                <Item
                  icon="📦"
                  label={busy === 'nodes-full' ? 'Exporting...' : 'Full (with media)'}
                  disabled={busy !== null}
                  onClick={handleDownloadNodesFull}
                />
                <Item
                  icon="📋"
                  label={busy === 'nodes-clean' ? 'Exporting...' : 'Clean (settings only)'}
                  disabled={busy !== null}
                  onClick={handleDownloadNodesClean}
                />
              </div>
            )}
          </>
        )}

        {/* ═══ EDGE ═══ */}
        {target.kind === 'edge' && (
          <Item icon="🗑" label="Delete Edge" danger onClick={handleDeleteEdge} />
        )}
      </div>
    </>
  )
}
