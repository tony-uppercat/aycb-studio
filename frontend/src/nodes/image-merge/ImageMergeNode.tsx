import { type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useImageMerge, type ImageMergeNodeData, type LayoutMode } from './useImageMerge'
import styles from './ImageMergeNode.module.css'

type ImageMergeNodeType = Node<ImageMergeNodeData, 'imageMerge'>

export function ImageMergeNode({ id, data, selected }: NodeProps<ImageMergeNodeType>) {
  const {
    imageSlots,
    connectedImageCount,
    layout, setLayout,
    columns, setColumns,
    gap, setGap,
    bgColor, setBgColor,
    outputMode, setOutputMode,
    customW, setCustomW,
    customH, setCustomH,
    lockAspect, setLockAspect,
    aspectRatioRef,
    previewUrl,
    loading,
    error,
    run,
    openPreview,
    updateNodeData,
  } = useImageMerge(id, data)

  return (
    <NodeShell
      name="Image Merge"
      selected={selected}
      icon="&#x1F4CE;"
      inputSlots={imageSlots}
      outputSlots={[
        { id: 'image-out', label: 'Image', type: 'image' },
      ]}
      onRun={run}
      running={loading}
    >
      <div className={styles.nodeContent}>
        {/* Layout mode */}
        <div className={styles.controlRow}>
          <span className={styles.label}>Layout</span>
          <select
            className={styles.select}
            value={layout}
            onChange={e => { setLayout(e.target.value as LayoutMode); updateNodeData(id, { layout: e.target.value }) }}
          >
            <option value="grid">Grid (Auto)</option>
            <option value="horizontal">Horizontal Strip</option>
            <option value="vertical">Vertical Strip</option>
          </select>
        </div>

        {/* Columns (grid mode only) */}
        {layout === 'grid' && (
          <div className={styles.controlRow}>
            <span className={styles.label}>Cols</span>
            <select
              className={styles.select}
              value={columns}
              onChange={e => { const v = Number(e.target.value); setColumns(v); updateNodeData(id, { columns: v }) }}
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </div>
        )}

        {/* Gap slider */}
        <div className={styles.sliderRow}>
          <span className={styles.label}>Gap</span>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={20}
            value={gap}
            onChange={e => { const v = Number(e.target.value); setGap(v); updateNodeData(id, { gap: v }) }}
          />
          <span className={styles.sliderValue}>{gap}px</span>
        </div>

        {/* Background color */}
        <div className={styles.controlRow}>
          <span className={styles.label}>BG</span>
          <select
            className={styles.select}
            value={bgColor}
            onChange={e => { setBgColor(e.target.value); updateNodeData(id, { bgColor: e.target.value }) }}
          >
            <option value="black">Black</option>
            <option value="white">White</option>
            <option value="transparent">Transparent</option>
          </select>
        </div>

        {/* Output size */}
        <div className={styles.controlRow}>
          <span className={styles.label}>Size</span>
          <select
            className={styles.select}
            value={outputMode}
            onChange={e => { setOutputMode(e.target.value); updateNodeData(id, { outputMode: e.target.value }) }}
          >
            <option value="auto">Auto-fit</option>
            <option value="first">Match First Image</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Custom dimensions */}
        {outputMode === 'custom' && (
          <div className={styles.sizeRow}>
            <input
              type="number"
              className={styles.sizeInput}
              value={customW}
              min={64}
              max={8192}
              onChange={e => {
                const v = Math.max(64, Math.min(8192, Number(e.target.value) || 64))
                setCustomW(v)
                updateNodeData(id, { customW: v })
                if (lockAspect) {
                  const h = Math.round(v / aspectRatioRef.current)
                  setCustomH(h)
                  updateNodeData(id, { customH: h })
                }
              }}
            />
            <span className={styles.sizeX}>x</span>
            <input
              type="number"
              className={styles.sizeInput}
              value={customH}
              min={64}
              max={8192}
              onChange={e => {
                const v = Math.max(64, Math.min(8192, Number(e.target.value) || 64))
                setCustomH(v)
                updateNodeData(id, { customH: v })
                if (lockAspect) {
                  const w = Math.round(v * aspectRatioRef.current)
                  setCustomW(w)
                  updateNodeData(id, { customW: w })
                }
              }}
            />
            <button
              className={`${styles.lockBtn} ${lockAspect ? styles.lockBtnActive : ''}`}
              onClick={() => {
                const next = !lockAspect
                setLockAspect(next)
                updateNodeData(id, { lockAspect: next })
                if (next) aspectRatioRef.current = customW / customH
              }}
              title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            >
              {lockAspect ? '\u{1F512}' : '\u{1F513}'}
            </button>
          </div>
        )}

        {/* Connected images count */}
        <div className={styles.inputCount}>
          {connectedImageCount} image{connectedImageCount !== 1 ? 's' : ''} connected
        </div>

        {/* Error */}
        {error && <p className={styles.error}>{error}</p>}

        {/* Preview */}
        <div className={styles.previewArea}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="collage"
              className={styles.previewImg}
              onClick={e => { e.stopPropagation(); openPreview(previewUrl, 'image', { mediaId: data.mediaId as string | undefined }) }}
            />
          ) : (
            <span className={styles.dropHint}>
              {connectedImageCount >= 2 ? 'Ready -- click Run' : 'Connect 2+ images'}
            </span>
          )}
        </div>
      </div>
    </NodeShell>
  )
}

export default ImageMergeNode
