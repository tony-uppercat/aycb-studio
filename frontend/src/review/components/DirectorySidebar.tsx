import { useRef, useState } from 'react'

interface DirectorySidebarProps {
  directories: { name: string; count?: number }[]
  subfolders: { name: string; path: string; count?: number }[]
  active_directory: string | null
  expanded_dirs: Set<string>
  on_select_dir: (dir: string | null) => void
  on_toggle_expand: (dir: string) => void
  on_create_folder: (project: string, name: string) => void
}

export default function DirectorySidebar({
  directories,
  subfolders,
  active_directory,
  expanded_dirs,
  on_select_dir,
  on_toggle_expand,
  on_create_folder,
}: DirectorySidebarProps) {
  const [show_new_input, set_show_new_input] = useState(false)
  const [new_folder_name, set_new_folder_name] = useState('')
  const input_ref = useRef<HTMLInputElement>(null)

  function handle_create() {
    const name = new_folder_name.trim()
    if (!name) return
    const active_project =
      active_directory && !active_directory.includes('/')
        ? active_directory
        : directories[0]?.name ?? ''
    on_create_folder(active_project, name)
    set_new_folder_name('')
    set_show_new_input(false)
  }

  function handle_toggle_input() {
    set_show_new_input((v) => {
      if (!v) setTimeout(() => input_ref.current?.focus(), 0)
      return !v
    })
    set_new_folder_name('')
  }

  return (
    <aside className="rh-sidebar">
      <div className="rh-sidebar-header">
        <span>Projects</span>
        <button
          className="rh-sidebar-new-btn"
          onClick={handle_toggle_input}
          title="New Folder"
          aria-label="New Folder"
        >
          +
        </button>
      </div>

      {show_new_input && (
        <div className="rh-sidebar-new-row">
          <input
            ref={input_ref}
            className="rh-sidebar-new-input"
            type="text"
            placeholder="Folder name..."
            value={new_folder_name}
            onChange={(e) => set_new_folder_name(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handle_create()
              if (e.key === 'Escape') { set_show_new_input(false); set_new_folder_name('') }
            }}
          />
          <button className="rh-sidebar-new-confirm" onClick={handle_create}>&#10003;</button>
        </div>
      )}

      <div className="rh-sidebar-list">
        {/* All Media */}
        <button
          className={`rh-dir-item ${active_directory === null ? 'rh-dir-item--active' : ''}`}
          onClick={() => on_select_dir(null)}
        >
          <span className="rh-dir-icon">&#9646;</span>
          <span className="rh-dir-name">All Media</span>
          <span className="rh-dir-arrow">&#8250;</span>
        </button>

        {/* Directory list */}
        {directories.map((dir) => {
          const is_expanded = expanded_dirs.has(dir.name)
          const is_active =
            active_directory === dir.name ||
            (active_directory?.startsWith(dir.name + '/') ?? false)
          const dir_subfolders = subfolders.filter((s) => s.path.startsWith(dir.name + '/'))

          return (
            <div key={dir.name}>
              <div className="rh-dir-row">
                <button
                  className="rh-dir-expand-btn"
                  onClick={(e) => { e.stopPropagation(); on_toggle_expand(dir.name) }}
                  aria-label={is_expanded ? 'Collapse' : 'Expand'}
                >
                  {is_expanded ? '\u25BE' : '\u25B8'}
                </button>
                <button
                  className={`rh-dir-item rh-dir-item--flex ${is_active ? 'rh-dir-item--active' : ''}`}
                  onClick={() => on_select_dir(dir.name)}
                >
                  <span className="rh-dir-icon">&#9646;</span>
                  <span className="rh-dir-name" data-s>{dir.name}</span>
                  {dir.count != null && (
                    <span className="rh-dir-count">{dir.count}</span>
                  )}
                </button>
              </div>

              {is_expanded && dir_subfolders.map((sub) => (
                <div key={sub.path} className="rh-subfolder-row">
                  <button
                    className={`rh-dir-item rh-subfolder-item ${active_directory === sub.path ? 'rh-dir-item--active' : ''}`}
                    onClick={() => on_select_dir(sub.path)}
                  >
                    <span className="rh-dir-icon">&#9643;</span>
                    <span className="rh-dir-name" data-s>{sub.name}</span>
                    {sub.count != null && (
                      <span className="rh-dir-count">{sub.count}</span>
                    )}
                  </button>
                </div>
              ))}

              {is_expanded && dir_subfolders.length === 0 && (
                <div className="rh-subfolder-empty">No subfolders</div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
