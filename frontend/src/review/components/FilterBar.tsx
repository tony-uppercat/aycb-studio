interface Props {
  sort: string
  order: string
  search: string
  onSortChange: (s: string) => void
  onOrderChange: (o: string) => void
  onSearchChange: (q: string) => void
}

export function FilterBar({ sort, order, search, onSortChange, onOrderChange, onSearchChange }: Props) {
  return (
    <div className="rh-filter-bar">
      <input
        className="rh-search"
        placeholder="Search..."
        value={search}
        onChange={e => onSearchChange(e.target.value)}
      />
      <select className="rh-select" value={sort} onChange={e => onSortChange(e.target.value)}>
        <option value="created_at">Date</option>
        <option value="filename">Name</option>
        <option value="file_size">Size</option>
      </select>
      <button
        className="rh-order-btn"
        onClick={() => onOrderChange(order === 'DESC' ? 'ASC' : 'DESC')}
      >
        {order === 'DESC' ? '\u2193' : '\u2191'}
      </button>
    </div>
  )
}
