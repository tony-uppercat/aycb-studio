import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { NodeShell } from '../_shared/NodeShell'
import type { GenerateImageBatchNodeData } from '../../types'
import { useGenerateImageBatch } from './useGenerateImageBatch'
import styles from '../_shared/Node.module.css'

type GenerateImageBatchNodeType = Node<GenerateImageBatchNodeData, 'generateImageBatch'>

// Batch node is ALWAYS Batch API — prices shown are already −50% (list × 0.5):
// Pro 0.134→0.067, NB2 0.067→0.034, Lite 0.034→0.017.
const MODELS = [
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', price: '$0.067 (batch)' },
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', price: '$0.034 (batch)' },
  { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', price: '$0.017 (batch)' },
]

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
const RESOLUTIONS = ['1K', '2K', '4K']

export function GenerateImageBatchNode({ id, data, selected }: NodeProps<GenerateImageBatchNodeType>) {
  const { setNodes } = useReactFlow()
  const h = useGenerateImageBatch(id, data, !!selected)

  const updateNodeData = (patch: Partial<GenerateImageBatchNodeData>) => {
    setNodes(nodes => nodes.map(n =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
    ))
  }

  return (
    <NodeShell
      name="Generate Image Batch"
      selected={selected}
      icon="≡"
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        { id: 'image-0', label: 'Ref 1', type: 'image' },
      ]}
      outputSlots={[{ id: 'image-out', label: 'Output', type: 'image' }]}
      onRun={h.addToBundle}
      running={h.submitting}
    >
      <div className={styles.nodeContent}>
        <select
          className={styles.select}
          value={data.selectedModel}
          onChange={e => {
            const m = e.target.value
            // NB2 Lite is 1K-only — reset a stale 2K/4K so submit can't 400.
            updateNodeData(m === 'gemini-3.1-flash-lite-image'
              ? { selectedModel: m, resolution: '1K' }
              : { selectedModel: m })
          }}
        >
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.name} ({m.price})</option>
          ))}
        </select>

        <div className={styles.arResRow}>
          <select
            className={styles.selectSmall}
            value={data.aspectRatio}
            onChange={e => updateNodeData({ aspectRatio: e.target.value })}
          >
            {ASPECT_RATIOS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            className={styles.selectSmall}
            value={data.resolution}
            onChange={e => updateNodeData({ resolution: e.target.value })}
          >
            {RESOLUTIONS
              // NB2 Lite is 1K-only — 2K/4K return "Image size not supported".
              .filter(r => data.selectedModel !== 'gemini-3.1-flash-lite-image' || r === '1K')
              .map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className={styles.arResRow}>
          <label className={styles.bundleLabel}>N
            <input
              type="number"
              min={1}
              max={100}
              className={styles.bundleInput}
              value={data.bundleN ?? 5}
              onChange={e => updateNodeData({ bundleN: parseInt(e.target.value) || 5 })}
              title="Auto-submit when pending count reaches N"
            />
          </label>
          <label className={styles.bundleLabel}>T
            <input
              type="number"
              min={5}
              max={600}
              className={styles.bundleInput}
              value={data.bundleT ?? 30}
              onChange={e => updateNodeData({ bundleT: parseInt(e.target.value) || 30 })}
              title="Auto-submit after T seconds idle"
            />s
          </label>
          <button
            className={styles.submitNowBtn}
            disabled={h.pending.length === 0 || h.submitting}
            onClick={() => void h.submitNow()}
            title="Submit pending bundle immediately"
          >Submit now ({h.pending.length})</button>
        </div>

        <textarea
          className={styles.promptTextarea}
          value={data.prompt}
          onChange={e => updateNodeData({ prompt: e.target.value })}
          placeholder="Write your prompt here..."
          rows={3}
          spellCheck={false}
        />

        {h.error && <p className={styles.error}>{h.error}</p>}

        {h.jobs.length > 0 && (
          <div className={styles.jobsList}>
            {h.jobs.map(j => (
              <div key={j.id} className={`${styles.jobPill} ${styles[`jobPill_${j.state}`] ?? ''}`}>
                <span className={styles.jobId}>{j.id.slice(0, 6)}</span>
                <span className={styles.jobMeta}>{j.requests.length} reqs</span>
                <span className={styles.jobState}>{j.state}</span>
                {j.state === 'running' && (
                  <button
                    className={styles.jobCancel}
                    onClick={() => void h.cancelJob(j.id)}
                    title="Cancel job"
                  ><X size={10} strokeWidth={1.5}/></button>
                )}
                {j.error && <span className={styles.jobError} title={j.error}>!</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(GenerateImageBatchNode)
