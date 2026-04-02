/**
 * Manual Collage Editor — drag images into a grid, pan/crop each cell, export as PNG.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CollageEditor.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CollageImage {
  id: string
  url: string
  name: string
}

interface CollageEditorProps {
  images: CollageImage[]
  onClose: () => void
  onExport: (blob: Blob) => void
}

interface CellData {
  imageIdx: number
  panX: number
  panY: number
}

const ASPECT_RATIOS: Array<{ label: string; value: string; w: number; h: number }> = [
  { label: '1:1',  value: '1:1',  w: 1, h: 1 },
  { label: '4:3',  value: '4:3',  w: 4, h: 3 },
  { label: '3:4',  value: '3:4',  w: 3, h: 4 },
  { label: '16:9', value: '16:9', w: 16, h: 9 },
  { label: '9:16', value: '9:16', w: 9, h: 16 },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function CollageEditor({ images, onClose, onExport }: CollageEditorProps) {
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [columns, setColumns] = useState(2)
  const [rows, setRows] = useState(2)
  const [gap, setGap] = useState(4)
  const [cells, setCells] = useState<Map<string, CellData>>(new Map())
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Pan state (per cell, active while mouse is held)
  const panState = useRef<{
    cellKey: string
    startX: number
    startY: number
    startPanX: number
    startPanY: number
  } | null>(null)

  const ratioObj = ASPECT_RATIOS.find(r => r.value === aspectRatio) ?? ASPECT_RATIOS[0]
  const cssAspectRatio = `${ratioObj.w} / ${ratioObj.h}`

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Grid dimensions ────────────────────────────────────────────────────────

  function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val))
  }

  function changeColumns(delta: number) {
    const next = clamp(columns + delta, 1, 6)
    if (next === columns) return
    // Remove cells in removed columns
    if (next < columns) {
      setCells(prev => {
        const copy = new Map(prev)
        for (let r = 0; r < rows; r++) {
          for (let c = next; c < columns; c++) {
            copy.delete(`${r}-${c}`)
          }
        }
        return copy
      })
    }
    setColumns(next)
  }

  function changeRows(delta: number) {
    const next = clamp(rows + delta, 1, 6)
    if (next === rows) return
    if (next < rows) {
      setCells(prev => {
        const copy = new Map(prev)
        for (let r = next; r < rows; r++) {
          for (let c = 0; c < columns; c++) {
            copy.delete(`${r}-${c}`)
          }
        }
        return copy
      })
    }
    setRows(next)
  }

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, imageIdx: number) {
    e.dataTransfer.setData('text/plain', String(imageIdx))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleDragOver(e: React.DragEvent, cellKey: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverCell(cellKey)
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear when the drag actually leaves the cell element, not when it
    // moves over a child element (e.g. the "drop here" text or a placed image).
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as Element).contains(related)) return
    setDragOverCell(null)
  }

  function handleDrop(e: React.DragEvent, cellKey: string) {
    e.preventDefault()
    setDragOverCell(null)
    const raw = e.dataTransfer.getData('text/plain')
    const imageIdx = parseInt(raw, 10)
    if (isNaN(imageIdx) || imageIdx < 0 || imageIdx >= images.length) return
    setCells(prev => {
      const copy = new Map(prev)
      copy.set(cellKey, { imageIdx, panX: 0, panY: 0 })
      return copy
    })
  }

  function removeCell(cellKey: string) {
    setCells(prev => {
      const copy = new Map(prev)
      copy.delete(cellKey)
      return copy
    })
  }

  // ── Pan / Crop ──────────────────────────────────────────────────────────────

  function handlePanMouseDown(e: React.MouseEvent, cellKey: string) {
    e.preventDefault()
    const cell = cells.get(cellKey)
    if (!cell) return
    panState.current = {
      cellKey,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: cell.panX,
      startPanY: cell.panY,
    }
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!panState.current) return
      const { cellKey, startX, startY, startPanX, startPanY } = panState.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      setCells(prev => {
        const copy = new Map(prev)
        const cell = copy.get(cellKey)
        if (!cell) return prev
        copy.set(cellKey, { ...cell, panX: startPanX + dx, panY: startPanY + dy })
        return copy
      })
    }
    function onMouseUp() {
      panState.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // ── Reset ──────────────────────────────────────────────────────────────────

  function handleReset() {
    setCells(new Map())
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (cells.size === 0) return
    setExporting(true)

    try {
      const EXPORT_WIDTH = 2048
      const totalRatio = (ratioObj.w / ratioObj.h)
      const EXPORT_HEIGHT = Math.round(EXPORT_WIDTH / totalRatio)

      const canvas = document.createElement('canvas')
      canvas.width = EXPORT_WIDTH
      canvas.height = EXPORT_HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) { setExporting(false); return }

      // Background
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT)

      const cellW = (EXPORT_WIDTH - gap * (columns - 1)) / columns
      const cellH = (EXPORT_HEIGHT - gap * (rows - 1)) / rows

      // Helper: load image from url into HTMLImageElement
      function loadImg(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = url
        })
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const cellKey = `${r}-${c}`
          const cellData = cells.get(cellKey)
          if (!cellData) continue

          const imgMeta = images[cellData.imageIdx]
          if (!imgMeta) continue

          let img: HTMLImageElement
          try {
            img = await loadImg(imgMeta.url)
          } catch {
            continue
          }

          const destX = c * (cellW + gap)
          const destY = r * (cellH + gap)

          // Save & clip to cell
          ctx.save()
          ctx.beginPath()
          ctx.rect(destX, destY, cellW, cellH)
          ctx.clip()

          // Scale to cover the cell (object-fit: cover logic)
          const imgAspect = img.naturalWidth / img.naturalHeight
          const cellAspect = cellW / cellH

          let drawW: number, drawH: number
          if (imgAspect > cellAspect) {
            // image wider than cell — fit height
            drawH = cellH
            drawW = drawH * imgAspect
          } else {
            // image taller than cell — fit width
            drawW = cellW
            drawH = drawW / imgAspect
          }

          // Center + apply pan offset (pan is in screen pixels, scale to canvas)
          const basePanX = (cellW - drawW) / 2
          const basePanY = (cellH - drawH) / 2

          // Convert screen pan to canvas pan: scale by the ratio of export cell size
          // to drawn image size so that panning is proportional at export resolution.
          const panScaleX = drawW / cellW
          const panScaleY = drawH / cellH
          const panX = cellData.panX * panScaleX
          const panY = cellData.panY * panScaleY

          ctx.drawImage(
            img,
            destX + basePanX + panX,
            destY + basePanY + panY,
            drawW,
            drawH,
          )

          ctx.restore()
        }
      }

      canvas.toBlob(blob => {
        if (blob) onExport(blob)
        setExporting(false)
      }, 'image/png')
    } catch (err) {
      console.error('[CollageEditor] Export failed:', err)
      setExporting(false)
    }
  }, [cells, columns, rows, gap, images, ratioObj, onExport])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const placedIndices = new Set<number>()
  for (const cell of cells.values()) {
    placedIndices.add(cell.imageIdx)
  }

  const hasAnyCells = cells.size > 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>Manual Collage</span>
            <span className={styles.imageCount}>{images.length} image{images.length !== 1 ? 's' : ''}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">×</button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Left sidebar */}
          <div className={styles.sidebar}>
            <div className={styles.sidebarLabel}>Images</div>
            {images.map((img, idx) => {
              const placed = placedIndices.has(idx)
              return (
                <div
                  key={img.id}
                  className={`${styles.thumbWrapper} ${placed ? styles.thumbWrapperPlaced : ''}`}
                  draggable
                  onDragStart={e => handleDragStart(e, idx)}
                  title={img.name}
                >
                  <img src={img.url} alt={img.name} className={styles.thumbImg} />
                  <span className={styles.thumbIndex}>{idx + 1}</span>
                </div>
              )
            })}
          </div>

          {/* Center grid area */}
          <div className={styles.gridArea}>
            <div
              className={styles.grid}
              style={{
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
                gap: `${gap}px`,
                aspectRatio: cssAspectRatio,
                // Fit within available space
                maxWidth: '100%',
                maxHeight: '100%',
                width: ratioObj.w >= ratioObj.h ? 'min(100%, calc(100vh - 160px) * ' + (ratioObj.w / ratioObj.h) + ')' : 'auto',
                height: ratioObj.h > ratioObj.w ? 'calc(100% - 0px)' : 'auto',
              }}
            >
              {Array.from({ length: rows }, (_, r) =>
                Array.from({ length: columns }, (_, c) => {
                  const cellKey = `${r}-${c}`
                  const cellData = cells.get(cellKey)
                  const isDragOver = dragOverCell === cellKey

                  return (
                    <div
                      key={cellKey}
                      className={`${styles.cell} ${isDragOver ? styles.cellDragOver : ''}`}
                      onDragOver={e => handleDragOver(e, cellKey)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, cellKey)}
                    >
                      {cellData != null ? (
                        <div
                          className={styles.cellImgWrapper}
                          onMouseDown={e => handlePanMouseDown(e, cellKey)}
                        >
                          <img
                            className={styles.cellImg}
                            src={images[cellData.imageIdx]?.url}
                            alt=""
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              transform: `translate(${cellData.panX}px, ${cellData.panY}px)`,
                            }}
                            draggable={false}
                          />
                          <span className={styles.panTooltip}>PAN CROP</span>
                          <button
                            className={styles.cellRemoveBtn}
                            onClick={e => { e.stopPropagation(); removeCell(cellKey) }}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className={styles.cellEmpty}>drop here</div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className={styles.panel}>
            {/* Aspect ratio */}
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>Aspect Ratio</div>
              <div className={styles.pillGroup}>
                {ASPECT_RATIOS.map(ar => (
                  <button
                    key={ar.value}
                    className={`${styles.pill} ${aspectRatio === ar.value ? styles.pillActive : ''}`}
                    onClick={() => setAspectRatio(ar.value)}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid size */}
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>Grid Size</div>
              <div className={styles.sizeRow}>
                <span className={styles.sizeLabel}>Columns</span>
                <button
                  className={`${styles.sizeBtn} ${columns <= 1 ? styles.sizeBtnDisabled : ''}`}
                  onClick={() => changeColumns(-1)}
                  disabled={columns <= 1}
                >−</button>
                <span className={styles.sizeValue}>{columns}</span>
                <button
                  className={`${styles.sizeBtn} ${columns >= 6 ? styles.sizeBtnDisabled : ''}`}
                  onClick={() => changeColumns(1)}
                  disabled={columns >= 6}
                >+</button>
              </div>
              <div className={styles.sizeRow}>
                <span className={styles.sizeLabel}>Rows</span>
                <button
                  className={`${styles.sizeBtn} ${rows <= 1 ? styles.sizeBtnDisabled : ''}`}
                  onClick={() => changeRows(-1)}
                  disabled={rows <= 1}
                >−</button>
                <span className={styles.sizeValue}>{rows}</span>
                <button
                  className={`${styles.sizeBtn} ${rows >= 6 ? styles.sizeBtnDisabled : ''}`}
                  onClick={() => changeRows(1)}
                  disabled={rows >= 6}
                >+</button>
              </div>
            </div>

            {/* Gap */}
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>Gap</div>
              <div className={styles.sliderRow}>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={gap}
                  onChange={e => setGap(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderValue}>{gap}px</span>
              </div>
            </div>

            <div className={styles.panelSpacer} />

            {/* Reset */}
            <button className={styles.resetBtn} onClick={handleReset}>
              Reset cells
            </button>

            {/* Export */}
            <button
              className={`${styles.exportBtn} ${!hasAnyCells || exporting ? styles.exportBtnDisabled : ''}`}
              onClick={handleExport}
              disabled={!hasAnyCells || exporting}
            >
              {exporting ? 'Exporting…' : 'Export PNG'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
