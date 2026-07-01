interface FilterBarProps {
  search: string
  active_filter: string
  sort_by: string
  on_search_change: (v: string) => void
  on_filter_change: (f: string) => void
  on_sort_change: (s: string) => void
}

const FILTERS = [
  { value: 'all',       label: 'All' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'approved',  label: 'Approved' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'comments',  label: 'With Comments' },
  { value: 'drawings',  label: 'With Drawings' },
]

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Newest First' },
  { value: 'oldest',    label: 'Oldest First' },
  { value: 'name_asc',  label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
]

export function FilterBar({
  search,
  active_filter,
  sort_by,
  on_search_change,
  on_filter_change,
  on_sort_change,
}: FilterBarProps) {
  return (
    <div className="rh-toolbar">
      <div className="rh-search-wrapper">
        <span className="rh-search-icon">S</span>
        <input
          className="rh-search-input"
          placeholder="Search name or prompt..."
          value={search}
          onChange={e => on_search_change(e.target.value)}
        />
        {search && (
          <button
            className="rh-clear-search"
            onClick={() => on_search_change('')}
            title="Clear search"
          >
            x
          </button>
        )}
      </div>

      <div className="rh-filter-group">
        {FILTERS.map(f => (
          <button
            key={f.value}
            className={`rh-filter-chip${active_filter === f.value ? ' rh-filter-chip-active' : ''}`}
            onClick={() => on_filter_change(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <select
        className="rh-sort-select"
        value={sort_by}
        onChange={e => on_sort_change(e.target.value)}
      >
        {SORT_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
