/**
 * Hook to fetch and cache available Ollama models.
 * Auto-detects Ollama on startup and refreshes periodically.
 */
import { useEffect, useState } from 'react'
import { useSettings } from '../components/SettingsContext'
import { fetchOllamaModels, type OllamaModel } from '../providers/ollamaProvider'

export interface OllamaModelEntry {
  id: string       // 'ollama/llama3'
  name: string     // 'llama3 (8B Q4)'
  api: 'ollama'
  tooltip: string
  deprecated: false
}

function formatModelName(m: OllamaModel): string {
  const parts = [m.name]
  if (m.details?.parameter_size) parts.push(`(${m.details.parameter_size})`)
  if (m.details?.quantization_level) parts.push(m.details.quantization_level)
  return parts.join(' ')
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`
  return `${bytes}B`
}

function toModelEntry(m: OllamaModel): OllamaModelEntry {
  return {
    id: `ollama/${m.name}`,
    name: formatModelName(m),
    api: 'ollama',
    tooltip: `Local model via Ollama — ${formatSize(m.size)}${m.details?.family ? `, ${m.details.family}` : ''} — Free`,
    deprecated: false,
  }
}

/** Fetch Ollama models, returning formatted entries for the LLM model dropdown. */
export function useOllamaModels(): { models: OllamaModelEntry[]; available: boolean; loading: boolean } {
  const { ollamaUrl } = useSettings()
  const [models, setModels] = useState<OllamaModelEntry[]>([])
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const raw = await fetchOllamaModels(ollamaUrl)
      if (cancelled) return
      setModels(raw.map(toModelEntry))
      setAvailable(raw.length > 0)
      setLoading(false)
    }

    load()

    // Refresh every 30 seconds to detect newly pulled models
    const interval = setInterval(load, 30_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [ollamaUrl])

  return { models, available, loading }
}
