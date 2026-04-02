import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell, type SlotDef } from '../_shared/NodeShell'
import { useSettings } from '../../components/SettingsContext'
import { api, bridgeMedia } from '../../api'
import type { GenerateImageNodeData } from '../../types'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'
import { pullText, pullAllMedia } from '../../hooks/useDataPropagation'
import { useGenerateImageHistory } from '../../hooks/useGenerateImageHistory'
import { reportNodeError } from '../../utils/nodeErrors'
import { useCanvasStore } from '../../stores/canvasStore'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { fetchReviewStatus, registerBridgeStem, saveMediaMeta, toggleFavorite, type ReviewStatus } from '../../utils/reviewStatus'
import styles from '../_shared/Node.module.css'

type GenerateImageNodeType = Node<GenerateImageNodeData, 'generateImage'>

const IMAGE_MODELS = [
  // Google Gemini — text-to-image & image-to-image (pass ref images for editing)
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', provider: 'gemini', tooltip: 'Gemini 3.1 Flash — fast T→I / I→I, 0.5K–4K, extended aspect ratios', price: '$0.067', deprecated: false },
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', provider: 'gemini', tooltip: 'Gemini 3 Pro — best quality, text rendering, 1K–4K', price: '$0.134', deprecated: false },
  { id: 'gemini-2.5-flash-image', name: 'Nano Banana (2.5)', provider: 'gemini', tooltip: 'Gemini 2.5 Flash — LEGACY, max 1K only. Consider using 3.x models instead.', price: '$0.039', deprecated: true },
  // Google Imagen
  { id: 'imagen-4.0-generate-001', name: 'Imagen 4', provider: 'imagen', tooltip: 'Google Imagen 4 — photorealistic, up to 2K', price: '$0.04', deprecated: false },
  { id: 'imagen-4.0-ultra-generate-001', name: 'Imagen 4 Ultra', provider: 'imagen', tooltip: 'Imagen 4 Ultra — max detail, up to 2K', price: '$0.06', deprecated: false },
  { id: 'imagen-4.0-fast-generate-001', name: 'Imagen 4 Fast', provider: 'imagen', tooltip: 'Fastest Imagen — quick iterations', price: '$0.02', deprecated: false },
  // Flux (BFL Cloud)
  { id: 'flux-2-klein-4b', name: 'Flux 2 Klein 4B', provider: 'flux-cloud', tooltip: 'Black Forest Labs 4B via BFL API', price: '~$0.014', deprecated: false },
  { id: 'flux-2-klein-9b', name: 'Flux 2 Klein 9B', provider: 'flux-cloud', tooltip: 'Black Forest Labs 9B via BFL API', price: '~$0.015', deprecated: false },
  // Flux (Local GPU)
  { id: 'local/flux-2-klein-4b', name: 'Flux 2 Klein 4B (Local)', provider: 'local', tooltip: 'Run on your GPU', price: 'Free', deprecated: false },
  { id: 'local/flux-2-klein-9b', name: 'Flux 2 Klein 9B (Local)', provider: 'local', tooltip: 'Run on your GPU (24GB+ VRAM)', price: 'Free', deprecated: false },
] as const

const ASPECT_RATIOS = [
  { value: '', label: 'Auto' },
  { value: '1:1', label: '1:1 Square' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '16:9', label: '16:9 Wide' },
  { value: '9:16', label: '9:16 Vertical' },
  { value: '21:9', label: '21:9 Cinematic' },
  { value: '4:1', label: '4:1 Banner' },
  { value: '1:4', label: '1:4 Tall' },
  { value: '8:1', label: '8:1 Ultra-wide' },
  { value: '1:8', label: '1:8 Ultra-tall' },
]

