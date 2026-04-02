import { useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { addEdge } from '@xyflow/react'
import { saveMediaForProject, generateMediaId } from '../mediaStore'
import { splitImageToGrid } from '../utils/imageSplitGrid'
import { getNextNodeId } from './useCanvasDragDrop'
import { edgeStyle } from '../utils/edgeStyles'
import { CANVAS_EVENTS } from '../events/canvasEvents'

interface UseCanvasCustomEventsParams {
  getNodes: () => Node[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setExportStatus: (status: string) => void
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }
  canvasRef: React.RefObject<HTMLDivElement | null>
}

export function useCanvasCustomEvents({
  getNodes, setNodes, setEdges, setExportStatus, screenToFlowPosition, canvasRef,
}: UseCanvasCustomEventsParams) {

  // ── image-split-grid ──
  useEffect(() => {
    function onSplitGrid(e: Event) {
      const { nodeId, cols, rows, file } = (e as CustomEvent).detail as {
        nodeId: string; cols: number; rows: number; file: File
      }

      const sourceNode = getNodes().find(n => n.id === nodeId)
      if (!sourceNode || !file) return

      setExportStatus(`Splitting ${cols}×${rows}...`)

      void (async () => {
        try {
          const tiles = await splitImageToGrid(file, cols, rows)

          const startX = sourceNode.position.x + 300
          const gridHeight = rows * 220
          const sourceHeight = sourceNode.measured?.height ?? sourceNode.height ?? 150
          const startY = sourceNode.position.y + (sourceHeight - gridHeight) / 2

          const newNodes: Node[] = []
          const newEdges: Edge[] = []
          for (let i = 0; i < tiles.length; i++) {
            const tileFile = tiles[i]
            const col = i % cols
            const row = Math.floor(i / cols)

            const mediaId = generateMediaId()
            await saveMediaForProject(mediaId, tileFile)

            const tileId = getNextNodeId('split')
            newNodes.push({
              id: tileId,
              type: 'imageUpload',
              position: {
                x: startX + col * 240,
                y: startY + row * 220,
              },
              data: { mediaId },
            })

            newEdges.push({
              id: `e-${nodeId}-${tileId}`,
              source: nodeId,
              sourceHandle: 'image-out',
              target: tileId,
              style: edgeStyle('image-out'),
            })
          }

          setNodes(ns => [...ns, ...newNodes])
          setEdges(eds => {
            let result = eds
            newEdges.forEach(edge => { result = addEdge(edge, result) })
            return result
          })

          setExportStatus(`${tiles.length} cells`)
          setTimeout(() => setExportStatus(''), 3000)
        } catch (err) {
          setExportStatus('')
          console.error('Split grid failed:', err)
        }
      })()
    }

    window.addEventListener(CANVAS_EVENTS.IMAGE_SPLIT_GRID, onSplitGrid)
    return () => window.removeEventListener(CANVAS_EVENTS.IMAGE_SPLIT_GRID, onSplitGrid)
  }, [getNodes, setNodes, setEdges, setExportStatus])

  // ── image-crop-as-new ──
  useEffect(() => {
    async function onCropAsNew(e: Event) {
      const { sourceNodeId, file } = (e as CustomEvent).detail as {
        sourceNodeId: string; file: File
      }
      const sourceNode = getNodes().find(n => n.id === sourceNodeId)
      if (!sourceNode || !file) return

      const mediaId = generateMediaId()
      await saveMediaForProject(mediaId, file)

      const newId = getNextNodeId('imageUpload')
      const w = sourceNode.measured?.width ?? sourceNode.width ?? 200
      const newNode: Node = {
        id: newId,
        type: 'imageUpload',
        position: {
          x: sourceNode.position.x + (w as number) + 30,
          y: sourceNode.position.y,
        },
        data: { mediaId },
      }

      setNodes(ns => [...ns, newNode])
    }

    window.addEventListener(CANVAS_EVENTS.IMAGE_CROP_AS_NEW, onCropAsNew)
    return () => window.removeEventListener(CANVAS_EVENTS.IMAGE_CROP_AS_NEW, onCropAsNew)
  }, [getNodes, setNodes])

  // ── batch-export-images ──
  useEffect(() => {
    async function onBatchExport(e: Event) {
      const { sourceNodeId, files } = (e as CustomEvent).detail as {
        sourceNodeId: string
        files: Array<{ file: File; mediaId?: string }>
      }
      const sourceNode = getNodes().find(n => n.id === sourceNodeId)
      if (!sourceNode || !files.length) return

      const NODE_HEIGHT = 220
      const PADDING = 30
      const startX = sourceNode.position.x + (sourceNode.measured?.width ?? 280) + 60
      const startY = sourceNode.position.y

      const newNodes: Node[] = []
      for (let i = 0; i < files.length; i++) {
        const { file, mediaId: existingMediaId } = files[i]
        const mediaId = existingMediaId ?? generateMediaId()
        if (!existingMediaId) await saveMediaForProject(mediaId, file)

        newNodes.push({
          id: getNextNodeId('imageUpload'),
          type: 'imageUpload',
          position: {
            x: startX,
            y: startY + i * (NODE_HEIGHT + PADDING),
          },
          data: { mediaId },
        })
      }

      setNodes(ns => [...ns, ...newNodes])
    }

    window.addEventListener(CANVAS_EVENTS.BATCH_EXPORT_IMAGES, onBatchExport)
    return () => window.removeEventListener(CANVAS_EVENTS.BATCH_EXPORT_IMAGES, onBatchExport)
  }, [getNodes, setNodes])

  // ── media-import-to-project ──
  useEffect(() => {
    async function onImport(e: Event) {
      const { filename, url, type } = (e as CustomEvent).detail as {
        filename: string; url: string; type: string; project: string
      }
      if (!type.startsWith('image/')) return

      try {
        const resp = await fetch(url)
        if (!resp.ok) return
        const blob = await resp.blob()
        const file = new File([blob], filename, { type })
        const mediaId = generateMediaId()
        await saveMediaForProject(mediaId, file)

        const rect = canvasRef.current?.getBoundingClientRect()
        const screenCX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
        const screenCY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
        const center = screenToFlowPosition({ x: screenCX, y: screenCY })

        const newNode: Node = {
          id: getNextNodeId('imageUpload'),
          type: 'imageUpload',
          position: { x: center.x - 100, y: center.y - 100 },
          data: { mediaId },
        }
        setNodes(ns => [...ns, newNode])
      } catch (err) {
        console.error('[FlowCanvas] media-import-to-project failed:', err)
      }
    }

    window.addEventListener(CANVAS_EVENTS.MEDIA_IMPORT_TO_PROJECT, onImport)
    return () => window.removeEventListener(CANVAS_EVENTS.MEDIA_IMPORT_TO_PROJECT, onImport)
  }, [screenToFlowPosition, setNodes, canvasRef])
}
