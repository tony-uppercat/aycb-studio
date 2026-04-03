interface FolderEntry {
  name: string
  path: string
  is_project?: boolean
}

interface MoveDialogProps {
  folders: FolderEntry[]
  on_select: (path: string) => void
  on_close: () => void
}

export function MoveDialog({ folders, on_select, on_close }: MoveDialogProps) {
  return (
    <div className="rh-move-overlay" onClick={on_close}>
      <div
        className="rh-move-dialog"
        onClick={e => e.stopPropagation()}
      >
        <div className="rh-move-dialog-header">
          <span>Move To Folder</span>
          <button className="rh-move-dialog-close" onClick={on_close}>x</button>
        </div>

        <div className="rh-move-dialog-list">
          {folders.length === 0 ? (
            <div className="rh-move-folder-empty">No folders available</div>
          ) : (
            folders.map(folder => (
              <button
                key={folder.path}
                className={`rh-move-folder-item${folder.is_project ? ' rh-move-folder-project' : ''}`}
                onClick={() => { on_select(folder.path); on_close() }}
              >
                {folder.name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
