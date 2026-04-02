import type { NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { colorizeJson } from '../../utils/jsonColorize'
import styles from '../_shared/Node.module.css'
import nodeStyles from './VideoAnalysisNode.module.css'
import {
  useVideoAnalysis,
  VIDEO_ANALYSIS_MODELS,
  MAX_FRAMES_OPTIONS,
} from './useVideoAnalysis'

// ── Component ─────────────────────────────────────────────────────────────────

export function VideoAnalysisNode({ id, data, selected }: NodeProps) {
  const { openPreview } = useMediaPreview()
  const {
    selectedModel, maxFrames, extractionMode, cutSensitivity,
    loading, error, lastCost, resultText, frameThumbs, jsonOutput,
    hasPromptEdge, modelInfo, estimatedLabel,
    run,
    updateModel, updateMaxFrames, updateExtractionMode, updateCutSensitivity,
  } = useVideoAnalysis(id, data)

  return (
    <NodeShell
      name="Video Analysis"
      selected={selected}
      icon="🎞"
      inputSlots={[
        { id: 'video-in', label: 'Video', type: 'video', required: true },
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
      ]}
      outputSlots={[
        { id: 'text-out', label: 'Text', type: 'text' },
        { id: 'json-out', label: 'JSON', type: 'text' },
      ]}
      onRun={run}
      running={loading}
      lastCost={lastCost}
      estimatedCost={estimatedLabel}
    >
      <div className={styles.nodeContent}>

        {/* Model dropdown */}
        <select
          className={`${styles.select} ${modelInfo.deprecated ? styles.selectDeprecated : ''}`}
          value={selectedModel}
          onChange={e => updateModel(e.target.value)}
        >
          <optgroup label="Gemini (Google)">
            {VIDEO_ANALYSIS_MODELS.map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>
                {m.deprecated ? '[LEGACY] ' : ''}{m.name}
              </option>
            ))}
          </optgroup>
        </select>
        {modelInfo.deprecated && (
          <div className={styles.deprecatedWarning}>Legacy model — consider switching to a 3.x version</div>
        )}

        {/* Controls row: Max Frames (sharpness only) + Extraction Mode */}
        <div className={nodeStyles.controlsRow}>
          {extractionMode === 'sharpness' && (
            <div className={nodeStyles.controlGroup}>
              <span className={nodeStyles.controlLabel}>Frames</span>
              <select
                className={nodeStyles.selectTiny}
                value={maxFrames}
                onChange={e => updateMaxFrames(Number(e.target.value))}
                title="Max frames to extract"
              >
                {MAX_FRAMES_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
          {extractionMode === 'cuts' && (
            <div className={nodeStyles.controlGroup}>
              <span className={nodeStyles.controlLabel} style={{ color: '#f59e0b', fontSize: 10 }}>Auto frames (1 per cut)</span>
            </div>
          )}

          <div className={nodeStyles.modeToggle}>
            <button
              className={`${nodeStyles.modeBtn} ${extractionMode === 'sharpness' ? nodeStyles.modeBtnActive : ''}`}
              onClick={() => updateExtractionMode('sharpness')}
              title="Select sharpest frames"
            >
              Sharp
            </button>
            <button
              className={`${nodeStyles.modeBtn} ${extractionMode === 'cuts' ? nodeStyles.modeBtnActive : ''}`}
              onClick={() => updateExtractionMode('cuts')}
              title="Detect scene cuts"
            >
              Cuts
            </button>
          </div>
        </div>

        {/* Cut sensitivity slider — only visible in Cuts mode */}
        {extractionMode === 'cuts' && (
          <div className={nodeStyles.sliderRow}>
            <span className={nodeStyles.sliderLabel}>Sensitivity</span>
            <input
              type="range"
              className={styles.effectSlider}
              min={0.1}
              max={0.9}
              step={0.1}
              value={cutSensitivity}
              onChange={e => updateCutSensitivity(Number(e.target.value))}
              title={`Cut sensitivity: ${cutSensitivity.toFixed(1)}`}
            />
            <span className={nodeStyles.sliderValue}>{cutSensitivity.toFixed(1)}</span>
          </div>
        )}

        {/* Connected prompt indicator */}
        {hasPromptEdge && (
          <div className={nodeStyles.promptBadge}>Custom prompt connected</div>
        )}

        {/* Error */}
        {error && <p className={styles.error}>{error}</p>}

        {/* Frame thumbnails strip */}
        {frameThumbs.length > 0 && (
          <div className={nodeStyles.frameThumbs}>
            {frameThumbs.map((frame, i) => (
              <div key={i} className={nodeStyles.frameItem}>
                <img
                  src={`data:image/jpeg;base64,${frame.b64}`}
                  alt={frame.label}
                  className={nodeStyles.frameThumb}
                  title={frame.label}
                />
                <span className={nodeStyles.frameLabel}>
                  {frame.label.replace(/^F\d+\s*/, '')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Colorized JSON output */}
        {jsonOutput && (
          <div className={styles.expandWrap}>
            <pre
              className={styles.resultArea}
              style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 150, overflow: 'auto' }}
              dangerouslySetInnerHTML={{ __html: colorizeJson(jsonOutput) }}
            />
            <button
              className={styles.expandBtn}
              onClick={(e) => { e.stopPropagation(); openPreview(jsonOutput, 'text') }}
              title="Full screen"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          </div>
        )}

        {!resultText && frameThumbs.length === 0 && (
          <div className={styles.previewArea}>
            <span className={styles.dropHint}>
              Connect a video and click Run
            </span>
          </div>
        )}

      </div>
    </NodeShell>
  )
}

export default VideoAnalysisNode
