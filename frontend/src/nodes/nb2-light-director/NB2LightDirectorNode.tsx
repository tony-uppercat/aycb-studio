import { memo, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { Maximize2 } from 'lucide-react'
import { NodeShell } from '../_shared/NodeShell'
import { NB2Editor } from './editor/NB2Editor'
import type { NB2LightDirectorNodeData } from './types'
import { shotType } from './prompt-utils'
import { AR_PRESETS, CINEMA_LENSES } from './constants'
import styles from '../_shared/Node.module.css'
import nodeStyles from './NB2LightDirectorNode.module.css'

export function NB2LightDirectorNode({ id, data, selected }: NodeProps) {
  const d = data as NB2LightDirectorNodeData
  const { updateNodeData } = useReactFlow()
  const [editorOpen, setEditorOpen] = useState(false)
  const prevCapturedRef = useRef<string | null>(null)
  const glbFileRef = useRef<File | null>(null)

  const prompt = d.prompt || 'No lighting setup yet'

  const onEditorUpdate = useCallback((newPrompt: string, config: string, captured: string | null) => {
    updateNodeData(id, {
      prompt: newPrompt,
      sceneConfig: config,
      capturedImage: captured,
      outputPins: { 'text-config': config },
    })
    if (captured !== prevCapturedRef.current) {
      prevCapturedRef.current = captured
      if (captured) {
        fetch(captured).then(r => r.blob()).then(blob => {
          updateNodeData(id, { imageFile: new File([blob], 'nb2-light-ref.png', { type: 'image/png' }) })
        })
      } else {
        updateNodeData(id, { imageFile: null })
      }
    }
  }, [id, updateNodeData])

  const onPreview = useCallback((dataUrl: string) => {
    updateNodeData(id, { previewImage: dataUrl })
  }, [id, updateNodeData])

  // Parse config for badges + camera info
  let lightCount = 0
  let mode = 'TEXT'
  let focalLen = 50
  let aperture = 2.0
  let curShot = ''
  let arLabel = ''
  let glassName = ''
  try {
    if (d.sceneConfig) {
      const cfg = JSON.parse(d.sceneConfig)
      lightCount = cfg.lights?.filter((l: { on: boolean }) => l.on).length ?? 0
      mode = cfg.mode === '3d_ref' ? '3D REF' : 'TEXT'
      focalLen = cfg.lens?.focal ?? 50
      aperture = cfg.lens?.aperture ?? 2.0
      curShot = shotType(cfg.camera?.dist ?? 8, focalLen)
      if (cfg.frameAR) {
        const ar = AR_PRESETS.find(a => a.id === cfg.frameAR)
        if (ar) arLabel = ar.label
      }
      if (cfg.lens?.glass) {
        const found = CINEMA_LENSES.find(l => l.id === cfg.lens.glass)
        if (found) glassName = found.name
      }
    }
  } catch { /* invalid config */ }

  return (
    <>
      <NodeShell
        name="NB2 Light Director"
        selected={selected}
        icon="💡"
        inputSlots={[
          { id: 'image-subject', label: 'Subject Image', type: 'image' },
          { id: 'text-preset', label: 'Preset', type: 'text' },
        ]}
        outputSlots={[
          { id: 'prompt-out', label: 'NB2 Prompt', type: 'prompt' },
          { id: 'image-ref', label: 'Reference Image', type: 'image' },
          { id: 'text-config', label: 'Scene Config', type: 'text' },
        ]}
      >
        <div className={styles.nodeContent}>
          {/* Badges */}
          <div className={nodeStyles.badges}>
            <span className={nodeStyles.badge}>{lightCount} lights</span>
            <span className={nodeStyles.badge}>{mode}</span>
            {curShot && <span className={nodeStyles.badge}>{curShot}</span>}
          </div>

          {/* Scene preview with baked gate overlay */}
          {d.previewImage ? (
            <div className={nodeStyles.preview}>
              <img src={d.previewImage} className={nodeStyles.previewImg} alt="Scene" />
              <div className={nodeStyles.previewHud}>
                <span>{focalLen}mm f/{aperture}</span>
                <span>{glassName}</span>
              </div>
              {arLabel && <div className={nodeStyles.previewAr}>{arLabel}</div>}
            </div>
          ) : d.capturedImage ? (
            <div className={nodeStyles.thumbWrap}>
              <img src={d.capturedImage} className={nodeStyles.thumb} alt="3D reference" />
            </div>
          ) : (
            <div className={nodeStyles.promptPreview}>
              {prompt.slice(0, 150)}{prompt.length > 150 ? '...' : ''}
            </div>
          )}

          {/* Edit button */}
          <button
            className={nodeStyles.editBtn}
            onClick={() => setEditorOpen(true)}
          >
            <Maximize2 size={12} strokeWidth={1.5} />
            Edit Lighting
          </button>
        </div>
      </NodeShell>

      {/* Fullscreen editor — portal to body to escape ReactFlow transform */}
      {editorOpen && createPortal(
        <NB2Editor
          initialConfig={d.sceneConfig}
          initialCapturedImage={d.capturedImage}
          initialGlbFile={glbFileRef.current}
          onClose={() => setEditorOpen(false)}
          onUpdate={onEditorUpdate}
          onPreview={onPreview}
          onGlbFile={f => { glbFileRef.current = f }}
        />,
        document.body,
      )}
    </>
  )
}

export default memo(NB2LightDirectorNode)
