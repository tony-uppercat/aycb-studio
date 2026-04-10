import { memo, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { useGenerateVideo, VIDEO_MODELS } from './useGenerateVideo'
import { priceTier } from '../_shared/types'
import type { GenerateVideoNodeData } from '../../types'
import styles from '../_shared/Node.module.css'
import nodeStyles from './GenerateVideoNode.module.css'

export function GenerateVideoNode({ id, data, selected }: NodeProps) {
  const d = data as GenerateVideoNodeData
  const { updateNodeData } = useReactFlow()
  const { openPreview } = useMediaPreview()

  const vid = useGenerateVideo(id, d)

  const PROVIDERS = [
    { id: 'fal', label: 'fal.ai' },
    { id: 'atlas', label: 'Atlas' },
    { id: 'piapi', label: 'PiAPI' },
  ]
  const [activeProvider, setActiveProvider] = useState(
    () => VIDEO_MODELS.find(m => m.id === (d.selectedModel ?? 'atlas-seedance-2.0'))?.provider ?? 'atlas'
  )
  const filteredModels = VIDEO_MODELS.filter(m => m.provider === activeProvider)

  const {
    localPrompt, setLocalPrompt,
    selectedModel, setSelectedModel,
    aspectRatio, setAspectRatio,
    duration, setDuration,
    quality, setQuality,
    loading, error, status, videoUrl, requestId,
    pollElapsed,
    modelInfo,
    imageSlots,
    hasPromptEdge,
    activePrompt, mode,
    run,
    activeApiKey,
    lastCost,
    estimatedCost,
    historyIds, historyIndex, navigateHistory,
  } = vid

  const statusClass =
    status === 'completed' ? nodeStyles.statusComplete :
    status === 'failed' ? nodeStyles.statusError :
    loading ? nodeStyles.statusProcessing :
    status ? nodeStyles.statusPending : ''

  return (
    <NodeShell
      name="Generate Video"
      selected={selected}
      icon="\u{1F39E}"
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        ...imageSlots,
        { id: 'video-ref', label: 'Video Ref', type: 'video' },
        { id: 'audio-ref', label: 'Audio URL', type: 'text' },
      ]}
      outputSlots={[
        { id: 'video-out', label: 'Video', type: 'video' },
      ]}
      onRun={run}
      running={loading}
      lastCost={lastCost}
      estimatedCost={estimatedCost}
    >
      <div className={styles.nodeContent}>

        {/* Provider filter */}
        <div className={nodeStyles.providerRow}>
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              className={`${nodeStyles.providerBtn} ${activeProvider === p.id ? nodeStyles.providerBtnActive : ''}`}
              onClick={() => {
                setActiveProvider(p.id)
                const first = VIDEO_MODELS.find(m => m.provider === p.id)
                if (first && modelInfo.provider !== p.id) {
                  setSelectedModel(first.id)
                  updateNodeData(id, { selectedModel: first.id })
                }
              }}
            >{p.label}</button>
          ))}
        </div>

        {/* Model selector */}
        <select
          className={`${styles.select} ${styles[priceTier(modelInfo.cost, 0.10, 1)]}`}
          value={selectedModel}
          onChange={e => {
            setSelectedModel(e.target.value)
            updateNodeData(id, { selectedModel: e.target.value })
          }}
        >
          {filteredModels.map(m => (
            <option key={m.id} value={m.id} title={m.tooltip}>
              {m.name} ({m.price})
            </option>
          ))}
        </select>

        {/* Prompt textarea (only when no prompt connected) */}
        {!hasPromptEdge && (
          <textarea
            className={`${styles.resultArea} nodrag nowheel nokey`}
            rows={2}
            placeholder="Describe the video to generate..."
            value={localPrompt}
            onChange={e => {
              setLocalPrompt(e.target.value)
              updateNodeData(id, { prompt: e.target.value })
            }}
          />
        )}

        {/* Connected prompt preview */}
        {hasPromptEdge && activePrompt && (
          <div className={styles.resultArea} style={{ maxHeight: 40, overflow: 'auto', fontSize: 10, color: '#888' }}>
            {activePrompt.slice(0, 200)}{activePrompt.length > 200 ? '...' : ''}
          </div>
        )}

        {/* Mode indicator */}
        <div className={nodeStyles.controlsRow}>
          <div className={nodeStyles.modeToggle}>
            <span className={`${nodeStyles.modeBtn} ${mode === 't2v' ? nodeStyles.modeBtnActive : ''}`}>
              Text{'\u2192'}Video
            </span>
            <span className={`${nodeStyles.modeBtn} ${mode === 'multi-ref' ? nodeStyles.modeBtnActive : ''}`}>
              Multi-Ref
            </span>
          </div>
        </div>

        {/* Aspect Ratio + Quality */}
        <div className={nodeStyles.controlsRow}>
          <div className={nodeStyles.controlGroup}>
            <span className={nodeStyles.controlLabel}>Ratio</span>
            <select
              className={nodeStyles.selectSmall}
              value={aspectRatio}
              onChange={e => {
                setAspectRatio(e.target.value)
                updateNodeData(id, { aspectRatio: e.target.value })
              }}
            >
              {modelInfo.ratios.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {modelInfo.qualities.length > 1 && (
            <div className={nodeStyles.controlGroup}>
              <span className={nodeStyles.controlLabel}>Quality</span>
              <select
                className={nodeStyles.selectSmall}
                value={quality}
                onChange={e => {
                  setQuality(e.target.value)
                  updateNodeData(id, { quality: e.target.value })
                }}
              >
                {modelInfo.qualities.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Duration slider */}
        <div className={nodeStyles.durationSlider}>
          <span className={nodeStyles.controlLabel}>Duration</span>
          <input
            type="range"
            className={`${nodeStyles.slider} nodrag`}
            min={modelInfo.minDuration}
            max={modelInfo.maxDuration}
            step={1}
            value={duration}
            onChange={e => {
              const v = Number(e.target.value)
              setDuration(v)
              updateNodeData(id, { duration: v })
            }}
          />
          <span className={nodeStyles.sliderValue}>{duration}s</span>
        </div>

        {/* Status bar */}
        {status && (
          <div className={`${nodeStyles.statusBar} ${statusClass}`}>
            {loading && <span className={nodeStyles.spinner} />}
            <span>{status === 'completed' ? 'Video ready' : status}</span>
            {loading && pollElapsed > 0 && (
              <span className={nodeStyles.progressText}>{pollElapsed}s</span>
            )}
          </div>
        )}

        {/* Error */}
        {error && <p className={styles.error}>{error}</p>}

        {/* Video preview */}
        {videoUrl && (
          <div className={nodeStyles.videoPreview}>
            <video
              className={nodeStyles.videoEl}
              src={videoUrl}
              controls
              muted
              loop
              onDoubleClick={() => openPreview(videoUrl, 'video')}
            />
            <a
              className={nodeStyles.downloadBtn}
              href={videoUrl}
              download={`video_${requestId}.mp4`}
              onClick={e => e.stopPropagation()}
            >
              Download
            </a>
          </div>
        )}

        {/* History bar */}
        {historyIds.length > 1 && (
          <div className={styles.historyBar}>
            <button className={styles.historyArrow} onClick={() => navigateHistory(-1)}
              disabled={historyIndex <= 0}>&#8249;</button>
            <span className={styles.historyCount}>{historyIndex + 1} / {historyIds.length}</span>
            <button className={styles.historyArrow} onClick={() => navigateHistory(1)}
              disabled={historyIndex >= historyIds.length - 1}>&#8250;</button>
          </div>
        )}

        {/* Placeholder */}
        {!videoUrl && !loading && !status && (
          <div className={styles.previewArea}>
            <span className={styles.dropHint}>
              {!activeApiKey ? 'Set PiAPI key in Settings' : 'Write a prompt and click Run'}
            </span>
          </div>
        )}

      </div>
    </NodeShell>
  )
}

export default memo(GenerateVideoNode)
