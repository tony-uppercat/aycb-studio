import { useEffect, useState, useCallback } from 'react'
import { rhApi } from '../services/api'

export function ReferencePage() {
  const [items, setItems] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')

  const load = useCallback(async () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (tag) params.tag = tag
    const data = await rhApi.listReferences(params)
    setItems(data.items || [])
  }, [search, tag])

  useEffect(() => { load() }, [load])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await rhApi.uploadReference(file)
    load()
    e.target.value = ''
  }

  const handleDelete = async (id: number) => {
    await rhApi.deleteReference(id)
    load()
  }

  return (
    <div className="rh-refs">
      <div className="rh-refs-bar">
        <input className="rh-search" placeholder="Search references..." value={search}
          onChange={e => setSearch(e.target.value)} />
        <input className="rh-search" placeholder="Filter by tag..." value={tag}
          onChange={e => setTag(e.target.value)} style={{ maxWidth: 150 }} />
        <label className="rh-upload-btn">
          Upload
          <input type="file" accept="image/*" onChange={handleUpload} hidden />
        </label>
      </div>
      {items.length === 0 ? (
        <div className="rh-refs-empty">No references yet. Upload images to build your library.</div>
      ) : (
        <div className="rh-refs-grid">
          {items.map(item => (
            <div key={item.id} className="rh-ref-card">
              <img src={`/references/${item.filename}`} alt={item.filename} className="rh-ref-img" loading="lazy" />
              <div className="rh-ref-info">
                <span className="rh-ref-name">{item.filename}</span>
                {item.tags && <span className="rh-ref-tags">{item.tags}</span>}
                <button className="rh-ref-delete" onClick={() => handleDelete(item.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
