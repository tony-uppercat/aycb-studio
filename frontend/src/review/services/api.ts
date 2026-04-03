const BASE = '/api/rh'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v) })
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(BASE + path, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export const rhApi = {
  listMedia: (params?: { directory?: string; sort?: string; order?: string }) =>
    get<{ items: unknown[]; total: number }>('/media', params as Record<string, string>),
  getMedia: (id: number) => get<unknown>(`/media/${id}`),
  deleteMedia: (id: number) => del(`/media/${id}`),
  getDirectories: () => get<{ directories: string[] }>('/media/directories'),
  getStats: () => get<{ count: number; total_size: number }>('/media/stats'),
  listComments: (mediaId: number) => get<{ comments: unknown[] }>(`/comments/${mediaId}`),
  addComment: (body: { media_id: number; author: string; content: string; x_position?: number; y_position?: number; annotation_type?: string; parent_id?: number }) =>
    post<{ id: number }>('/comments', body),
  deleteComment: (id: number) => del(`/comments/${id}`),
  toggleFavorite: (body: { media_id: number; user_name: string; status?: string }) =>
    post<unknown>('/favorites/toggle', body),
  getFavorites: (mediaId: number) => get<{ favorites: unknown[] }>(`/favorites/${mediaId}`),
  getDrawing: (mediaId: number) => get<unknown>(`/drawings/${mediaId}`),
  saveDrawing: (body: { media_id: number; author: string; strokes_json: string; thumbnail_data?: string }) =>
    post<{ id: number }>('/drawings', body),
  listReferences: (params?: { search?: string; tag?: string }) =>
    get<{ items: unknown[] }>('/references', params as Record<string, string>),
  deleteReference: (id: number) => del(`/references/${id}`),
  uploadMedia: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return post<{ filename: string; path: string }>('/upload/media', fd)
  },
  uploadReference: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return post<{ filename: string; id: number }>('/upload/reference', fd)
  },
  listFolders: () => get<{ folders: string[] }>('/folders'),
  moveToFolder: (body: { media_id: number; target_dir: string }) =>
    post<unknown>('/folders/move', body),
}
