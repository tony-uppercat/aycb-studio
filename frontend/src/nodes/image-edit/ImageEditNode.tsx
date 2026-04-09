import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useImageEdit, EDIT_MODES, MASK_MODES } from './useImageEdit'
import styles from '../_shared/Node.module.css'

export function ImageEditNode({ id, data, selected }: NodeProps) {
  const h = useImageEdit(id, data as Record<string, unknown>)

  return (
    <NodeShell
      name="Image Edit"
      selected={selected}
      icon="🖌"
      inputSlots={[
        { id: 'image-in', label: 'Image', type: 'image' },
        ...h.subjectSlots,
      ]}
      outputSlots={[
        { id: 'image-out', label: 'Image', type: 'image' },
      ]}
      onRun={h.run}
      running={h.loading}
      lastCost={h.lastCost}
      estimatedCost="~$0.02"
    >
      <div className={styles.nodeContent}>
        <select
          className={styles.select}
          value={h.editMode}
          onChange={e => { h.setEditMode(e.target.value); h.updateNodeData(id, { edit_mode: e.target.value }) }}
          title="Edit Mode"
        >
          {EDIT_MODES.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        {h.needsMask && (
          <div className={styles.arResRow}>
            <select
              className={styles.selectSmall}
              value={h.maskMode}
              onChange={e => { h.setMaskMode(e.target.value); h.updateNodeData(id, { mask_mode: e.target.value }) }}
              title="Mask Mode"
            >
              {MASK_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              className={styles.selectSmall}
              type="number"
              min={0} max={0.1} step={0.005}
              value={h.maskDilation}
              onChange={e => { const v = parseFloat(e.target.value) || 0.01; h.setMaskDilation(v); h.updateNodeData(id, { mask_dilation: v }) }}
              title="Mask Dilation"
              style={{ width: 60 }}
            />
          </div>
        )}

        <div className={styles.batchToggle}>
          {[1, 2, 4].map(n => (
            <button key={n}
              className={`${styles.batchBtn} ${h.numberOfImages === n ? styles.batchBtnActive : ''}`}
              onClick={() => { h.setNumberOfImages(n); h.updateNodeData(id, { number_of_images: n }) }}
              title={n === 1 ? 'Single result' : `Generate ${n} variants`}
            >{'\u00d7'}{n}</button>
          ))}
        </div>

        <textarea
          className={styles.promptTextarea}
          value={h.localPrompt}
          onChange={e => { h.setLocalPrompt(e.target.value); h.updateNodeData(id, { prompt: e.target.value }) }}
          placeholder="Describe the edit..."
          rows={3}
          spellCheck={false}
        />

        {h.error && <p className={styles.error}>{h.error}</p>}

        <div className={styles.previewArea}>
          {h.resultB64
            ? <img src={`data:image/png;base64,${h.resultB64}`} alt="edited" className={styles.previewImg} />
            : <span className={styles.dropHint}>
                {h.hasImageEdge ? 'Ready \u2014 click Run' : 'Connect an image to edit'}
              </span>
          }
        </div>
      </div>
    </NodeShell>
  )
}

export default memo(ImageEditNode)
