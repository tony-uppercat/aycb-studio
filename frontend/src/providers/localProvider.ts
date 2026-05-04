import type { GenerateImageResult } from '../types'
import { registerImageProvider, type ImageProvider, type ImageGenerationOptions } from './index'

/** Local Flux 2 Klein dimensions per aspect ratio — same mapping as cloud. */
const LOCAL_DIMS: Record<string, { width: number; height: number }> = {
  '1:1':  { width: 1024, height: 1024 },
  '4:3':  { width: 1152, height: 896 },
  '3:4':  { width: 896,  height: 1152 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768,  height: 1344 },
}

function localDimsFor(aspectRatio?: string): { width: number; height: number } {
  if (!aspectRatio) return LOCAL_DIMS['1:1']
  return LOCAL_DIMS[aspectRatio] ?? LOCAL_DIMS['1:1']
}

const localProvider: ImageProvider = {
  id: 'local',
  async generateImage(
    prompt: string,
    modelId: string,
    serverUrl: string,
    _refs?: File[],
    options?: ImageGenerationOptions,
  ): Promise<GenerateImageResult> {
    const url = serverUrl || 'http://localhost:5101'
    const fd = new FormData()
    // Strip 'local/' prefix — backend uses plain model IDs
    const cleanModelId = modelId.replace(/^local\//, '')
    const { width, height } = localDimsFor(options?.aspectRatio)
    fd.append('prompt', prompt)
    fd.append('model_id', cleanModelId)
    fd.append('width', String(width))
    fd.append('height', String(height))

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
