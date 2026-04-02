/**
 * useActiveProject — manages the active project lifecycle.
 *
 * Handles loading, switching, creating, duplicating, deleting, and renaming
 * projects.  Works with the IndexedDB-based projectStore and coordinates
 * with React Flow to swap canvas contents on project switch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Edge } from '@xyflow/react'

import {
  type ProjectRecord,
  createProject,
  getProject,
  updateProject,
  deleteProject as deleteProjectRecord,
  listProjects as listProjectRecords,
  getActiveProjectId,
  setActiveProjectId,
  migrateFromLocalStorage,
} from '../stores/projectStore'
import { deleteMultipleMedia, orphanSweep } from '../mediaStore'
import { serializeNodes, type PersistedCanvas, loadDefaultProject } from './useCanvasPersistence'
import { applyEdgeColor } from '../utils/edgeStyles'
import { useCanvasStore } from '../stores/canvasStore'
import { STORAGE_KEYS } from '../storage/keys'

function migrateEdges(edges: Edge[]): Edge[] {
  return edges.map(e => {
    const migrated = e.sourceHandle === 'prompt-out' ? { ...e, sourceHandle: 'text-out' } : e
    return applyEdgeColor(migrated)
  })
}

/** Read project ID from URL ?project= param (tab-local, survives refresh). */
function getUrlProjectId(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('project')
}

