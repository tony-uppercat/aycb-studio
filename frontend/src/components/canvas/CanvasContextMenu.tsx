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
import { loadMedia } from '../../mediaStore'
import { serializeNodes } from '../../hooks/useCanvasPersistence'
import { saveUserTemplate } from '../../presets'
import { triggerDownload, downloadFile } from '../../utils/downloadManager'
import type { CollageImage } from '../CollageEditor'
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
  onGroup?: () => void
  onUngroup?: () => void
  onOpenCollage?: (images: CollageImage[]) => void
  onDeleteEdge?: (edgeId: string) => void
  /** Position in flow coordinates (for add-node placement) */
  flowPosition?: { x: number; y: number }
}

/* ── Helpers ── */

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

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

function stripNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const KEEP_KEYS = new Set([
    'selectedModel', 'model', 'doEmbed', 'nFrames', 'effect',
    'cannyThreshold1', 'cannyThreshold2', 'separator', 'jsonPath',
    'activeChannel', 'label', 'collapsed', 'systemPrompt',
    'aspectRatio', 'resolution', '_customName', '_bypassed',
    'imageSize', 'maxFrames', 'extractionMode', 'cutSensitivity', 'color',
    'autoUpdate', 'showThinking', 'excludedKeys', 'outputLimit', 'parseMode',
    'selections',
  ])
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (KEEP_KEYS.has(k)) clean[k] = v
  }
  return clean
}

function keepNodeContent(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof File) continue
    if (typeof v === 'string' && v.startsWith('blob:')) continue
    clean[k] = v
  }
  return clean
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
  onDuplicate, onCopy, onDelete, onBypass, onGroup, onUngroup,
  onOpenCollage, onDeleteEdge, flowPosition,
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
  const canSaveTemplate = nodeCount >= 2
  const hasGroups = selectedNodes.some(n => n.type === 'group')

  // ── Action handlers ──

  const handleAddNode = useCallback((entry: NodeManifest) => {
    onAddNode?.(entry, flowPosition ?? { x: 0, y: 0 })
    onClose()
  }, [onAddNode, flowPosition, onClose])

  const handleBypass = useCallback(() => { onBypass?.(selectedNodes); onClose() }, [onBypass, selectedNodes, onClose])
  const handleDuplicate = useCallback(() => { onDuplicate?.(selectedNodes); onClose() }, [onDuplicate, selectedNodes, onClose])
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
    try {
      for (const mid of mediaIds) {
        try {
          const file = await loadMedia(mid)
          if (!file) continue
          downloadFile(file, { filename: file.name || `${mid}.png` })
        } catch { /* skip broken entries */ }
      }
    } finally {
      setBusy(null)
      onClose()
    }
  }

  // ── Download Nodes Full ──
  async function handleDownloadNodesFull() {
    setBusy('nodes-full')
    try {
      const internalEdges = getInternalEdges(selectedNodes, allEdges)
      const serialized = serializeNodes(selectedNodes)
      const mediaItems: Array<{ id: string; name: string; type: string; dataB64: string }> = []
      for (const mid of mediaIds) {
        try {
          const file = await loadMedia(mid)
          if (!file) continue
          const buf = await file.arrayBuffer()
          mediaItems.push({ id: mid, name: file.name, type: file.type, dataB64: arrayBufferToBase64(buf) })
        } catch { /* skip */ }
      }
      const payload = {
        version: 1,
        timestamp: new Date().toISOString(),
        canvas: {
          nodes: serialized,
          edges: internalEdges.map(e => ({
            id: e.id, source: e.source, target: e.target,
            sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
          })),
        },
        settings: { model: 'Gemini 2.5 Flash', doEmbed: false },
        media: mediaItems,
      }
      triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `nodes-${Date.now()}.geminishot.json`)
    } finally {
      setBusy(null)
      onClose()
    }
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
    const name = window.prompt(`Template name${suffix}:`)?.trim()
    if (!name) return

    const internalEdges = getInternalEdges(selectedNodes, allEdges)
    const minX = Math.min(...selectedNodes.map(n => n.position.x))
    const minY = Math.min(...selectedNodes.map(n => n.position.y))

    const templateNodes = selectedNodes.map(n => ({
      id: n.id, type: n.type,
      position: { x: n.position.x - minX, y: n.position.y - minY },
      data: withContent
        ? keepNodeContent(n.data as Record<string, unknown>)
        : stripNodeData(n.data as Record<string, unknown>),
    }))

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

  // ── Create Collage ──
  async function handleCreateCollage() {
    if (!canCollage || !onOpenCollage) return
    setBusy('collage')
    try {
      const collageImages: CollageImage[] = []
      for (const node of imageNodes) {
        const d = node.data as Record<string, unknown>
        const mediaId = d.mediaId as string
        try {
          const file = await loadMedia(mediaId)
          if (!file) continue
          const url = URL.createObjectURL(file)
          collageImages.push({ id: node.id, url, name: file.name || `image-${node.id}` })
        } catch { /* skip */ }
      }
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

            <Item icon="⏩" label="Bypass" shortcut="B" onClick={handleBypass} />
            <Item icon="⊕" label="Duplicate" shortcut="Ctrl+D" onClick={handleDuplicate} />
            <Item icon="📋" label="Copy" shortcut="Ctrl+C" onClick={handleCopy} />
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
                <Item icon="☆" label="Save Template (clean)" onClick={() => saveTemplate(false)} />
                <Item icon="★" label="Save Template (content)" onClick={() => saveTemplate(true)} />
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
