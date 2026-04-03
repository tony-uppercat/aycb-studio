interface MediaItem {
  id: number
  filename: string
  thumbnail_path?: string
}

interface Props {
  items: MediaItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  onDoubleClick: (id: number) => void
}

function thumbnailSrc(item: MediaItem): string {
  if (item.thumbnail_path) {
    const name = item.thumbnail_path.split('/').pop() ?? item.filename
    return `/media/${name}`
  }
  return `/media/${item.filename}`
}

export function MediaGrid({ items, selectedId, onSelect, onDoubleClick }: Props) {
  if (items.length === 0) {
    return <div className="rh-grid-empty">No media found</div>
  }

  return (
    <div className="rh-grid">
      {items.map(item => (
        <div
          key={item.id}
          className={`rh-grid-item ${selectedId === item.id ? 'rh-grid-selected' : ''}`}
          onClick={() => onSelect(item.id)}
          onDoubleClick={() => onDoubleClick(item.id)}
        >
          <img
            src={thumbnailSrc(item)}
            alt={item.filename}
            loading="lazy"
            className="rh-grid-thumb"
          />
          <span className="rh-grid-name">{item.filename}</span>
        </div>
      ))}
    </div>
  )
}
