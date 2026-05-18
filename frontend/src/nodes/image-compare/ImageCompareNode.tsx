import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { CompareSlider } from '../_shared/CompareSlider'
import { pullMedia } from '../../hooks/useDataPropagation'
import styles from '../_shared/Node.module.css'

export function ImageCompareNode({ id, selected }: NodeProps) {
  const { getNodes, getEdges } = useReactFlow()

  const [imageA, setImageA] = useState<string | null>(null)
  const [imageB, setImageB] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    return () => {
      if (imageA?.startsWith('blob:')) URL.revokeObjectURL(imageA)
      if (imageB?.startsWith('blob:')) URL.revokeObjectURL(imageB)
    }
  }, [imageA, imageB])

  useEffect(() => {
    if (!fullscreen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFullscreen(false) }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [fullscreen])

  const run = useCallback(async () => {
    const { file: fileA } = await pullMedia(id, 'image-0', getNodes, getEdges)
    const { file: fileB } = await pullMedia(id, 'image-1', getNodes, getEdges)
    if (!fileA || !fileB) { setError('Connect both Image A and Image B'); return }
    setError('')
    if (imageA?.startsWith('blob:')) URL.revokeObjectURL(imageA)
    if (imageB?.startsWith('blob:')) URL.revokeObjectURL(imageB)
    setImageA(URL.createObjectURL(fileA))
    setImageB(URL.createObjectURL(fileB))
  }, [id, getNodes, getEdges, imageA, imageB])

  return (
    <>
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
          {imageA && imageB ? (
            <div className={styles.compareWithFs}>
              <CompareSlider imageA={imageA} imageB={imageB} labelA="A" labelB="B" />
              <button
                className={styles.compareFsBtn}
                onClick={(e) => { e.stopPropagation(); setFullscreen(true) }}
                title="Fullscreen"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            </div>
          ) : (
            <div className={styles.compareEmpty}>Connect two images and click Run</div>
          )}
        </div>
      </NodeShell>
      {fullscreen && imageA && imageB && createPortal(
        <div className={styles.compareFsRoot}>
          <div className={styles.compareFsStage}>
            <CompareSlider imageA={imageA} imageB={imageB} labelA="A" labelB="B" fillContainer />
          </div>
          <button
            className={styles.compareFsClose}
            onClick={() => setFullscreen(false)}
            title="Close (Esc)"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

export default ImageCompareNode