const RESOLUTIONS = [
  { value: '', label: 'Auto' },
  { value: '512', label: '0.5K' },
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

// Resolution and aspect ratio are now passed as structured API params (imageConfig),
// not embedded in the prompt text.

const MAX_REFS = 8
const MAX_HISTORY = 50

export function GenerateImageNode({ id, data, selected }: NodeProps<GenerateImageNodeType>) {
  const { updateNodeData, getNodes, getEdges, setEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { openPreview } = useMediaPreview()
  const { apiKey, bflApiKey, localServerUrl } = useSettings()

  // Dynamic image pins (same pattern as LLM media pins)
  const connectedImageCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('image-')).length
  )
  const imageCount = Math.min(connectedImageCount + 1, MAX_REFS)
  const imageSlots: SlotDef[] = Array.from({ length: imageCount }, (_, i) => ({
    id: `image-${i}`,
    label: `Ref ${i + 1}`,
    type: 'image' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [imageCount, id, updateNodeInternals])

  const [selectedModel, setSelectedModel] = useState(
    typeof data.selectedModel === 'string' ? data.selectedModel : 'gemini-3.1-flash-image-preview'
  )
  const [aspectRatio, setAspectRatio] = useState((data as Record<string, unknown>).aspectRatio as string || '21:9')
  const [resolution, setResolution] = useState((data as Record<string, unknown>).resolution as string || '1K')
  // Refs so runSingle always reads the latest values regardless of closure staleness
  const aspectRatioRef = useRef(aspectRatio)
  const resolutionRef = useRef(resolution)
  useEffect(() => { aspectRatioRef.current = aspectRatio }, [aspectRatio])
  useEffect(() => { resolutionRef.current = resolution }, [resolution])
  const [localPrompt, setLocalPrompt] = useState(String(data.prompt ?? ''))
  const [imageB64, setImageB64] = useState<string | null>(null)
  // True while we're waiting for historyPreview to load after a generation, so we can clear imageB64
  const waitingForPreviewRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()
  // Tracks the mediaId of the currently displayed fresh image (available before history updates)
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null)

  // History state and navigation
  const {
    historyIds,
    historyIndex,
    historyPreview,
    historyThumbs,
    historyExpanded,
    navigateHistory,
    setHistoryIds,
    setHistoryIndex,
    setHistoryExpanded,
    userNavigatedRef,
  } = useGenerateImageHistory({
    nodeId: id,
    historyIdsFromData: data.historyIds ?? [],
  })

  // Review status badges for history items
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus | null>>({})

  useEffect(() => {
    if (historyIds.length === 0) return
    let cancelled = false
    historyIds.forEach(mid => {
      if (mid && !(mid in reviewStatuses)) {
        fetchReviewStatus(mid).then(status => {
          if (!cancelled) {
            setReviewStatuses(prev => ({ ...prev, [mid]: status }))
          }
        })
      }
    })
    return () => { cancelled = true }
  }, [historyIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // When user navigates to a history item, update the output
  useEffect(() => {
    if (!userNavigatedRef.current) return
    userNavigatedRef.current = false
    if (historyIndex >= 0 && historyIds[historyIndex]) {
      const mid = historyIds[historyIndex]
      updateNodeData(id, { mediaId: mid })
      setImageB64(null)
    }
  }, [historyIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear base64 once historyPreview blob URL is ready after a fresh generation.
  // This avoids keeping ~3 MB of base64 in state after the image is safely in IDB.
  useEffect(() => {
    if (waitingForPreviewRef.current && historyPreview) {
      waitingForPreviewRef.current = false
      setImageB64(null)
    }
  }, [historyPreview])

  // Arrow keys to navigate history when node is selected
  // Use capture phase to intercept before React Flow moves the node
  useEffect(() => {
    if (!selected || historyIds.length < 2) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        navigateHistory(-1)
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        navigateHistory(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, historyIds.length, navigateHistory])

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  // Current media ID — activeMediaId (set with imageB64) > data.mediaId > historyIds fallback
  const currentMediaId = activeMediaId ?? (data.mediaId as string | undefined) ?? historyIds[historyIndex] ?? null

  const handleFavoriteToggle = useCallback(async (mid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Optimistic update
    setReviewStatuses(prev => {
      const cur = prev[mid]
      return {
        ...prev,
        [mid]: cur
          ? { ...cur, favorite: !cur.favorite }
          : { status: null, reviewed_by: null, reviewed_at: null, comments_count: 0, drawings_count: 0, favorite: true },
      }
    })
    const ok = await toggleFavorite(mid)
    if (!ok) {
      setReviewStatuses(prev => {
        const cur = prev[mid]
        return cur ? { ...prev, [mid]: { ...cur, favorite: !cur.favorite } } : prev
      })
    }
  }, [])

  // Check if prompt pin is connected
  const hasPromptEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'prompt-in')
  )

  // Subscribe to upstream prompt changes for live preview
  const activePrompt = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'prompt-in')
    if (!edge) return localPrompt
    const src = state.nodes.find(n => n.id === edge.source)
    if (!src) return localPrompt
    const d = src.data as Record<string, unknown>
    return String(d.outputText ?? d.text ?? d.prompt ?? localPrompt)
  })

  const modelInfo = IMAGE_MODELS.find(m => m.id === selectedModel) ?? IMAGE_MODELS[0]

  function swapRefs() {
    setEdges(eds => {
      const e0 = eds.find(e => e.target === id && e.targetHandle === 'image-0')
      const e1 = eds.find(e => e.target === id && e.targetHandle === 'image-1')
      if (!e0 || !e1) return eds
      return eds.map(e => {
        if (e.id === e0.id) return { ...e, source: e1.source, sourceHandle: e1.sourceHandle }
        if (e.id === e1.id) return { ...e, source: e0.source, sourceHandle: e0.sourceHandle }
        return e
      })
    })
  }

  const promptForEstimate = pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt
  const estimate = estimateCost(selectedModel, 'generate_image', promptForEstimate, connectedImageCount)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  const [batchCount, setBatchCount] = useState(1)
  const [batchProgress, setBatchProgress] = useState(0)

  // Ref to accumulate history IDs atomically during batch runs
  const batchHistoryRef = useRef<string[]>([])

  /**
   * Run a single generation. When `batchAccum` is provided (batch mode),
   * results are appended there instead of calling setHistoryIds/updateNodeData
   * so the caller can do a single merged update after all promises settle.
   */
  const runSingle = useCallback(async (batchAccum?: string[]): Promise<void> => {
    const rawPrompt = pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt
    if (!rawPrompt.trim()) { setError('Write a prompt'); return }
    const prompt = rawPrompt.trim()
    const refs = await pullAllMedia(id, 'image-', getNodes, getEdges)
    const providerKey = modelInfo.provider === 'flux-cloud' ? bflApiKey
                     : modelInfo.provider === 'local' ? localServerUrl
                     : apiKey
    const currentAspectRatio = aspectRatioRef.current
    const currentResolution = resolutionRef.current
    const imageOptions = {
      ...(currentAspectRatio ? { aspectRatio: currentAspectRatio } : {}),
      ...(currentResolution ? { imageSize: currentResolution } : {}),
    }
    const r = await api.generateImage(prompt, selectedModel, modelInfo.provider, providerKey, refs.length ? refs : undefined, imageOptions)
    if (!r.image_b64) { throw new Error(r.status || 'No image generated') }

    // Generate mediaId and set it with imageB64 so both are in the same render batch
    const mediaId = generateMediaId()
    setActiveMediaId(mediaId)
    setImageB64(r.image_b64)

    const response = await fetch(`data:image/png;base64,${r.image_b64}`)
    const blob = await response.blob()
    const file = new File([blob], `generated_${Date.now()}.png`, { type: 'image/png' })
    await saveMediaForProject(mediaId, file)

    // Persist metadata client-side (works in cloud mode without backend)
    saveMediaMeta(mediaId, {
      prompt,
      model: selectedModel,
      model_name: modelInfo.name,
      aspect_ratio: currentAspectRatio || undefined,
      image_size: currentResolution || undefined,
      cost_usd: r.usage?.cost_usd,
      generated_at: new Date().toISOString(),
    })

    // Register mediaId → bridge stem so reviewStatus can find the .review.json sidecar.
    // Backend path: bridge_stem is already in the response (server handled the bridge).
    // Provider path (client-side): send to bridge now that we have the mediaId.
    if (r.bridge_stem) {
      registerBridgeStem(mediaId, r.bridge_stem)
    } else {
      // Fire-and-forget — does not block UI
      bridgeMedia(r.image_b64, mediaId, {
        prompt,
        model: selectedModel,
        modelName: modelInfo.name,
        aspectRatio: currentAspectRatio || undefined,
        imageSize: currentResolution || undefined,
        costUsd: r.usage?.cost_usd,
      }).catch(() => { /* silent */ })
    }

    if (batchAccum) {
      // Batch mode: append to shared mutable array; caller merges later
      batchAccum.push(mediaId)
      // Still update mediaId so downstream can pull the latest result
      updateNodeData(id, { mediaId })
      // Signal that we want to clear imageB64 once historyPreview loads
      waitingForPreviewRef.current = true
    } else {
      // Single mode: update history immediately
      const currentIds: string[] = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
      const newHistory = [...currentIds, mediaId].slice(-MAX_HISTORY)
      updateNodeData(id, { mediaId, historyIds: newHistory })
      setHistoryIds(newHistory)
      // Signal that we want to clear imageB64 once historyPreview loads
      waitingForPreviewRef.current = true
    }

    // Track cost from API response or fall back to client-side estimate
    const actualUsage = r.usage
    const fallback = estimateCost(selectedModel, 'generate_image', rawPrompt, refs.length)
    const costUsd = actualUsage?.cost_usd ?? fallback.costUsd
    setLastCost(costUsd)
    useCanvasStore.getState().addCost({
      timestamp: new Date().toISOString(),
      nodeId: id,
      nodeName: 'Generate Image',
      model: modelInfo.name,
      inputTokens: actualUsage?.input_tokens ?? fallback.inputTokens,
      outputTokens: actualUsage?.output_tokens ?? fallback.outputTokens,
      costUsd,
    })
  }, [activePrompt, apiKey, bflApiKey, localServerUrl, modelInfo, id, updateNodeData, getNodes, getEdges, historyIds, selectedModel, setHistoryIds])

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    setBatchProgress(0)
    try {
      if (batchCount <= 1) {
        await runSingle()
        setBatchProgress(1)
      } else {
        // Snapshot current history before parallel calls
        const currentIds: string[] = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
        const accum: string[] = []
        batchHistoryRef.current = accum

        const promises = Array.from({ length: batchCount }, (_, i) =>
          runSingle(accum).then(() => {
            setBatchProgress(p => p + 1)
          }).catch(e => {
            const msg = e instanceof Error ? e.message : String(e)
            setError(prev => prev ? `${prev}\n#${i + 1}: ${msg}` : `#${i + 1}: ${msg}`)
          })
        )
        await Promise.all(promises)

        // Merge all results into history in one update
        const mergedHistory = [...currentIds, ...accum].slice(-MAX_HISTORY)
        updateNodeData(id, { historyIds: mergedHistory })
        setHistoryIds(mergedHistory)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
      setBatchProgress(0)
    }
  }, [batchCount, runSingle, id, getNodes, historyIds, updateNodeData, setHistoryIds])

  return (
    <NodeShell
      name="Generate Image"
      selected={selected}
      icon="✨"
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        ...imageSlots,
      ]}
      outputSlots={[
        { id: 'image-out', label: 'Image', type: 'image' },
      ]}
      onRun={run}
      running={loading}
      lastCost={lastCost}
      estimatedCost={estimatedLabel}
    >
      <div className={styles.nodeContent}>
        <select className={`${styles.select} ${modelInfo.deprecated ? styles.selectDeprecated : ''}`} value={selectedModel} onChange={e => { setSelectedModel(e.target.value); updateNodeData(id, { selectedModel: e.target.value }) }}>
          <optgroup label="Google Gemini">
            {IMAGE_MODELS.filter(m => m.provider === 'gemini').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name} ({m.price})</option>
            ))}
          </optgroup>
          <optgroup label="Google Imagen">
            {IMAGE_MODELS.filter(m => m.provider === 'imagen').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name} ({m.price})</option>
            ))}
          </optgroup>
          <optgroup label="Flux (fal.ai)">
            {IMAGE_MODELS.filter(m => m.provider === 'flux-cloud').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name} ({m.price})</option>
            ))}
          </optgroup>
          <optgroup label="Local GPU">
            {IMAGE_MODELS.filter(m => m.provider === 'local').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name} ({m.price})</option>
            ))}
          </optgroup>
        </select>
        {modelInfo.deprecated && (
          <div className={styles.deprecatedWarning}>Legacy model — consider switching to a 3.x version</div>
        )}
        <div className={styles.arResRow}>
          <select
            className={styles.selectSmall}
            value={aspectRatio}
            onChange={e => { setAspectRatio(e.target.value); updateNodeData(id, { aspectRatio: e.target.value }) }}
            title="Aspect Ratio"
          >
            {ASPECT_RATIOS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select
            className={styles.selectSmall}
            value={resolution}
            onChange={e => { setResolution(e.target.value); updateNodeData(id, { resolution: e.target.value }) }}
            title="Resolution"
          >
            {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <div className={styles.batchToggle}>
            {[1, 2, 4].map(n => (
              <button
                key={n}
                className={`${styles.batchBtn} ${batchCount === n ? styles.batchBtnActive : ''}`}
                onClick={() => setBatchCount(n)}
                title={n === 1 ? 'Single generation' : `Generate ${n} images in parallel`}
              >
                ×{n}
              </button>
            ))}
          </div>
        </div>
        {connectedImageCount >= 2 && (
          <button className={styles.swapBtn} onClick={swapRefs} title="Swap Ref 1 ↔ Ref 2">⇄</button>
        )}
        {hasPromptEdge ? (
          activePrompt && (
            <div className={styles.promptPreview} title={String(activePrompt)}>
              {String(activePrompt).slice(0, 120)}{String(activePrompt).length > 120 ? '…' : ''}
            </div>
          )
        ) : (
          <textarea
            className={styles.promptTextarea}
            value={localPrompt}
            onChange={e => { setLocalPrompt(e.target.value); updateNodeData(id, { prompt: e.target.value }) }}
            placeholder="Write your prompt here..."
            rows={3}
            spellCheck={false}
          />
        )}
        {loading && batchCount > 1 && (
          <div className={styles.batchProgress}>
            {batchProgress}/{batchCount}
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.previewArea}>
          {imageB64
            ? <img src={`data:image/png;base64,${imageB64}`} alt="generated" className={styles.previewImg} onClick={(e) => { e.stopPropagation(); openPreview(`data:image/png;base64,${imageB64}`, 'image', { mediaId: currentMediaId ?? undefined }) }} style={{ cursor: 'pointer' }} />
            : historyPreview
            ? <img src={historyPreview} alt="history" className={styles.previewImg} onClick={(e) => { e.stopPropagation(); openPreview(historyPreview, 'image', { mediaId: currentMediaId ?? undefined }) }} style={{ cursor: 'pointer' }} />
            : <span className={styles.dropHint}>{activePrompt ? 'Ready — click Run' : 'Write a prompt or connect one'}</span>
          }
          {currentMediaId && (imageB64 || historyPreview) && (
            <button
              className={`${styles.favBtn} ${reviewStatuses[currentMediaId]?.favorite ? styles.favBtnActive : ''}`}
              onClick={(e) => handleFavoriteToggle(currentMediaId, e)}
              title={reviewStatuses[currentMediaId]?.favorite ? 'Remove favorite' : 'Add favorite'}
            >{'\u2605'}</button>
          )}
        </div>

        {historyIds.length >= 1 && (
          <>
            <div className={styles.historyBar}>
              <button
                className={styles.historyArrow}
                onClick={() => navigateHistory(-1)}
                disabled={historyIndex <= 0}
              >&#8249;</button>
              <span className={styles.historyCount}>{historyIndex + 1} / {historyIds.length}</span>
              <button
                className={styles.historyArrow}
                onClick={() => navigateHistory(1)}
                disabled={historyIndex >= historyIds.length - 1}
              >&#8250;</button>
              <button
                className={`${styles.historyGridBtn} ${historyExpanded ? styles.historyGridBtnActive : ''}`}
                onClick={() => setHistoryExpanded(v => !v)}
                title="Browse history"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                  <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
                </svg>
              </button>
            </div>
            {historyExpanded && historyThumbs.length > 0 && (
              <div className={styles.historyGrid}>
                {[...historyThumbs].reverse().map((url, ri) => {
                  const i = historyThumbs.length - 1 - ri  // map back to original index
                  if (!url) return null
                  const mid = historyIds[i]
                  const review = mid ? reviewStatuses[mid] : null
                  return (
                    <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                      <img
                        src={url}
                        alt={`gen ${i + 1}`}
                        className={`${styles.historyThumb} ${historyIndex === i ? styles.historyThumbActive : ''}`}
                        onClick={() => { userNavigatedRef.current = true; setHistoryIndex(i) }}
                        onDoubleClick={(e) => { e.stopPropagation(); openPreview(url, 'image', { mediaId: historyIds[i] ?? undefined }) }}
                      />
                      {review?.status === 'approved' && (
                        <span
                          style={{ position: 'absolute', top: 2, right: 2, color: '#22c55e', fontSize: 14, lineHeight: 1, pointerEvents: 'none', textShadow: '0 0 2px rgba(0,0,0,0.7)' }}
                          title={review.reviewed_by ? `Approved by ${review.reviewed_by}` : 'Approved'}
                        >&#10003;</span>
                      )}
                      {review?.status === 'rejected' && (
                        <span
                          style={{ position: 'absolute', top: 2, right: 2, color: '#ef4444', fontSize: 14, lineHeight: 1, pointerEvents: 'none', textShadow: '0 0 2px rgba(0,0,0,0.7)' }}
                          title={review.reviewed_by ? `Rejected by ${review.reviewed_by}` : 'Rejected'}
                        >&#10007;</span>
                      )}
                      {mid && review?.favorite && (
                        <span
                          style={{ position: 'absolute', top: 2, left: 2, color: '#f59e0b', fontSize: 12, lineHeight: 1, cursor: 'pointer', textShadow: '0 0 2px rgba(0,0,0,0.7)' }}
                          onClick={(e) => { e.stopPropagation(); handleFavoriteToggle(mid, e) }}
                          title="Remove favorite"
                        >{'\u2605'}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(GenerateImageNode)
