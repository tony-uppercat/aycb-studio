import { useCallback, useRef, useState } from 'react'
import styles from './Node.module.css'

interface Props {
  imageA: string
  imageB: string
  labelA?: string
  labelB?: string
  /** When true, wrap fills its parent (height: 100%) instead of growing to image height. */
  fillContainer?: boolean
}

export function CompareSlider({ imageA, imageB, labelA, labelB, fillContainer }: Props) {
  const [sliderPos, setSliderPos] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const updateSlider = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
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

  return (
    <div
      ref={containerRef}
      className={`${styles.compareSliderWrap} ${fillContainer ? styles.compareSliderFill : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img src={imageA} alt={labelA ?? 'A'} className={styles.compareImg} draggable={false} />
      <img
        src={imageB}
        alt={labelB ?? 'B'}
        className={styles.compareImg}
        style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
        draggable={false}
      />
      <div className={styles.compareSliderLine} style={{ left: `${sliderPos}%` }} />
    </div>
  )
}
