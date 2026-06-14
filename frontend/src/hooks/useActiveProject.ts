/**
 * useActiveProject — manages the active project lifecycle.
 *
 * Handles loading, switching, creating, duplicating, deleting, and renaming
 * projects.  Works with the IndexedDB-based projectStore and coordinates
 * with React Flow to swap canvas contents on project switch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'

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

/**
 * Rename BracketParser node data fields from snake_case (legacy) to
 * camelCase. Runs on canvas load so previously-saved canvases keep
 * working after the audit's m9 rename. Safe to re-run: each migration
 * checks the old key exists and the new key is absent.
 */
const _BRACKET_PARSER_MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  ['output_mode', 'outputMode'],
  ['excluded_keys', 'excludedKeys'],
  ['output_limit', 'outputLimit'],
  ['output_override', 'outputOverride'],
  ['pins_collapsed', 'pinsCollapsed'],
  ['preview_collapsed', 'previewCollapsed'],
  ['text_collapsed', 'textCollapsed'],
]

export function migrateNodes(nodes: Node[]): Node[] {
  return nodes.map(n => {
    if (n.type !== 'bracketParser' || !n.data) return n
    const data = { ...n.data } as Record<string, unknown>
    let touched = false
    for (const [oldKey, newKey] of _BRACKET_PARSER_MIGRATIONS) {
      if (oldKey in data) {
        // Only copy if the new key is absent — a partial migration could
        // otherwise overwrite a fresh value with a stale one. Always drop
        // the old key so we don't keep dual entries.
        if (!(newKey in data)) {
          data[newKey] = data[oldKey]
        }
        delete data[oldKey]
        touched = true
      }
    }
    return touched ? { ...n, data } : n
  })
}


/**
 * Assign handle_id to subnet proxies that shipped before audit fix SC1.
 * The manifest default was `''`, which collided the moment a subnet had
 * two proxies of the same direction. This migration walks the subnet
 * tree recursively, gives each empty-handle proxy a unique id, and
 * remaps parent-level edges that were pointing to the empty handle
 * (only safe when exactly one proxy per direction had the empty id —
 * multi-collision cases lose their edges, caller should reconnect).
 *
 * Returns updated nodes and edges. Single pass, mutation-free.
 */
export function migrateSubnets(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  let updatedEdges = edges
  const updatedNodes = nodes.map((n) => _migrateSubnetNode(n, (remapper) => {
    updatedEdges = remapper(updatedEdges)
  }))
  return { nodes: updatedNodes, edges: updatedEdges }
}


function _randomHandleId(prefix: 'in' | 'out'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}


function _migrateSubnetNode(
  node: Node,
  remapParentEdges: (fn: (edges: Edge[]) => Edge[]) => void,
): Node {
  if (node.type !== 'subnet' || !node.data) return node
  const d = node.data as Record<string, unknown>
  const sub_graph = d.sub_graph as
    | { nodes: Node[]; edges: Edge[]; viewport: unknown }
    | undefined
  if (!sub_graph) return node

  // 1. Recurse first so nested subnets fix their own tree.
  //    Nested remaps only touch edges INSIDE this subnet's sub_graph —
  //    we pass a local updater that rewrites sub_graph.edges, not the
  //    outer parent's edges.
  let childEdges = sub_graph.edges
  const migratedChildren = sub_graph.nodes.map((child) =>
    _migrateSubnetNode(child, (fn) => {
      childEdges = fn(childEdges)
    }),
  )

  // 2. Find this subnet's proxies with empty handle_id, sorted by y.
  const emptyInputs = migratedChildren
    .filter((c) => c.type === 'subnet-input' && !(c.data as Record<string, unknown>)?.handle_id)
    .sort((a, b) => a.position.y - b.position.y)
  const emptyOutputs = migratedChildren
    .filter((c) => c.type === 'subnet-output' && !(c.data as Record<string, unknown>)?.handle_id)
    .sort((a, b) => a.position.y - b.position.y)

  if (emptyInputs.length === 0 && emptyOutputs.length === 0 &&
      childEdges === sub_graph.edges) {
    // No changes anywhere in this subtree.
    return node
  }

  // 3. Assign new ids to empty proxies.
  const inputIdMap = new Map<string, string>() // node id → new handle_id
  const outputIdMap = new Map<string, string>()
  const patchedChildren = migratedChildren.map((c) => {
    const cd = (c.data ?? {}) as Record<string, unknown>
    if (c.type === 'subnet-input' && !cd.handle_id) {
      const newId = _randomHandleId('in')
      inputIdMap.set(c.id, newId)
      return { ...c, data: { ...cd, handle_id: newId } }
    }
    if (c.type === 'subnet-output' && !cd.handle_id) {
      const newId = _randomHandleId('out')
      outputIdMap.set(c.id, newId)
      return { ...c, data: { ...cd, handle_id: newId } }
    }
    return c
  })

  // 4. Remap PARENT-level edges pointing to this subnet's empty handles.
  //    Only safe when a single proxy per direction had the empty id —
  //    otherwise we can't tell which proxy the edge meant.
  if (emptyInputs.length === 1 || emptyOutputs.length === 1) {
    remapParentEdges((edges) =>
      edges.map((e) => {
        if (emptyInputs.length === 1 &&
            e.target === node.id &&
            (!e.targetHandle || e.targetHandle === '')) {
          return { ...e, targetHandle: inputIdMap.get(emptyInputs[0].id) ?? e.targetHandle }
        }
        if (emptyOutputs.length === 1 &&
            e.source === node.id &&
            (!e.sourceHandle || e.sourceHandle === '')) {
          return { ...e, sourceHandle: outputIdMap.get(emptyOutputs[0].id) ?? e.sourceHandle }
        }
        return e
      }),
    )
  } else if (emptyInputs.length > 1 || emptyOutputs.length > 1) {
    // Multi-collision — leave edges pointing at '', they'll dangle until
    // the user reconnects. Log so the first user to hit this knows.
    console.warn(
      `[migrateSubnets] subnet ${node.id} had ${emptyInputs.length} in + ` +
      `${emptyOutputs.length} out proxies with empty handle_id; assigned ` +
      `new ids but parent-level edges must be reconnected manually.`,
    )
  }

  return {
    ...node,
    data: { ...d, sub_graph: { ...sub_graph, nodes: patchedChildren, edges: childEdges } },
  }
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
    const subnetMigrated = migrateSubnets(canvas.nodes ?? [], canvas.edges ?? [])
    const nodes = migrateNodes(subnetMigrated.nodes)
    const edges = migrateEdges(subnetMigrated.edges)
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

    // Purge this project's recorded cost entries (cost view scopes by
    // activeProjectId; orphaned entries would otherwise linger in the store).
    useCanvasStore.getState().removeCostsForProject(targetId)

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