/** Update URL ?project= param without triggering navigation. */
function setUrlProjectId(id: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('project', id)
  window.history.replaceState(null, '', url.toString())
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseActiveProject {
  projectId: string | null
  projectName: string
  projects: ProjectRecord[]
  loading: boolean

  switchProject: (id: string) => Promise<void>
  createNewProject: (name?: string) => Promise<string>
  duplicateProject: (id: string) => Promise<string>
  deleteProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  refreshProjects: () => Promise<void>
}

export function useActiveProject(): UseActiveProject {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('My Project')
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)
  const initRef = useRef(false)

  // Sync projectId into canvasStore so saveMediaForProject can access it without prop drilling
  useEffect(() => {
    useCanvasStore.getState().setActiveProjectId(projectId)
  }, [projectId])

  const { getNodes, getEdges, setNodes, setEdges, setViewport, getViewport, fitView } = useReactFlow()

  // ── Save current canvas back to the active project ──

  const saveCurrentProject = useCallback(async (id: string | null) => {
    if (!id) return
    try {
      const canvas: PersistedCanvas = {
        nodes: serializeNodes(getNodes()),
        edges: getEdges(),
        viewport: getViewport(),
      }
      await updateProject(id, { canvas })
    } catch (err) {
      console.warn('[useActiveProject] Failed to save current project:', err)
    }
  }, [getNodes, getEdges, getViewport])

  // ── Load a project's canvas into React Flow ──

  const loadProjectCanvas = useCallback((canvas: ProjectRecord['canvas']) => {
    const nodes = canvas.nodes ?? []
    const edges = migrateEdges(canvas.edges ?? [])
    setNodes(nodes)
    setEdges(edges)
    if (canvas.viewport) {
      setViewport(canvas.viewport)
    }
    // If no viewport saved, or after a tick for React Flow to lay out, fit to content
    requestAnimationFrame(() => {
      if (!canvas.viewport && nodes.length > 0) {
        fitView({ padding: 0.15, duration: 200 })
      }
    })
  }, [setNodes, setEdges, setViewport, fitView])

  // ── Refresh the project list ──

  const refreshProjects = useCallback(async () => {
    try {
      const all = await listProjectRecords()
      if (mountedRef.current) setProjects(all)
    } catch (err) {
      console.warn('[useActiveProject] Failed to list projects:', err)
    }
  }, [])

  // ── Initialize on mount ──

  useEffect(() => {
    mountedRef.current = true
    if (initRef.current) return
    initRef.current = true

    void (async () => {
      try {
        // 1. Check URL param first (enables multi-tab with different projects)
        let activeId = getUrlProjectId()

        // 2. Fall back to stored active project
        if (!activeId) {
          activeId = await getActiveProjectId()
        }

        // 3. If no active project, try migration from localStorage
        if (!activeId) {
          const migratedId = await migrateFromLocalStorage()
          if (migratedId) activeId = migratedId
        }

        // 4. If still no project, load default template and create project from it
        if (!activeId) {
          const defaultCanvas = await loadDefaultProject()
          const defaultProject = await createProject('My Project', defaultCanvas ?? undefined)
          activeId = defaultProject.id
          await setActiveProjectId(activeId)
        }

        // 5. Load the active project
        const project = await getProject(activeId)
        if (!project) {
          // Active ID was stale — create a new default project
          const defaultProject = await createProject('My Project')
          activeId = defaultProject.id
          await setActiveProjectId(activeId)
          setUrlProjectId(activeId)
          if (mountedRef.current) {
            setProjectId(activeId)
            setProjectName(defaultProject.name)
          }
        } else {
          setUrlProjectId(activeId)
          await setActiveProjectId(activeId)
          if (mountedRef.current) {
            setProjectId(activeId)
            setProjectName(project.name)
            localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, project.name)
            if (project.canvas.nodes.length > 0 || project.canvas.edges.length > 0) {
              loadProjectCanvas(project.canvas)
            }
          }
        }

        // 5. Refresh list
        const all = await listProjectRecords()
        if (mountedRef.current) {
          setProjects(all)
          setLoading(false)
        }

        // 6. Sweep orphaned media blobs at startup (fire-and-forget)
        void orphanSweep()
      } catch (err) {
        console.error('[useActiveProject] Initialization failed:', err)
        if (mountedRef.current) setLoading(false)
      }
    })()

    return () => { mountedRef.current = false }
  }, [loadProjectCanvas])

  // ── Switch to a different project ──

  const switchProject = useCallback(async (targetId: string) => {
    if (targetId === projectId) return

    // Save current project before switching
    await saveCurrentProject(projectId)

    // Load target project
    const target = await getProject(targetId)
    if (!target) {
      console.warn('[useActiveProject] Target project not found:', targetId)
      return
    }

    // Update active project in store + URL
    await setActiveProjectId(targetId)
    setUrlProjectId(targetId)

    // Load canvas
    loadProjectCanvas(target.canvas)

    // Sweep orphaned blobs after switching (fire-and-forget)
    void orphanSweep()

    // Update local state
    setProjectId(targetId)
    setProjectName(target.name)
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, target.name)
    await refreshProjects()
  }, [projectId, saveCurrentProject, loadProjectCanvas, refreshProjects])

  // ── Create a new blank project ──

  const createNewProject = useCallback(async (name?: string) => {
    // Save current project first
    await saveCurrentProject(projectId)

    const project = await createProject(name ?? 'Untitled Project')
    await setActiveProjectId(project.id)
    setUrlProjectId(project.id)

    // Clear the canvas
    setNodes([])
    setEdges([])

    setProjectId(project.id)
    setProjectName(project.name)
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, project.name)
    await refreshProjects()

    return project.id
  }, [projectId, saveCurrentProject, setNodes, setEdges, refreshProjects])

  // ── Duplicate an existing project ──

  const duplicateProject = useCallback(async (sourceId: string) => {
    const source = await getProject(sourceId)
    if (!source) throw new Error(`Project ${sourceId} not found`)

    // If duplicating the active project, save it first to capture latest state
    if (sourceId === projectId) {
      await saveCurrentProject(projectId)
    }

    // Re-fetch to get the freshest canvas
    const fresh = await getProject(sourceId)
    const canvas = fresh?.canvas ?? source.canvas

    const dupe = await createProject(
      `${source.name} (copy)`,
      canvas,
      source.settings,
    )

    // Copy mediaIds from source project
    if (source.mediaIds.length > 0) {
      await updateProject(dupe.id, { mediaIds: [...source.mediaIds] })
    }

    // Switch to the duplicated project
    await setActiveProjectId(dupe.id)
    setUrlProjectId(dupe.id)
    loadProjectCanvas(dupe.canvas)

    setProjectId(dupe.id)
    setProjectName(dupe.name)
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, dupe.name)
    await refreshProjects()

    return dupe.id
  }, [projectId, saveCurrentProject, loadProjectCanvas, refreshProjects])

  // ── Delete a project ──

  const deleteProject = useCallback(async (targetId: string) => {
    // Clean up orphaned media before deleting the project record
    const target = await getProject(targetId)
    if (target && target.mediaIds.length > 0) {
      const allProjects = await listProjectRecords()
      const otherMediaIds = new Set<string>()
      for (const p of allProjects) {
        if (p.id !== targetId) {
          for (const mid of p.mediaIds) otherMediaIds.add(mid)
        }
      }
      const uniqueMediaIds = target.mediaIds.filter(mid => !otherMediaIds.has(mid))
      if (uniqueMediaIds.length > 0) {
        await deleteMultipleMedia(uniqueMediaIds)
      }
    }

    await deleteProjectRecord(targetId)

    if (targetId === projectId) {
      // Deleted the active project — switch to another or create new
      const remaining = await listProjectRecords()
      if (remaining.length > 0) {
        const next = remaining[0]
        await setActiveProjectId(next.id)
        setUrlProjectId(next.id)
        loadProjectCanvas(next.canvas)
        setProjectId(next.id)
        setProjectName(next.name)
        localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, next.name)
      } else {
        // No projects left — create a default
        const defaultProject = await createProject('My Project')
        await setActiveProjectId(defaultProject.id)
        setUrlProjectId(defaultProject.id)
        setNodes([])
        setEdges([])
        setProjectId(defaultProject.id)
        setProjectName(defaultProject.name)
        localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, defaultProject.name)
      }
    }

    await refreshProjects()
  }, [projectId, loadProjectCanvas, setNodes, setEdges, refreshProjects])

  // ── Rename a project ──

  const renameProject = useCallback(async (targetId: string, name: string) => {
    // Optimistic update: reflect new name in UI immediately, before the async IDB write.
    // This prevents a perceived delay and guards against a rare race where the canvas
    // auto-save (also calling updateProject) could read stale data before the rename
    // write commits.
    if (targetId === projectId) {
      setProjectName(name)
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, name)
    }
    try {
      await updateProject(targetId, { name })
    } catch (err) {
      // Roll back the optimistic update if the IDB write fails
      if (targetId === projectId) {
        const previous = projects.find(p => p.id === targetId)?.name ?? projectName
        setProjectName(previous)
        localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME, previous)
      }
      console.warn('[useActiveProject] Failed to rename project:', err)
      return
    }
    await refreshProjects()
  }, [projectId, projectName, projects, refreshProjects])

  return {
    projectId,
    projectName,
    projects,
    loading,
    switchProject,
    createNewProject,
    duplicateProject,
    deleteProject,
    renameProject,
    refreshProjects,
  }
}
