import React from 'react'
import { type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { ASPECT_PRESETS, HANDLE_IDS } from '../../hooks/useCropOverlay'
import type { ImageUploadNodeData } from '../../types'
import { useImageUpload } from './useImageUpload'
import styles from '../_shared/Node.module.css'

type ImageUploadNodeType = Node<ImageUploadNodeData, 'imageUpload'>

const PRESETS: [number, number][] = [
  [2, 1], [2, 2], [2, 3], [3, 2], [3, 3], [4, 4],
]

function renderGridLines(cols: number, rows: number) {
  const lines: React.ReactNode[] = []
  for (let i = 1; i < cols; i++) {
    const pct = (i / cols) * 100
    lines.push(
      <div key={`v${i}`} style={{
        position: 'absolute', top: 0, left: `${pct}%`,
        width: '1px', height: '100%',
        background: 'rgba(255,255,255,0.4)', pointerEvents: 'none',
      }} />,
    )
  }
  for (let i = 1; i < rows; i++) {
    const pct = (i / rows) * 100
    lines.push(
      <div key={`h${i}`} style={{
        position: 'absolute', left: 0, top: `${pct}%`,
        height: '1px', width: '100%',
        background: 'rgba(255,255,255,0.4)', pointerEvents: 'none',
      }} />,
    )
  }
  return lines
}

function renderCropGridLines() {
  const lines: React.ReactNode[] = []
  for (let i = 1; i < 3; i++) {
    const pct = (i / 3) * 100
    lines.push(
      <div key={`cv${i}`} style={{
        position: 'absolute', top: 0, left: `${pct}%`,
        width: '1px', height: '100%',
        background: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
      }} />,
    )
    lines.push(
      <div key={`ch${i}`} style={{
        position: 'absolute', left: 0, top: `${pct}%`,
        height: '1px', width: '100%',
        background: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
      }} />,
    )
  }
  return lines
}

export function ImageUploadNode({ id, data, selected }: NodeProps<ImageUploadNodeType>) {
  const {
    preview, isProxy, dragging, inputRef, dragHandlers, onInputChange, openPicker,
    showCtxMenu, setShowCtxMenu, handlePreviewClick,
    handleCtxSplit, handleCtxCrop, handleCtxCopy,
    cropOverlay, splitOverlay,
  } = useImageUpload(id, data, selected)

  const {
    cropMode, setCropMode, cropRect, cropAspect, cropContainerRef,
    handlePos, onCropPointerDown, onCropPointerMove, onCropPointerUp,
    handleAspectSelect, handleCropReplace, handleCropAsNew, setCropAspect,
  } = cropOverlay

  const {
    splitMode, setSplitMode, splitCols, setSplitCols, splitRows, setSplitRows,
    executeSplit,
    handlePointerDown, handlePointerMove, handlePointerUp,
  } = splitOverlay

  function renderCropOverlay() {
    const { x, y, w, h } = cropRect
    return (
      <div className={styles.cropOverlay} onClick={e => e.stopPropagation()}>
        <div className={styles.cropHeader}>
          <div className={styles.cropActions}>
            <button className={styles.cropReplaceBtn} onClick={handleCropReplace}>Replace</button>
            <button className={styles.cropAsNewBtn} onClick={handleCropAsNew}>+ As New</button>
          </div>
          <button className={styles.cropCloseBtn}
            onClick={e => { e.stopPropagation(); setCropMode(false); setCropAspect(null) }}>&times;</button>
        </div>
        <div className={styles.cropPreviewWrap} ref={cropContainerRef}
          onPointerDown={onCropPointerDown} onPointerMove={onCropPointerMove} onPointerUp={onCropPointerUp}>
          <img src={preview!} alt="crop preview"
            style={{ width: '100%', display: 'block', userSelect: 'none', pointerEvents: 'none' }} draggable={false} />
          <div className={styles.cropRect} style={{
            left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`,
          }}>
            <div className={styles.cropGrid}>{renderCropGridLines()}</div>
          </div>
          {HANDLE_IDS.map(hid => {
            const pos = handlePos(hid, cropRect)
            return <div key={hid} className={styles.cropHandle} data-handle={hid}
              style={{ left: pos.left, top: pos.top }} />
          })}
        </div>
        <div className={styles.cropRatioBar}>
          {ASPECT_PRESETS.map(p => (
            <button key={p.label}
              className={`${styles.cropRatioBtn} ${cropAspect === p.value ? styles.cropRatioBtnActive : ''}`}
              onClick={e => { e.stopPropagation(); handleAspectSelect(p.value) }}>{p.label}</button>
          ))}
        </div>
      </div>
    )
  }

  function renderSplitOverlay() {
    return (
      <div className={styles.splitOverlay} onClick={e => e.stopPropagation()}>
        <div className={styles.splitHeader}>
          <span className={styles.splitBadge}>&#x25A6; Split</span>
          <button className={styles.splitClose}
            onClick={e => { e.stopPropagation(); setSplitMode(false) }}>&times;</button>
        </div>
        <div className={styles.splitPreviewWrap}>
          <img src={preview!} alt="split preview"
            style={{ width: '100%', display: 'block', userSelect: 'none', pointerEvents: 'none' }} draggable={false} />
          <div className={styles.splitGridLines}>{renderGridLines(splitCols, splitRows)}</div>
          <div className={styles.splitHandle}
            onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
            title="Drag to change grid size, click to split">{splitCols} &times; {splitRows}</div>
        </div>
        <div className={styles.splitPresets}>
          {PRESETS.map(([c, r]) => (
            <button key={`${c}x${r}`}
              className={`${styles.splitPresetBtn} ${c === splitCols && r === splitRows ? styles.splitPresetActive : ''}`}
              onClick={e => { e.stopPropagation(); executeSplit(c, r) }}>{c}&times;{r}</button>
          ))}
        </div>
      </div>
    )
  }

  function renderNormalView() {
    return (
      <div className={styles.previewArea}
        onClick={isProxy ? undefined : openPicker}
        {...(isProxy ? {} : dragHandlers)}
        style={{ position: 'relative', ...(dragging ? { borderColor: '#3b82f6' } : undefined) }}>
        {preview
          ? <img src={preview} alt={isProxy ? 'proxy preview' : 'uploaded'} className={styles.previewImg}
              onClick={handlePreviewClick} style={{ cursor: 'pointer' }} />
          : <span className={styles.dropHint}>{isProxy ? 'proxy: no upstream image' : 'Click or drag an image'}</span>}
        {isProxy && (
          <span style={{
            position: 'absolute', top: 4, left: 4, zIndex: 4,
            fontSize: 10, color: 'var(--text-dim)',
            background: 'rgba(0,0,0,0.5)', padding: '1px 5px', borderRadius: 2,
            pointerEvents: 'none', userSelect: 'none',
          }}>proxy</span>
        )}
        {preview && !isProxy && (
          <>
            <button className={styles.nodeContextBtn} title="Options"
              onClick={e => { e.stopPropagation(); e.preventDefault(); setShowCtxMenu(v => !v) }}>&#x22EE;</button>
            {showCtxMenu && (
              <div className={styles.nodeContextMenu} onPointerDown={e => e.stopPropagation()}>
                <button className={styles.nodeContextItem} onClick={handleCtxCrop}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x2702;</span>Crop</button>
                <button className={styles.nodeContextItem} onClick={handleCtxSplit}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x25A6;</span>Split</button>
                <button className={styles.nodeContextItem} onClick={handleCtxCopy}>
                  <span style={{ opacity: 0.6, marginRight: 6 }}>&#x2398;</span>Copy to clipboard</button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <NodeShell name="Image" selected={selected}
      inputSlots={[{ id: 'image-in', label: 'Image', type: 'image' }]}
      outputSlots={[{ id: 'image-out', label: 'Image', type: 'image' }]}>
      <div className={styles.nodeContent}>
        {!isProxy && cropMode && preview ? renderCropOverlay()
          : !isProxy && splitMode && preview ? renderSplitOverlay()
          : renderNormalView()}
        <input ref={inputRef} type="file" accept="image/*" className={styles.hidden}
          onChange={onInputChange} />
      </div>
    </NodeShell>
  )
}

export default ImageUploadNode
