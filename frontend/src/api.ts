import type { AnalyzeImageResult, AnalyzeVideoResult, GenerateImageResult, ImageEditResult, HistoryEntry, UsageInfo } from './types'
import { useCanvasStore } from './stores/canvasStore'
import './providers/geminiProvider'
import './providers/fluxProvider'
import './providers/localProvider'
import './providers/ollamaProvider'
import { getImageProvider, getLLMProvider } from './providers/index'
import { registerBridgeStem } from './utils/reviewStatus'
import { STORAGE_KEYS } from './storage/keys'

const BASE = '/api'

function isBackendAvailable(): boolean {
  return location.port === '5100' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
}

function recordRequest(method: string, path: string, status: number, duration: number) {
  try {
    useCanvasStore.getState().addNetworkEntry({
      timestamp: new Date().toISOString(),
      method,
      url: path,
      status,
      duration,
    });
  } catch { /* store may not be ready */ }
}

function backendError(context: string): Error {
  if (!isBackendAvailable()) {
    return new Error(`${context}: running in cloud mode — backend not available`)
  }
  return new Error(`${context}: backend not responding. Start the backend on port 5101`)
}

async function post<T>(path: string, body: FormData): Promise<T> {
  if (!isBackendAvailable()) throw backendError(path)
  const t0 = Date.now();
  let r: Response
  try {
    r = await fetch(`${BASE}${path}`, { method: 'POST', body })
  } catch {
    throw backendError(path)
  }
  recordRequest('POST', path, r.status, Date.now() - t0);
  if (r.status === 502) throw backendError(path)
  const contentType = r.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) throw backendError(path)
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return r.json()
}

