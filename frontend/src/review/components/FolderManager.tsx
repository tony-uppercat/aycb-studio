interface Props {
  directories: string[]
  current: string
  onChange: (dir: string) => void
}

export function FolderManager({ directories, current, onChange }: Props) {
  return (
    <div className="rh-folders">
      <div
        className={`rh-folder-item ${!current ? 'rh-folder-active' : ''}`}
        onClick={() => onChange('')}
      >
        All
      </div>
      {directories.map(dir => (
        <div
          key={dir}
          className={`rh-folder-item ${current === dir ? 'rh-folder-active' : ''}`}
          onClick={() => onChange(dir)}
        >
          {dir || '/'}
        </div>
      ))}
    </div>
  )
}
