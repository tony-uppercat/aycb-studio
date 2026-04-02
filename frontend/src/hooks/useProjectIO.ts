import { useCallback } from 'react'
import { type Node, type Edge, type Viewport } from '@xyflow/react'
import { useCanvasStore } from '../stores/canvasStore'
import { listMedia, loadMedia } from '../mediaStore'
import { downloadProject, importProject } from '../utils/projectIO'
import { downloadFile } from '../utils/downloadManager'
import {
  createProject,
  addMediaToProject,
  setActiveProjectId,
} from '../stores/projectStore'

interface UseProjectIOParams {
  getNodes: () => Node[]
  getEdges: () => Edge[]
  getViewport: () => Viewport
  setNodes: (updater: Node[] | ((ns: Node[]) => Node[])) => void
  setEdges: (updater: Edge[] | ((es: Edge[]) => Edge[])) => void
  setViewport: (vp: Viewport) => void
  model: string
  doEmbed: boolean
}

export function useProjectIO({
  getNodes,
  getEdges,
  getViewport,
  setNodes,
  setEdges,
  setViewport,
  model,
  doEmbed,
}: UseProjectIOParams) {
  const setExportStatus = useCanvasStore(s => s.setExportStatus)

  const handleProjectExport = useCallback(async () => {
    try {
      setExportStatus('Preparing export...')
      const viewport = getViewport()
      await downloadProject(getNodes(), getEdges(), viewport, { model, doEmbed })
      setExportStatus('')
    } catch (err) {
      setExportStatus('')
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [getNodes, getEdges, getViewport, model, doEmbed, setExportStatus])

  const handleProjectImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json,.gz,.geminishot.gz,.aycb.gz,application/gzip'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        setExportStatus('Importing...')
        const result = await importProject(file)

        // Derive a human-readable project name from the filename
        const name = file.name
          .replace(/\.(geminishot|aycb)\.(gz|json)$/i, '')
          .replace(/\.(gz|json)$/i, '')
          .replace(/^aycb-project-\d{4}-\d{2}-\d{2}$/, 'Imported Project')
          .trim() || 'Imported Project'

        // Create a new project for the imported canvas
        const project = await createProject(name, {
          nodes: result.nodes,
          edges: result.edges,
          viewport: result.viewport,
        }, result.settings)

        // Register all media referenced by nodes in the new project
        const mediaIds = new Set<string>()
        for (const node of result.nodes) {
          const d = node.data as Record<string, unknown>
          if (typeof d.mediaId === 'string') mediaIds.add(d.mediaId)
          if (Array.isArray(d.historyIds)) {
            for (const h of d.historyIds) if (typeof h === 'string') mediaIds.add(h)
          }
          if (Array.isArray(d.frameIds)) {
            for (const f of d.frameIds) if (typeof f === 'string') mediaIds.add(f)
          }
        }
        for (const mid of mediaIds) {
          await addMediaToProject(project.id, mid)
        }

        // Set as active project and update URL param for multi-tab isolation
        await setActiveProjectId(project.id)
        const url = new URL(window.location.href)
        url.searchParams.set('project', project.id)
        window.history.replaceState(null, '', url.toString())

        // Load the imported canvas into React Flow
        setNodes(result.nodes)
        setEdges(result.edges)
        if (result.viewport) setViewport(result.viewport)

        setExportStatus('')
        alert(`Imported "${name}" as new project. ${result.mediaCount} media file${result.mediaCount !== 1 ? 's' : ''} restored.`)
      } catch (err) {
        setExportStatus('')
        alert('Import failed: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    input.click()
  }, [setNodes, setEdges, setViewport, setExportStatus])

  const handleExportToFolder = useCallback(async () => {
    const entries = await listMedia()
    if (entries.length === 0) {
      alert('No media files to export.')
      return
    }

    if ('showDirectoryPicker' in window) {
      let dirHandle: FileSystemDirectoryHandle
      try {
        dirHandle = await (window as unknown as { showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' })
      } catch {
        return // user cancelled
      }

      setExportStatus(`Exporting 0/${entries.length}...`)
      let exported = 0
      for (const entry of entries) {
        const file = await loadMedia(entry.id)
        if (!file) continue
        try {
          const fileHandle = await dirHandle.getFileHandle(file.name, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(file)
          await writable.close()
        } catch (err) {
          console.error(`Failed to write ${file.name}:`, err)
        }
        exported++
        setExportStatus(`Exporting ${exported}/${entries.length}...`)
      }
      setExportStatus('')
      alert(`Exported ${exported} file${exported !== 1 ? 's' : ''}.`)
    } else {
      setExportStatus(`Downloading 0/${entries.length}...`)
      let downloaded = 0
      for (const entry of entries) {
        const file = await loadMedia(entry.id)
        if (!file) continue
        downloadFile(file)
        downloaded++
        setExportStatus(`Downloading ${downloaded}/${entries.length}...`)
      }
      setExportStatus('')
      alert(`Downloaded ${downloaded} file${downloaded !== 1 ? 's' : ''}.`)
    }
  }, [setExportStatus])

  return { handleProjectExport, handleProjectImport, handleExportToFolder }
}
