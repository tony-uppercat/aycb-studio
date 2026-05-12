import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { api } from '../../api'
import { pullMedia, resolveSourceMediaId } from '../../hooks/useDataPropagation'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { useSettings } from '../../components/SettingsContext'
import { reportNodeError } from '../../utils/nodeErrors'
import type { ImageFxNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

type ImageFxNodeType = Node<ImageFxNodeData, 'imageFx'>

export function ImageFxNode({ id, data, selected }: NodeProps<ImageFxNodeType>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { apiKey } = useSettings()
  const { openPreview } = useMediaPreview()

  // Subscribe to upstream changes. Walks subnets via resolveSourceMediaId so
  // sub_graph inner Image edits trigger re-render here.
  useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'image-in')
    if (!edge) return ''
    return resolveSourceMediaId(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges) ?? ''
  })

  const [effect, setEffect] = useState<string>(data.effect ?? 'none')
  const [threshold1, setThreshold1] = useState(data.cannyThreshold1 ?? 50)
  const [threshold2, setThreshold2] = useState(data.cannyThreshold2 ?? 150)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const processEffect = useCallback(async () => {
    const { file } = await pullMedia(id, 'image-in', getNodes, getEdges)
    if (!file) {
      setPreview(null)
      setError('')
      return
    }

    if (effect === 'none') {
      // Pass through original
      const url = URL.createObjectURL(file)
      setPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return url })
      const mid = data.mediaId || generateMediaId()
      await saveMediaForProject(mid,file)
      updateNodeData(id, { mediaId: mid, effect })
      return
    }

    if (effect === 'canny') {
      setLoading(true)
      setError('')
      try {
        const r = await api.cannyEdge(file, threshold1, threshold2)
        const b64Url = `data:image/png;base64,${r.image_b64}`
        setPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return b64Url })

        // Save processed image for downstream
        const resp = await fetch(b64Url)
        const blob = await resp.blob()
        const processedFile = new File([blob], `canny_${Date.now()}.png`, { type: 'image/png' })
        const mid = generateMediaId()
        await saveMediaForProject(mid,processedFile)
        updateNodeData(id, { mediaId: mid, effect, cannyThreshold1: threshold1, cannyThreshold2: threshold2 })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        reportNodeError(id, msg)
      } finally {
        setLoading(false)
      }
    }

    if (effect === 'depth') {
      setLoading(true)
      setError('')
      try {
        const r = await api.depthEstimate(file, apiKey)
        const b64Url = `data:image/png;base64,${r.image_b64}`
        setPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return b64Url })

        const resp = await fetch(b64Url)
        const blob = await resp.blob()
        const processedFile = new File([blob], `depth_${Date.now()}.png`, { type: 'image/png' })
        const mid = generateMediaId()
        await saveMediaForProject(mid,processedFile)
        updateNodeData(id, { mediaId: mid, effect })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        reportNodeError(id, msg)
      } finally {
        setLoading(false)
      }
    }
  }, [id, effect, threshold1, threshold2, getNodes, getEdges, updateNodeData, data.mediaId, apiKey])

  // Revoke blob URLs on unmount
  useEffect(() => {
    return () => {
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
    }
  }, [preview])

  // Run button handler
  function handleRun() {
    processEffect()
  }

  return (
    <NodeShell name="Image FX" selected={selected} icon="🎨"
      inputSlots={[{ id: 'image-in', label: 'Image', type: 'image' }]}
      outputSlots={[{ id: 'image-out', label: 'Processed', type: 'image' }]}
      onRun={handleRun}
      running={loading}
    >
      <div className={styles.nodeContent}>
        <div className={styles.effectsPanel}>
          <div className={styles.effectRow}>
            <button
              className={`${styles.effectToggle} ${effect === 'none' ? styles.effectToggleActive : ''}`}
              onClick={() => setEffect('none')}
            >Off</button>
            <button
              className={`${styles.effectToggle} ${effect === 'canny' ? styles.effectToggleActive : ''}`}
              onClick={() => setEffect('canny')}
            >Canny</button>
            <button
              className={`${styles.effectToggle} ${effect === 'depth' ? styles.effectToggleActive : ''}`}
              onClick={() => setEffect('depth')}
            >Depth</button>
          </div>

          {effect === 'canny' && (
            <div className={styles.effectRow} style={{ flexDirection: 'column', gap: '2px' }}>
              <div className={styles.effectRow}>
                <span className={styles.label} style={{ width: 24 }}>Lo</span>
                <input
                  type="range" min={10} max={200} value={threshold1}
                  className={styles.effectSlider}
                  onChange={e => setThreshold1(Number(e.target.value))}
                  title={`Low threshold: ${threshold1}`}
                />
                <span className={styles.label} style={{ width: 24, textAlign: 'right' }}>{threshold1}</span>
              </div>
              <div className={styles.effectRow}>
                <span className={styles.label} style={{ width: 24 }}>Hi</span>
                <input
                  type="range" min={50} max={300} value={threshold2}
                  className={styles.effectSlider}
                  onChange={e => setThreshold2(Number(e.target.value))}
                  title={`High threshold: ${threshold2}`}
                />
                <span className={styles.label} style={{ width: 24, textAlign: 'right' }}>{threshold2}</span>
              </div>
            </div>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.previewArea}>
          {preview
            ? <img src={preview} alt="fx preview" className={styles.previewImg}
                onClick={(e) => { e.stopPropagation(); openPreview(preview, 'image') }}
                style={{ cursor: 'pointer' }} />
            : <span className={styles.dropHint}>Connect an image</span>
          }
        </div>
      </div>
    </NodeShell>
  )
}

export default ImageFxNode
