import { useCallback, useEffect, useRef, useState } from 'react'

export interface LibraryEntry {
  id: string
  name: string
  text: string
  tags: string[]
  created_at: string
}

export function usePromptLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const fetchEntries = useCallback(async () => {
    controllerRef.current?.abort()
    const ctrl = new AbortController()
    controllerRef.current = ctrl
    setLoading(true)
    try {
      const r = await fetch('/api/prompt/library', { signal: ctrl.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setEntries(data.prompts)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error('Prompt library fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveEntry = useCallback(async (name: string, text: string, tags: string[]) => {
    const r = await fetch('/api/prompt/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, text, tags }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const entry = await r.json()
    setEntries(prev => [...prev, entry])
    return entry
  }, [])

  const deleteEntry = useCallback(async (id: string) => {
    const r = await fetch(`/api/prompt/library/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    setEntries(prev => prev.filter(e => e.id !== id))
  }, [])

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  return { entries, loading, fetchEntries, saveEntry, deleteEntry }
}
