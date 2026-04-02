/**
 * Ollama provider — local LLM chat via Ollama REST API.
 * Registers 'ollama' LLM provider. Models are fetched dynamically from the Ollama server.
 */
import type { UsageInfo } from '../types'
import { registerLLMProvider, type LLMProvider } from './index'
import { STORAGE_KEYS } from '../storage/keys'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** Read Ollama URL from localStorage settings */
function getOllamaUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS)
    if (raw) {
      const s = JSON.parse(raw)
      if (s.ollamaUrl) return s.ollamaUrl
    }
  } catch { /* ignore */ }
  return DEFAULT_OLLAMA_URL
}

/** Convert a File to base64 string */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

/** Fetch available models from Ollama server */
export async function fetchOllamaModels(url?: string): Promise<OllamaModel[]> {
  const base = url || getOllamaUrl()
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return []
    const data = await r.json()
    return data.models ?? []
  } catch {
    return []
  }
}

/** Check if Ollama server is reachable */
export async function checkOllamaServer(url?: string): Promise<boolean> {
  const base = url || getOllamaUrl()
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch {
    return false
  }
}

const ollamaLLMProvider: LLMProvider = {
  id: 'ollama',
  async chat(prompt: string, modelId: string, _apiKey: string, mediaFiles?: File[]): Promise<{ text: string; status: string; usage?: UsageInfo }> {
    const base = getOllamaUrl()

    // Strip 'ollama/' prefix — model IDs are stored as 'ollama/llama3' but Ollama API wants 'llama3'
    const cleanModelId = modelId.replace(/^ollama\//, '')

    // Build messages array
    const messages: Array<{ role: string; content: string; images?: string[] }> = []

    // If media files attached, convert to base64 for multimodal models (llava, etc.)
    const images: string[] = []
    if (mediaFiles) {
      for (const f of mediaFiles) {
        if (f.type.startsWith('image/')) {
          const b64 = await fileToBase64(f)
          images.push(b64)
        }
      }
    }

    messages.push({
      role: 'user',
      content: prompt,
      ...(images.length > 0 ? { images } : {}),
    })

    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cleanModelId,
        messages,
        stream: false,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(err.error ?? `Ollama error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.message?.content ?? ''

    // Ollama returns eval_count (output tokens) and prompt_eval_count (input tokens)
    const inputTokens = data.prompt_eval_count ?? 0
    const outputTokens = data.eval_count ?? 0
    const usage: UsageInfo = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: 0, // Local models are free
    }

    return { text, status: 'OK', usage }
  },
}

// Register at module scope
registerLLMProvider(ollamaLLMProvider)
