import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import { NodeShell, type SlotDef } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { loadMedia } from '../../mediaStore'
import { executeCascadesParallel } from '../../utils/cascadeRun'
import { useCanvasStore } from '../../stores/canvasStore'
import { downloadFile } from '../../utils/downloadManager'
import { CANVAS_EVENTS } from '../../events/canvasEvents'
import styles from '../_shared/Node.module.css'

interface BatchItem {
  sourceId: string
  type: 'image' | 'text'
  text?: string
  thumbUrl?: string
  file?: File
  mediaId?: string
}

export function BatchNode({ id, selected }: NodeProps) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { openPreview } = useMediaPreview()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<BatchItem[]>([])
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()
  const [selectedCells, setSelectedCells] = useState<Set<number>>(new Set())
  const thumbUrlsRef = useRef<string[]>([])

  // Read all edges connected to our input handle (like Switch — multiple edges allowed)
  const connectedSources = useStore(state => {
    const edges = state.edges.filter(e => e.target === id && e.targetHandle === 'media-in')
    return edges.map(e => {
      const src = state.nodes.find(n => n.id === e.source)
      const d = src?.data as Record<string, unknown> | undefined
      return {
        sourceId: e.source,
        hasMedia: !!(d?.mediaId),
        hasText: !!(d?.outputText || d?.text || d?.prompt),
        mediaId: d?.mediaId as string | undefined,
        text: String(d?.outputText ?? d?.text ?? d?.prompt ?? ''),
      }
    })
  })

  // Collect items from all connected sources
  const collectItems = useCallback(async () => {
    const nodes = getNodes()
    const edges = getEdges()
    const sourceEdges = edges.filter(e => e.target === id && e.targetHandle === 'media-in')

    // Revoke old thumbnails
    thumbUrlsRef.current.forEach(u => URL.revokeObjectURL(u))
    thumbUrlsRef.current = []

    const collected: BatchItem[] = []

    for (const edge of sourceEdges) {
      const src = nodes.find(n => n.id === edge.source)
      if (!src) continue
      const d = src.data as Record<string, unknown>

      const mediaId = typeof d.mediaId === 'string' ? d.mediaId : null
      const file: File | null = mediaId ? await loadMedia(mediaId) : null

      if (file) {
        const url = URL.createObjectURL(file)
        thumbUrlsRef.current.push(url)
        collected.push({
          sourceId: edge.source,
          type: 'image',
          thumbUrl: url,
          file,
          mediaId: mediaId ?? undefined,
        })
      } else {
        const text = String(d.outputText ?? d.text ?? d.prompt ?? '')
        if (text) {
          collected.push({
            sourceId: edge.source,
            type: 'text',
            text,
          })
        }
      }
    }

    setItems(collected)
    const texts = collected.filter(i => i.type === 'text').map(i => i.text!)
    updateNodeData(id, {
      batchItems: collected.length,
      batchTexts: texts,
      mediaId: collected.find(i => i.mediaId)?.mediaId ?? null,
      outputText: texts.join('\n---\n'),
      text: texts.join('\n---\n'),
    })

    return collected.length
  }, [id, getNodes, getEdges, updateNodeData])

  // Auto-collect when connections change
  const connectedSourcesKey = connectedSources.map(s => `${s.sourceId}:${s.mediaId}:${s.text.slice(0, 20)}`).join('|')
  useEffect(() => {
    if (connectedSources.length > 0) {
      collectItems()
    } else {
      setItems([])
    }
  }, [connectedSources.length, connectedSourcesKey, collectItems])

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => { thumbUrlsRef.current.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  const allEdges = useStore(state => state.edges)

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Find all direct source nodes and run them in PARALLEL
      const sourceEdges = allEdges.filter(e => e.target === id && e.targetHandle === 'media-in')
      const sourceIds = [...new Set(sourceEdges.map(e => e.source))]

      if (sourceIds.length > 0) {
        await executeCascadesParallel(sourceIds, allEdges)
      }

      // Small delay to let React Flow state settle after cascade
      await new Promise(r => setTimeout(r, 100))

      // Now collect fresh results from all sources
      await collectItems()

      // Sum costs from all upstream source nodes
      const costs = useCanvasStore.getState().costs
      const sourceEdgesFinal = allEdges.filter(e => e.target === id && e.targetHandle === 'media-in')
      const srcIds = new Set(sourceEdgesFinal.map(e => e.source))
      const totalCost = costs
        .filter(c => srcIds.has(c.nodeId))
        .reduce((sum, c) => sum + c.costUsd, 0)
      setLastCost(totalCost)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [id, allEdges, collectItems])

  const inputSlots: SlotDef[] = [
    { id: 'media-in', label: 'Items', type: 'image', wide: true },
  ]

  const outputSlots: SlotDef[] = [
    { id: 'media-out', label: 'Media', type: 'image' },
    { id: 'text-out', label: 'Text', type: 'text' },
  ]

  return (
    <NodeShell
      name="Batch"
      icon="▦"
      selected={selected}
      inputSlots={inputSlots}
      outputSlots={outputSlots}
      onRun={run}
      running={loading}
      lastCost={lastCost}
    >
      <div className={styles.nodeContent}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.batchGrid}>
          {items.length === 0 && (
            <div className={styles.batchEmpty}>
              Connect nodes to collect
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={`${item.sourceId}-${i}`}
              className={`${styles.batchCell} ${selectedCells.has(i) ? styles.batchCellSelected : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedCells(prev => {
                  const next = new Set(prev)
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    if (next.has(i)) next.delete(i); else next.add(i)
                  } else {
                    if (next.size === 1 && next.has(i)) next.clear()
                    else { next.clear(); next.add(i) }
                  }
                  return next
                })
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (item.type === 'image' && item.thumbUrl) openPreview(item.thumbUrl, 'image')
                else if (item.type === 'text' && item.text) openPreview(item.text, 'text')
              }}
            >
              {item.type === 'image' && item.thumbUrl ? (
                <img src={item.thumbUrl} alt={`item ${i + 1}`} className={styles.batchThumb} />
              ) : (
                <div className={styles.batchTextCell}>
                  {item.text?.slice(0, 60) || '---'}
                </div>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div className={styles.batchFooter}>
            <span className={styles.batchCount}>
              {items.filter(i => i.type === 'image').length > 0 && `${items.filter(i => i.type === 'image').length} img`}
              {items.filter(i => i.type === 'image').length > 0 && items.filter(i => i.type === 'text').length > 0 && ' · '}
              {items.filter(i => i.type === 'text').length > 0 && `${items.filter(i => i.type === 'text').length} txt`}
            </span>
            <div className={styles.batchActions}>
              {selectedCells.size > 0 && (
                <button
                  className={styles.batchExportBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    const sel = [...selectedCells].sort()
                    for (const idx of sel) {
                      const item = items[idx]
                      if (!item?.file) continue
                      downloadFile(item.file, { filename: item.file.name || `batch_${idx + 1}.png` })
                    }
                    setSelectedCells(new Set())
                  }}
                  title={`Download ${selectedCells.size} selected`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  <span style={{ fontSize: 9, marginLeft: 2 }}>{selectedCells.size}</span>
                </button>
              )}
              {items.some(i => i.type === 'image') && (
                <button
                  className={styles.batchExportBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    const imageItems = selectedCells.size > 0
                      ? [...selectedCells].sort().map(idx => items[idx]).filter(i => i?.type === 'image' && i.file)
                      : items.filter(i => i.type === 'image' && i.file)
                    if (!imageItems.length) return
                    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.BATCH_EXPORT_IMAGES, {
                      detail: {
                        sourceNodeId: id,
                        files: imageItems.map(i => ({ file: i.file!, mediaId: i.mediaId })),
                      }
                    }))
                  }}
                  title="Export as nodes"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(BatchNode)
