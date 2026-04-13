import { useCallback, useRef } from 'react'

interface Props {
  on_ratio_change: (ratio: number) => void
}

export function SplitDivider({ on_ratio_change }: Props) {
  const dragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const parent = (e.currentTarget as HTMLElement).parentElement
    if (!parent) return

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const rect = parent.getBoundingClientRect()
      // Subtract the directory sidebar width (220px)
      const contentLeft = rect.left + 220
      const contentWidth = rect.width - 220
      const x = ev.clientX - contentLeft
      let ratio = x / contentWidth
      if (ratio < 0.3) ratio = 0.3
      if (ratio > 0.7) ratio = 0.7
      on_ratio_change(ratio)
    }

    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [on_ratio_change])

  return (
    <div className="rh-split-divider" onMouseDown={handleMouseDown}>
      <div className="rh-split-divider-grip" />
    </div>
  )
}
