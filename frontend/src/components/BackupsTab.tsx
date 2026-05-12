import { useEffect, useState, useCallback } from 'react'
import { listProjects, createProject, setActiveProjectId, type ProjectRecord } from '../stores/projectStore'
import sharedStyles from './SettingsPanel.module.css'
import styles from './BackupsTab.module.css'

interface BackupMeta {
  filename: string
  timestamp: string
  nodes: number
  edges: number
}

interface BackupProjectInfo {
  project_id: string
  backups: BackupMeta[]
}

function relativeAge(iso: string): string {
  if (!iso) return '?'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '?'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago'
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h ago'
  return Math.round(diff / 86_400_000) + 'd ago'
}

function formatTimestamp(iso: string): string {
  if (!iso) return '?'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function BackupsTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backupProjects, setBackupProjects] = useState<BackupProjectInfo[]>([])
  const [idbProjects, setIdbProjects] = useState<ProjectRecord[]>([])
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [listResp, idbList] = await Promise.all([
        fetch('/api/canvas/backup/list', { signal }),
        listProjects(),
      ])
      if (!listResp.ok) throw new Error(`HTTP ${listResp.status}`)
      const data = await listResp.json() as { projects: BackupProjectInfo[] }
      const sorted = [...data.projects].sort((a, b) => {
        const aTs = a.backups[a.backups.length - 1]?.timestamp ?? ''
        const bTs = b.backups[b.backups.length - 1]?.timestamp ?? ''
        return bTs.localeCompare(aTs)
      })
      setBackupProjects(sorted)
      setIdbProjects(idbList)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const handleRestore = useCallback(async (projectId: string, filename: string, displayName: string) => {
    const newName = `${displayName}_restored`
    if (!window.confirm(`Create new project "${newName}" from this backup?`)) return
    const key = `${projectId}/${filename}`
    setRestoring(key)
    try {
      const url = `/api/canvas/backup/file?project_id=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(filename)}`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json() as { canvas?: { nodes?: unknown; edges?: unknown; viewport?: unknown } }
      const canvas = {
        nodes: Array.isArray(data.canvas?.nodes) ? data.canvas!.nodes : [],
        edges: Array.isArray(data.canvas?.edges) ? data.canvas!.edges : [],
        viewport: data.canvas?.viewport,
      } as ProjectRecord['canvas']
      const project = await createProject(newName, canvas, { model: 'Gemini 3 Flash', doEmbed: false })
      await setActiveProjectId(project.id)
      window.location.reload()
    } catch (e) {
      window.alert(`Restore failed: ${(e as Error).message}`)
      setRestoring(null)
    }
  }, [])

  if (loading) return <p className={sharedStyles.hint}>Loading backups…</p>
  if (error) return <p className={sharedStyles.hint} style={{ color: '#f87171' }}>Error: {error}</p>
  if (backupProjects.length === 0) {
    return <p className={sharedStyles.hint}>No backups yet. Disk backups are written every 5 minutes per project.</p>
  }

  return (
    <>
      <p className={sharedStyles.hint}>
        Restore creates a new project alongside the existing one. Up to 20 backups are kept per project (5-min interval).
      </p>
      {backupProjects.map(p => {
        const idbProject = idbProjects.find(ip => ip.id === p.project_id)
        const displayName = idbProject?.name ?? '(orphan)'
        const baseName = idbProject?.name ?? p.project_id
        return (
          <div key={p.project_id} className={sharedStyles.field}>
            <label className={sharedStyles.label}>{displayName}</label>
            <span className={styles.projectId}>{p.project_id}</span>
            <div className={styles.list}>
              {[...p.backups].reverse().map(b => {
                const key = `${p.project_id}/${b.filename}`
                const isRestoring = restoring === key
                return (
                  <div key={b.filename} className={styles.row}>
                    <div className={styles.meta}>
                      <span className={styles.timestamp}>{formatTimestamp(b.timestamp)}</span>
                      <span className={styles.subline}>
                        <span>{relativeAge(b.timestamp)}</span>
                        <span className={styles.counts}>{b.nodes} nodes · {b.edges} edges</span>
                      </span>
                    </div>
                    <button
                      className={sharedStyles.refreshBtn}
                      onClick={() => handleRestore(p.project_id, b.filename, baseName)}
                      disabled={isRestoring}
                    >
                      {isRestoring ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}
