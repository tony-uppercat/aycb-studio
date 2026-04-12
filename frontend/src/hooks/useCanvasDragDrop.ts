import { useCallback, useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'

import { saveMediaForProject, generateMediaId } from '../mediaStore'
import { importProject } from '../utils/projectIO'
import { readPngTextChunks } from '../utils/pngMeta'
import { saveMediaMeta } from '../utils/reviewStatus'

export function getNextNodeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

interface UseCanvasDragDropResult {
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
}

/**
 * Check if the drop target is inside a React Flow node (which handles its own drops).
 * This prevents the canvas-level handler from creating duplicate nodes when
 * a node-level handler (e.g. ImageUploadNode) already processed the drop.
 */
function isDropOnExistingNode(event: React.DragEvent): boolean {
  let el: HTMLElement | null = event.target as HTMLElement
  while (el) {
    if (el.classList?.contains('react-flow__node')) return true
    // Also check for data attribute used by React Flow nodes
    if (el.hasAttribute?.('data-id') && el.closest?.('.react-flow__node')) return true
    el = el.parentElement
  }
  return false
}

export function useCanvasDragDrop(): UseCanvasDragDropResult {
  const { screenToFlowPosition, addNodes, addEdges, setNodes, setEdges, setViewport } = useReactFlow()

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    // Use 'copy' for media browser drags, 'move' for external file drags
    const hasMediaData = event.dataTransfer.types.includes('application/x-aycb-media')
    event.dataTransfer.dropEffect = hasMediaData ? 'copy' : 'move'
  }, [])

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()

    // Bug fix #1: If the drop landed on an existing node, the node's own
    // drop handler (useFileDrop) has already processed it. Don't create a
    // duplicate node from the canvas level.
    if (isDropOnExistingNode(event)) return

    // ── Media browser drag: mediaId passed via dataTransfer ──
    const mediaIdData = event.dataTransfer.getData('application/x-aycb-media')
    if (mediaIdData) {
      try {
        const items: Array<{ mediaId: string; type: string; name: string }> = JSON.parse(mediaIdData)
        const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const SPACING_X = 240
        const SPACING_Y = 220
        const COLS = 4

        items.forEach((item, i) => {
          const col = i % COLS
          const row = Math.floor(i / COLS)
          const position = { x: origin.x + col * SPACING_X, y: origin.y + row * SPACING_Y }
          const nodeId = getNextNodeId('media')

          if (item.type.startsWith('image/')) {
            addNodes({ id: nodeId, type: 'imageUpload', position, data: { mediaId: item.mediaId } })
          } else if (item.type.startsWith('video/')) {
            addNodes({ id: nodeId, type: 'videoUpload', position, data: { mediaId: item.mediaId } })
          }
        })
      } catch (err) {
        console.error('[AYCB] Media browser drag parse error:', err)
      }
      return
    }

    const files = event.dataTransfer.files
    if (!files || files.length === 0) {
      // Bug fix #4: When dragging from browser download bar, files may be empty
      // due to browser security restrictions. Log info for debugging.
      const types = event.dataTransfer.types
      if (types.length > 0) {
        console.warn(
          '[AYCB] Drop detected but no files available. dataTransfer types:',
          Array.from(types),
          '— This can happen when dragging from the browser downloads bar.',
          'Try dragging from a file explorer window instead, or use the file picker button.'
        )
      }
      return
    }

    // JSON project file → import entire project
    const firstFile = files[0]
    if (firstFile.name.endsWith('.json') || firstFile.type === 'application/json') {
      importProject(firstFile).then(result => {
        setNodes(result.nodes)
        setEdges(result.edges)
        if (result.viewport) setViewport(result.viewport)
        console.log(`[AYCB] Project imported: ${result.nodes.length} nodes, ${result.mediaCount} media files`)
      }).catch(err => {
        console.error('[AYCB] Project import failed:', err)
        alert('Import failed: ' + (err instanceof Error ? err.message : String(err)))
      })
      return
    }

    const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const SPACING_X = 240
    const SPACING_Y = 220
    const COLS = 4

    Array.from(files).forEach((file, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const position = { x: origin.x + col * SPACING_X, y: origin.y + row * SPACING_Y }
      const nodeId = getNextNodeId('auto')
      const mediaId = generateMediaId()

      if (file.type.startsWith('image/')) {
        saveMediaForProject(mediaId, file).catch(console.error)
        if (file.type === 'image/png' || file.name.endsWith('.png')) {
          readPngTextChunks(file).then(chunks => {
            if (Object.keys(chunks).length > 0) saveMediaMeta(mediaId, chunks)
          }).catch(() => {})
        }
        addNodes({ id: nodeId, type: 'imageUpload', position, data: { mediaId } })
      } else if (file.type.startsWith('video/')) {
        saveMediaForProject(mediaId, file).catch(console.error)
        addNodes({ id: nodeId, type: 'videoUpload', position, data: { mediaId } })
      } else if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        void file.text().then(text => {
          addNodes({ id: nodeId, type: 'textInput', position, data: { outputText: text } })
        })
      }
    })
  }, [screenToFlowPosition, addNodes, setNodes, setEdges, setViewport])

  // Global drop handler for JSON project files (catches drops anywhere on the page)
  useEffect(() => {
    function onWindowDrop(e: DragEvent) {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file.name.endsWith('.json') && file.type !== 'application/json') return
      e.preventDefault()
      e.stopPropagation()
      importProject(file).then(result => {
        setNodes(result.nodes)
        setEdges(result.edges)
        if (result.viewport) setViewport(result.viewport)
        console.log(`[AYCB] Project imported: ${result.nodes.length} nodes, ${result.mediaCount} media files`)
      }).catch(err => {
        console.error('[AYCB] Project import failed:', err)
        alert('Import failed: ' + (err instanceof Error ? err.message : String(err)))
      })
    }
    function onWindowDragOver(e: DragEvent) {
      // Allow drop
      e.preventDefault()
    }
    window.addEventListener('drop', onWindowDrop)
    window.addEventListener('dragover', onWindowDragOver)
    return () => {
      window.removeEventListener('drop', onWindowDrop)
      window.removeEventListener('dragover', onWindowDragOver)
    }
  }, [setNodes, setEdges, setViewport])

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const text = e.clipboardData?.getData('text/plain')
      if (text?.trim()) {
        e.preventDefault()
        const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        // Detect JSON objects/arrays → create JsonParser instead of TextInput
        const trimmed = text.trim()
        let isJson = false
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try { const parsed = JSON.parse(trimmed); isJson = typeof parsed === 'object' && parsed !== null } catch { /* not json */ }
        }
        if (isJson) {
          const textId = getNextNodeId('paste')
          const parserId = getNextNodeId('jsonParser')
          addNodes([
            { id: textId, type: 'textInput', position: pos, data: { outputText: trimmed } },
            { id: parserId, type: 'jsonParser', position: { x: pos.x + 320, y: pos.y }, data: { text: trimmed, jsonPath: '' } },
          ])
          addEdges({ id: `${textId}-${parserId}`, source: textId, sourceHandle: 'text-out', target: parserId, targetHandle: 'text-in' })
        } else {
          addNodes({ id: getNextNodeId('paste'), type: 'textInput', position: pos, data: { outputText: trimmed } })
        }
        return
      }

      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) return
          const nodeId = getNextNodeId('paste')
          const mediaId = generateMediaId()
          const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
          saveMediaForProject(mediaId, file).catch(console.error)
          if (file.type === 'image/png' || file.name.endsWith('.png')) {
            readPngTextChunks(file).then(chunks => {
              if (Object.keys(chunks).length > 0) saveMediaMeta(mediaId, chunks)
            }).catch(() => {})
          }
          addNodes({
            id: nodeId,
            type: 'imageUpload',
            position: pos,
            data: { mediaId },
          })
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [screenToFlowPosition, addNodes, addEdges])

  return { onDragOver, onDrop }
}
