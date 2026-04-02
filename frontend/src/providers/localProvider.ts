import type { GenerateImageResult } from '../types'
import { registerImageProvider, type ImageProvider } from './index'

const localProvider: ImageProvider = {
  id: 'local',
  async generateImage(prompt: string, modelId: string, serverUrl: string): Promise<GenerateImageResult> {
    const url = serverUrl || 'http://localhost:3001'
    const fd = new FormData()
    // Strip 'local/' prefix — backend uses plain model IDs
    const cleanModelId = modelId.replace(/^local\//, '')
    fd.append('prompt', prompt)
    fd.append('model_id', cleanModelId)
    fd.append('width', '1024')
    fd.append('height', '1024')

    const response = await fetch(`${url}/api/generate/local`, { method: 'POST', body: fd })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(err.detail ?? `Local server error: ${response.status}`)
    }
    return response.json()
  }
}

registerImageProvider(localProvider)

export async function checkLocalServer(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/local/gpu`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch { return false }
}
