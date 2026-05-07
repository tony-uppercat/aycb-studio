import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'
import { pullAllMedia } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { fileToImage, renderImageMerge, type LayoutMode } from '../../utils/imageMergeRender'

const MAX_INPUTS = 8

export type { LayoutMode }

export interface ImageMergeNodeData extends Record<string, unknown> {
  mediaId?: string
  layout?: string
  columns?: number
  gap?: number
  bgColor?: string
  outputMode?: string
  customW?: number
  customH?: number
  lockAspect?: boolean
  _stop?: boolean
}

export function useImageMerge(id: string, data: ImageMergeNodeData) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { openPreview } = useMediaPreview()

  // Dynamic image input pins
  const connectedImageCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('image-')).length
  )
  const imageCount = Math.min(Math.max(connectedImageCount, 2), MAX_INPUTS)
  const imageSlots: SlotDef[] = Array.from({ length: imageCount }, (_, i) => ({
    id: `image-${i}`,
    label: `Image ${i + 1}`,
    type: 'image' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [imageCount, id, updateNodeInternals])

  // Node state
  const [layout, setLayout] = useState<LayoutMode>((data.layout as LayoutMode) ?? 'grid')
  const [columns, setColumns] = useState(data.columns ?? 2)
  const [gap, setGap] = useState(data.gap ?? 4)
  const [bgColor, setBgColor] = useState(data.bgColor ?? 'black')
  const [outputMode, setOutputMode] = useState(data.outputMode ?? 'auto')
  const [customW, setCustomW] = useState(data.customW ?? 1024)
  const [customH, setCustomH] = useState(data.customH ?? 1024)
  const [lockAspect, setLockAspect] = useState(data.lockAspect ?? false)
  const aspectRatioRef = useRef(customW / customH)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  const prevUrlRef = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
    }
  }, [])

  // Run handler
  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const files = await pullAllMedia(id, 'image-', getNodes, getEdges)
      if (files.length < 2) {
        setError('Connect at least 2 images')
        setLoading(false)
        return
      }

      const images = await Promise.all(files.map(f => fileToImage(f)))
      const blob = await renderImageMerge(images, {
        layout, columns, gap, bgColor, outputMode, customW, customH,
      })

      const file = new File([blob], `collage_${Date.now()}.png`, { type: 'image/png' })
      const mediaId = generateMediaId()
      await saveMediaForProject(mediaId, file)
      updateNodeData(id, { mediaId })

      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
      const url = URL.createObjectURL(blob)
      prevUrlRef.current = url
      setPreviewUrl(url)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
    }
  }, [id, getNodes, getEdges, updateNodeData, layout, columns, gap, bgColor, outputMode, customW, customH])

  return {
    // Dynamic slots
    imageSlots,
    connectedImageCount,
    // State
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
    // Actions
    run,
    openPreview,
    updateNodeData,
  }
}
