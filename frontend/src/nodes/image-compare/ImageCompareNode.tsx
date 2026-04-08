import { useCallback, useEffect, useState } from 'react'
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

  useEffect(() => {
    return () => {
      if (imageA?.startsWith('blob:')) URL.revokeObjectURL(imageA)
      if (imageB?.startsWith('blob:')) URL.revokeObjectURL(imageB)
    }
  }, [imageA, imageB])

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
          <CompareSlider imageA={imageA} imageB={imageB} labelA="A" labelB="B" />
        ) : (
          <div className={styles.compareEmpty}>Connect two images and click Run</div>
        )}
      </div>
    </NodeShell>
  )
}

export default ImageCompareNode
