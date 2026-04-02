/**
 * ProjectSwitcher — dropdown for managing multiple projects.
 *
 * Shows the active project name as a button in the top bar.
 * Click to open a dropdown with all projects, plus new/duplicate/delete actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseActiveProject } from '../../hooks/useActiveProject'
import styles from './ProjectSwitcher.module.css'

// ── Relative time helper ─────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(months / 12)
  return `${years}y ago`
}

// ── Component ────────────────────────────────────────────────────────────────

interface ProjectSwitcherProps {
  project: UseActiveProject
  onExport: () => void
  onImport: () => void
}

export function ProjectSwitcher({ project, onExport, onImport }: ProjectSwitcherProps) {
  const {
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
  } = project

  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Guard against the double-fire: Enter key triggers handleCommitRename, then
  // setRenamingId(null) unmounts the input which fires onBlur → handleCommitRename again.
  const isCommittingRef = useRef(false)

  // Focus the rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  // Refresh project list when dropdown opens
  useEffect(() => {
    if (open) void refreshProjects()
  }, [open, refreshProjects])

  const handleToggle = useCallback(() => {
    setOpen(prev => !prev)
    setRenamingId(null)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setRenamingId(null)
  }, [])

  const handleSwitch = useCallback(async (id: string) => {
    if (id === projectId) return
    await switchProject(id)
    handleClose()
  }, [projectId, switchProject, handleClose])

  const handleNew = useCallback(async () => {
    const name = window.prompt('Project name:')?.trim()
    if (!name) return
    await createNewProject(name)
    handleClose()
  }, [createNewProject, handleClose])

  const handleDuplicate = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await duplicateProject(id)
    handleClose()
  }, [duplicateProject, handleClose])

  const handleDelete = useCallback(async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return
    await deleteProject(id)
  }, [deleteProject])

  const handleStartRename = useCallback((id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingId(id)
    setRenameValue(currentName)
  }, [])

  const handleCommitRename = useCallback(async () => {
    if (!renamingId) return
    // Prevent double-invocation: Enter key calls this, then onBlur fires when the
    // input unmounts (because setRenamingId(null) removes it from the DOM).
    if (isCommittingRef.current) return
    isCommittingRef.current = true
    try {
      const trimmed = renameValue.trim()
      if (trimmed && trimmed !== projects.find(p => p.id === renamingId)?.name) {
        await renameProject(renamingId, trimmed)
      }
      setRenamingId(null)
    } finally {
      isCommittingRef.current = false
    }
  }, [renamingId, renameValue, projects, renameProject])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleCommitRename()
    } else if (e.key === 'Escape') {
      setRenamingId(null)
    }
  }, [handleCommitRename])

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <button className={styles.trigger} disabled>
          <span className={styles.triggerName}>Loading...</span>
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <button className={styles.trigger} onClick={handleToggle} title="Switch project">
        <span className={styles.triggerName}>{projectName}</span>
        <svg
          className={`${styles.triggerIcon} ${open ? styles.triggerIconOpen : ''}`}
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.backdrop} onClick={handleClose} />
          <div className={styles.dropdown}>
            {/* Header */}
            <div className={styles.header}>
              <span className={styles.headerTitle}>Projects</span>
              <div className={styles.headerActions}>
                <button className={styles.headerBtn} onClick={handleNew} title="New project">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="6" y1="2" x2="6" y2="10" />
                    <line x1="2" y1="6" x2="10" y2="6" />
                  </svg>
                  New
                </button>
              </div>
            </div>

            {/* Project list */}
            <div className={styles.list}>
              {projects.length === 0 ? (
                <p className={styles.empty}>No projects yet</p>
              ) : (
                projects.map(p => {
                  const isActive = p.id === projectId
                  const nodeCount = p.canvas.nodes?.length ?? 0

                  return (
                    <div
                      key={p.id}
                      className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                      onClick={() => void handleSwitch(p.id)}
                    >
                      <span className={isActive ? styles.activeDot : styles.inactiveDot} />
                      <div className={styles.itemInfo}>
                        {renamingId === p.id ? (
                          <input
                            ref={renameInputRef}
                            className={styles.renameInput}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => void handleCommitRename()}
                            onKeyDown={handleRenameKeyDown}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            className={styles.itemName}
                            onDoubleClick={e => handleStartRename(p.id, p.name, e)}
                            title="Double-click to rename"
                          >
                            {p.name}
                          </span>
                        )}
                        <span className={styles.itemMeta}>
                          <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
                          <span>{relativeTime(p.updatedAt)}</span>
                        </span>
                      </div>
                      <div className={styles.itemActions}>
                        <button
                          className={styles.itemBtn}
                          onClick={e => void handleDuplicate(p.id, e)}
                          title="Duplicate project"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                        </button>
                        <button
                          className={`${styles.itemBtn} ${styles.itemBtnDanger}`}
                          onClick={e => void handleDelete(p.id, p.name, e)}
                          title="Delete project"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer with import/export */}
            <div className={styles.footer}>
              <button className={styles.footerBtn} onClick={() => { onExport(); handleClose() }} title="Export project as JSON">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9,15 12,18 15,15" />
                </svg>
                Export
              </button>
              <button className={styles.footerBtn} onClick={() => { onImport(); handleClose() }} title="Import project from JSON">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="12" y1="12" x2="12" y2="18" />
                  <polyline points="9,15 12,12 15,15" />
                </svg>
                Import
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
