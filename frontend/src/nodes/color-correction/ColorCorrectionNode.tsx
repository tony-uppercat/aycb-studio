import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { pullMedia, resolveSourceMediaId } from '../../hooks/useDataPropagation'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { reportNodeError } from '../../utils/nodeErrors'
import styles from '../_shared/Node.module.css'

interface ColorCorrectionNodeData extends Record<string, unknown> {
  brightness?: number
  contrast?: number
  saturation?: number
  mediaId?: string
}

type ColorCorrectionNodeType = Node<ColorCorrectionNodeData, 'colorCorrection'>

const DEFAULT_BCS = { brightness: 100, contrast: 100, saturation: 100 } as const

function filterStr(b: number, c: number, s: number): string {
  return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`
}

export function ColorCorrectionNode({ id, data, selected }: NodeProps<ColorCorrectionNodeType>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { openPreview } = useMediaPreview()

  // Subscribe to upstream mediaId so reconnects/source-changes re-fetch the input.
  // Mirrors ImageFxNode's pattern.
  const upstreamMediaId = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'image-in')
    if (!edge) return ''
    return resolveSourceMediaId(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges) ?? ''
  })

  const [brightness, setBrightness] = useState<number>(data.brightness ?? DEFAULT_BCS.brightness)
  const [contrast, setContrast] = useState<number>(data.contrast ?? DEFAULT_BCS.contrast)
  const [saturation, setSaturation] = useState<number>(data.saturation ?? DEFAULT_BCS.saturation)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const sourceFileRef = useRef<File | null>(null)

  // Re-fetch input image whenever upstream source changes.
  useEffect(() => {
    let cancelled = false
    let revoke: string | null = null
    void (async () => {
      const { file } = await pullMedia(id, 'image-in', getNodes, getEdges)
      if (cancelled) return
      sourceFileRef.current = file ?? null
      if (file) {
        const url = URL.createObjectURL(file)
        revoke = url
        setSourceUrl(prev => {
          if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
          return url
        })
      } else {
        setSourceUrl(prev => {
          if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
          return null
        })
      }
    })()
    return () => {
      cancelled = true
      // Don't revoke `revoke` here — it's the URL we just handed to the <img>.
      // The next effect or unmount handles it via the setSourceUrl callback.
      void revoke
    }
  }, [upstreamMediaId, id, getNodes, getEdges])

  // Revoke the current preview blob on unmount.
  useEffect(() => {
    return () => { if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl) }
  }, [sourceUrl])

  const css = useMemo(() => filterStr(brightness, contrast, saturation), [brightness, contrast, saturation])
  const isIdentity = brightness === 100 && contrast === 100 && saturation === 100

  const handleReset = useCallback(() => {
    setBrightness(DEFAULT_BCS.brightness)
    setContrast(DEFAULT_BCS.contrast)
    setSaturation(DEFAULT_BCS.saturation)
    updateNodeData(id, { ...DEFAULT_BCS })
  }, [id, updateNodeData])

  // Bake current BCS settings into a new image, save as durable mediaId for downstream.
  const handleRun = useCallback(async () => {
    setError('')
    const src = sourceFileRef.current
    if (!src) { setError('Connect an image'); return }
    setRunning(true)
    try {
      const url = URL.createObjectURL(src)
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Failed to decode source image'))
        el.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context unavailable')
      ctx.filter = css
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Canvas toBlob returned null')
      const outFile = new File([blob], `colorcorrect_${Date.now()}.png`, { type: 'image/png' })
      const mid = generateMediaId()
      await saveMediaForProject(mid, outFile)
      updateNodeData(id, { mediaId: mid, brightness, contrast, saturation })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setRunning(false)
    }
  }, [id, css, brightness, contrast, saturation, updateNodeData])

  function persist(field: 'brightness' | 'contrast' | 'saturation', val: number) {
    updateNodeData(id, { [field]: val })
  }

  return (
    <NodeShell
      name="Color Correction"
      selected={selected}
      icon="🎨"
      inputSlots={[{ id: 'image-in', label: 'Image', type: 'image' }]}
      outputSlots={[{ id: 'image-out', label: 'Corrected', type: 'image' }]}
      onRun={handleRun}
      running={running}
    >
      <div className={styles.nodeContent}>
        <div className={styles.effectsPanel}>
          <SliderRow label="Bri" value={brightness} min={0} max={200}
            onChange={v => { setBrightness(v); persist('brightness', v) }} />
          <SliderRow label="Con" value={contrast} min={0} max={200}
            onChange={v => { setContrast(v); persist('contrast', v) }} />
          <SliderRow label="Sat" value={saturation} min={0} max={200}
            onChange={v => { setSaturation(v); persist('saturation', v) }} />
          {!isIdentity && (
            <div className={styles.effectRow}>
              <button className={styles.effectToggle} onClick={handleReset}>Reset</button>
            </div>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.previewArea}>
          {sourceUrl
            ? <img
                src={sourceUrl}
                alt="color-correction preview"
                className={styles.previewImg}
                style={{ filter: css, cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); openPreview(sourceUrl, 'image') }}
              />
            : <span className={styles.dropHint}>Connect an image</span>
          }
        </div>
      </div>
    </NodeShell>
  )
}

function SliderRow({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <div className={styles.effectRow}>
      <span className={styles.label} style={{ width: 28 }}>{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        className={styles.effectSlider}
        onChange={e => onChange(Number(e.target.value))}
        title={`${label}: ${value}%`}
      />
      <span className={styles.label} style={{ width: 36, textAlign: 'right' }}>{value}%</span>
    </div>
  )
}

export default memo(ColorCorrectionNode)
