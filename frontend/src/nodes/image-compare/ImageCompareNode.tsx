import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { pullMedia } from '../../hooks/useDataPropagation'
import styles from '../_shared/Node.module.css'

export function ImageCompareNode({ id, selected }: NodeProps) {
  const { getNodes, getEdges } = useReactFlow()

  const [imageA, setImageA] = useState<string | null>(null)
  const [imageB, setImageB] = useState<string | null>(null)
  const [sliderPos, setSliderPos] = useState(50) // 0-100
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      if (imageA?.startsWith('blob:')) URL.revokeObjectURL(imageA)
      if (imageB?.startsWith('blob:')) URL.revokeObjectURL(imageB)
    }
  }, [imageA, imageB])

  const run = useCallback(async () => {
    const { file: fileA } = await pullMedia(id, 'image-0', getNodes, getEdges)
    const { file: fileB } = await pullMedia(id, 'image-1', getNodes, getEdges)

    if (!fileA || !fileB) {
      setError('Connect both Image A and Image B')
      return
    }
    setError('')

    // Revoke old URLs
    if (imageA?.startsWith('blob:')) URL.revokeObjectURL(imageA)
    if (imageB?.startsWith('blob:')) URL.revokeObjectURL(imageB)

    setImageA(URL.createObjectURL(fileA))
    setImageB(URL.createObjectURL(fileB))
    setSliderPos(50)
  }, [id, getNodes, getEdges, imageA, imageB])

  const updateSlider = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPos(pct)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dragging.current = true
    containerRef.current?.setPointerCapture(e.pointerId)
    updateSlider(e.clientX)
  }, [updateSlider])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    e.stopPropagation()
    e.preventDefault()
    updateSlider(e.clientX)
  }, [updateSlider])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    dragging.current = false
  }, [])

  const hasImages = imageA && imageB

  return (
    <NodeShell
      name="Image Compare"
      icon="🔍"
      selected={selected}
      inputSlots={[
        { id: 'image-0', label: 'Image A', type: 'image', required: true },
        { id: 'image-1', label: 'Image B', type: 'image', required: true },
      ]}
      onRun={run}
    >
      <div className={styles.nodeContent}>
        {error && <p className={styles.error}>{error}</p>}

        {hasImages ? (
          <div
            ref={containerRef}
            className={styles.compareSliderWrap}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* Image A — full, background layer */}
            <img
              src={imageA}
              alt="A"
              className={styles.compareImg}
              draggable={false}
            />

            {/* Image B — clipped from the right */}
            <img
              src={imageB}
              alt="B"
              className={styles.compareImg}
              style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
              draggable={false}
            />

            {/* Slider line */}
            <div
              className={styles.compareSliderLine}
              style={{ left: `${sliderPos}%` }}
            />
          </div>
        ) : (
          <div className={styles.compareEmpty}>
            Connect two images and click ▶ Run
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default ImageCompareNode