async function get<T>(path: string): Promise<T> {
  if (!isBackendAvailable()) throw backendError(path)
  const t0 = Date.now();
  let r: Response
  try {
    r = await fetch(`${BASE}${path}`)
  } catch {
    throw backendError(path)
  }
  recordRequest('GET', path, r.status, Date.now() - t0);
  if (r.status === 502) throw backendError(path)
  const ct = r.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) throw backendError(path)
  if (!r.ok) throw new Error(r.statusText)
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  if (!isBackendAvailable()) throw backendError(path)
  const t0 = Date.now();
  let r: Response
  try {
    r = await fetch(`${BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw backendError(path)
  }
  recordRequest('PUT', path, r.status, Date.now() - t0);
  if (r.status === 502) throw backendError(path)
  const ct = r.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) throw backendError(path)
  if (!r.ok) throw new Error(r.statusText)
  return r.json()
}

/**
 * Send a generated image to Review Hub via backend bridge and register the
 * returned stem so reviewStatus.ts can resolve the mediaId to the correct
 * .review.json filename (e.g. "generated_1774517737168").
 * Returns the bridge stem or null on failure. Safe to fire-and-forget.
 */
export async function bridgeMedia(
  image_b64: string,
  mediaId: string,
  meta: { prompt?: string; model?: string; modelName?: string; aspectRatio?: string; imageSize?: string; costUsd?: number },
): Promise<string | null> {
  if (!isBackendAvailable()) return null
  try {
    const raw = atob(image_b64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'image/png' })
    const fd = new FormData()
    fd.append('image_file', blob, 'generated.png')
    const projectName = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME) || ''
    if (projectName) fd.append('project_name', projectName)
    if (meta.prompt) fd.append('prompt', meta.prompt)
    if (meta.model) fd.append('model', meta.model)
    if (meta.modelName) fd.append('model_name', meta.modelName)
    if (meta.aspectRatio) fd.append('aspect_ratio', meta.aspectRatio)
    if (meta.imageSize) fd.append('image_size', meta.imageSize)
    if (meta.costUsd) fd.append('cost_usd', String(meta.costUsd))
    const resp = await fetch(`${BASE}/bridge/media`, { method: 'POST', body: fd })
    if (resp.ok) {
      const data = await resp.json().catch(() => null)
      const stem: string | undefined = data?.stem
      if (stem && mediaId) {
        registerBridgeStem(mediaId, stem)
      }
      return stem ?? null
    }
  } catch { /* silent */ }
  return null
}

/**
 * Save an image from the canvas to shared/Assets/ via backend bridge.
 * The scanner will auto-index it into the Review Hub DB.
 */
export async function saveToAssets(
  file: File,
  directory?: string,
  filename?: string,
): Promise<boolean> {
  if (!isBackendAvailable()) return false
  try {
    const fd = new FormData()
    fd.append('image_file', file, file.name)
    if (directory) fd.append('directory', directory)
    if (filename) fd.append('filename', filename)
    const resp = await fetch(`${BASE}/bridge/assets`, { method: 'POST', body: fd })
    if (resp.ok) {
      const data = await resp.json().catch(() => null)
      return data?.status === 'ok'
    }
  } catch { /* silent */ }
  return false
}

/**
 * Save a generated video to shared/Media/ via backend bridge.
 * Downloads from CDN URL, saves with metadata sidecar.
 */
export async function bridgeVideo(
  videoUrl: string,
  meta: { prompt?: string; model?: string; modelName?: string; aspectRatio?: string; duration?: number; costUsd?: number },
): Promise<string | null> {
  if (!isBackendAvailable()) return null
  try {
    const fd = new FormData()
    fd.append('video_url', videoUrl)
    const projectName = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME) || ''
    if (projectName) fd.append('project_name', projectName)
    if (meta.prompt) fd.append('prompt', meta.prompt)
    if (meta.model) fd.append('model', meta.model)
    if (meta.modelName) fd.append('model_name', meta.modelName)
    if (meta.aspectRatio) fd.append('aspect_ratio', meta.aspectRatio)
    if (meta.duration) fd.append('duration', String(meta.duration))
    if (meta.costUsd) fd.append('cost_usd', String(meta.costUsd))
    const resp = await fetch(`${BASE}/bridge/video`, { method: 'POST', body: fd })
    if (resp.ok) {
      const data = await resp.json().catch(() => null)
      return data?.stem ?? null
    }
  } catch { /* silent */ }
  return null
}

export const api = {
  async analyzeImage(image: File, model: string, doEmbed: boolean, apiKey: string): Promise<AnalyzeImageResult> {
    if (!isBackendAvailable()) {
      const llm = getLLMProvider('gemini')
      if (!llm) throw new Error('Cloud mode: Gemini provider not available')
      const r = await llm.chat(
        'Analyze this image in detail. Describe what you see, including objects, colors, composition, and any text.',
        model, apiKey, [image],
      )
      return { text: r.text, json: {}, embedding_info: '', preview_b64: '', usage: r.usage }
    }
    const fd = new FormData()
    fd.append('image', image)
    fd.append('model', model)
    fd.append('do_embed', String(doEmbed))
    fd.append('api_key', apiKey)
    return post('/analyze/image', fd)
  },

  analyzeVideo(video: File, model: string, nFrames: number, doEmbed: boolean, apiKey: string): Promise<AnalyzeVideoResult> {
    if (!isBackendAvailable()) throw new Error('Video analysis requires the local backend')
    const fd = new FormData()
    fd.append('video', video)
    fd.append('model', model)
    fd.append('n_frames', String(nFrames))
    fd.append('do_embed', String(doEmbed))
    fd.append('api_key', apiKey)
    return post('/analyze/video', fd)
  },

  /** Extended video analysis — caller builds the full FormData (model, n_frames, mode, cut_threshold, prompt, etc.) */
  analyzeVideoAdvanced(fd: FormData): Promise<AnalyzeVideoResult> {
    if (!isBackendAvailable()) throw new Error('Video analysis requires the local backend')
    return post('/analyze/video', fd)
  },

  async generateImage(prompt: string, model: string, provider: string, apiKey: string, refs?: File[], options?: { aspectRatio?: string; imageSize?: string }): Promise<GenerateImageResult> {
    // Try provider-based routing first
    const imageProvider = getImageProvider(provider)
    if (imageProvider) {
      const result = await imageProvider.generateImage(prompt, model, apiKey, refs, options)
      // Note: bridgeMedia is now called from GenerateImageNode after mediaId is created,
      // so it can register the stem → mediaId mapping for reviewStatus lookup.
      return result
    }
    // Fallback to backend (bridge handled server-side)
    if (!isBackendAvailable()) throw new Error('Cloud mode: no image provider registered for "' + provider + '"')
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('model', model)
    fd.append('api_key', apiKey)
    if (options?.aspectRatio) fd.append('aspect_ratio', options.aspectRatio)
    if (options?.imageSize) fd.append('image_size', options.imageSize)
    if (options?.useGrounding) fd.append('use_grounding', 'true')
    refs?.forEach(f => fd.append('ref_images', f))
    return post('/generate/image', fd)
  },

  async editImage(
    prompt: string,
    image: File,
    model: string,
    apiKey: string,
    editMode: string,
    maskMode: string,
    maskDilation: number,
    numberOfImages: number,
    aspectRatio?: string,
    subjectImages?: File[],
  ): Promise<ImageEditResult> {
    if (!isBackendAvailable()) throw new Error('Image editing requires the backend')
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('image', image)
    fd.append('model', model)
    fd.append('api_key', apiKey)
    fd.append('edit_mode', editMode)
    fd.append('mask_mode', maskMode)
    fd.append('mask_dilation', String(maskDilation))
    fd.append('number_of_images', String(numberOfImages))
    if (aspectRatio) fd.append('aspect_ratio', aspectRatio)
    subjectImages?.forEach(f => fd.append('subject_images', f))
    return post('/edit/image', fd)
  },

  llmChat(prompt: string, model: string, apiKey: string, mediaFiles?: File[], systemPrompt?: string): Promise<{ text: string; status: string; usage?: UsageInfo }> {
    // Route Ollama models directly to client-side provider (no backend proxy needed)
    if (model.startsWith('ollama/')) {
      const llm = getLLMProvider('ollama')
      if (!llm) throw new Error('Ollama provider not available')
      return llm.chat(prompt, model, apiKey, mediaFiles)
    }
    if (!isBackendAvailable()) {
      const llm = getLLMProvider('gemini')
      if (!llm) throw new Error('Cloud mode: Gemini LLM provider not available')
      return llm.chat(prompt, model, apiKey, mediaFiles)
    }
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('model', model)
    fd.append('api_key', apiKey)
    if (systemPrompt) fd.append('system_prompt', systemPrompt)
    mediaFiles?.forEach(f => fd.append('media_files', f))
    return post('/llm/chat', fd)
  },

  cannyEdge(image: File, threshold1 = 50, threshold2 = 150): Promise<{ image_b64: string; status: string }> {
    const fd = new FormData()
    fd.append('image', image)
    fd.append('threshold1', String(threshold1))
    fd.append('threshold2', String(threshold2))
    return post('/effects/canny', fd)
  },

  depthEstimate(image: File, apiKey: string): Promise<{ image_b64: string; status: string }> {
    const fd = new FormData()
    fd.append('image', image)
    fd.append('api_key', apiKey)
    return post('/effects/depth', fd)
  },

  /** Submit a video generation request via PiAPI (Kling / Seedance). Returns {request_id}. */
  generateVideo(
    prompt: string,
    apiKey: string,
    options: { model?: string; aspectRatio?: string; duration?: number; quality?: string; audioUrl?: string; seed?: number },
    refImages?: File[],
    refVideo?: File,
  ): Promise<import('./types').GenerateVideoResult> {
    if (!isBackendAvailable()) throw new Error('Video generation requires the local backend.')
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('api_key', apiKey)
    fd.append('model', options.model ?? 'kling-3.0-omni')
    fd.append('aspect_ratio', options.aspectRatio ?? '16:9')
    fd.append('duration', String(options.duration ?? 5))
    fd.append('quality', options.quality ?? '720p')
    if (options.audioUrl) fd.append('audio_url', options.audioUrl)
    fd.append('seed', String(options.seed ?? -1))
    refImages?.forEach(f => fd.append('ref_images', f))
    if (refVideo) fd.append('ref_video', refVideo)
    return post('/generate/video', fd)
  },

  /** Poll video generation status (PiAPI or fal.ai). */
  videoStatus(requestId: string, apiKey: string, provider = 'piapi', endpoint = ''): Promise<import('./types').GenerateVideoResult> {
    if (!isBackendAvailable()) throw new Error('Video status requires the local backend.')
    const params = new URLSearchParams({ api_key: apiKey, provider })
    if (endpoint) params.set('endpoint', endpoint)
    return get(`/generate/video/status/${requestId}?${params}`)
  },

  getPrompt(): Promise<{ prompt: string }> { return get('/prompt') },
  savePrompt(text: string): Promise<{ status: string }> { return put('/prompt', { text }) },
  getHistory(): Promise<{ history: HistoryEntry[] }> { return get('/prompt/history') },
  getLogs(): Promise<{ logs: string[] }> { return get('/logs') },
  clearLogs(): Promise<{ ok: boolean }> {
    const t0 = Date.now();
    return fetch(`${BASE}/logs`, { method: 'DELETE' }).then(r => {
      recordRequest('DELETE', '/logs', r.status, Date.now() - t0);
      if (!r.ok) throw new Error(`clearLogs failed: ${r.status}`);
      return r.json();
    });
  },
}
