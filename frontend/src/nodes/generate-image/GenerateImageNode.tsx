import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import type { GenerateImageNodeData } from '../../types'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { useGenerateImage, IMAGE_MODELS, ASPECT_RATIOS, RESOLUTIONS } from './useGenerateImage'
import styles from '../_shared/Node.module.css'

type GenerateImageNodeType = Node<GenerateImageNodeData, 'generateImage'>

export function GenerateImageNode({ id, data, selected }: NodeProps<GenerateImageNodeType>) {
  const { openPreview } = useMediaPreview()
  const h = useGenerateImage(id, data, selected)

  return (
    <NodeShell
      name="Generate Image"
      selected={selected}
      icon="✨"
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        ...h.imageSlots,
      ]}
      outputSlots={[
        { id: 'image-out', label: 'Image', type: 'image' },
      ]}
      onRun={h.run}
      running={h.loading}
      lastCost={h.lastCost}
      estimatedCost={h.estimatedLabel}
    >
      <div className={styles.nodeContent}>
        <select
          className={`${styles.select} ${h.modelInfo.deprecated ? styles.selectDeprecated : ''}`}
          value={h.selectedModel}
          onChange={e => { h.setSelectedModel(e.target.value); h.updateNodeData(id, { selectedModel: e.target.value }) }}
        >
          <optgroup label="Google Gemini">
            {IMAGE_MODELS.filter(m => m.provider === 'gemini').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name} ({m.price})</option>
            ))}
          </optgroup>
          <optgroup label="Google Imagen">
            {IMAGE_MODELS.filter(m => m.provider === 'imagen').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.name} ({m.price})</option>
            ))}
          </optgroup>
          <optgroup label="Flux (fal.ai)">
            {IMAGE_MODELS.filter(m => m.provider === 'flux-cloud').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.name} ({m.price})</option>
            ))}
          </optgroup>
          <optgroup label="Local GPU">
            {IMAGE_MODELS.filter(m => m.provider === 'local').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.name} ({m.price})</option>
            ))}
          </optgroup>
        </select>
        {h.modelInfo.deprecated && (
          <div className={styles.deprecatedWarning}>Legacy model — consider switching to a 3.x version</div>
        )}
        <div className={styles.arResRow}>
          <select className={styles.selectSmall} value={h.aspectRatio}
            onChange={e => { h.setAspectRatio(e.target.value); h.updateNodeData(id, { aspectRatio: e.target.value }) }}
            title="Aspect Ratio">
            {ASPECT_RATIOS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select className={styles.selectSmall} value={h.resolution}
            onChange={e => { h.setResolution(e.target.value); h.updateNodeData(id, { resolution: e.target.value }) }}
            title="Resolution">
            {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <div className={styles.batchToggle}>
            {[1, 2, 4].map(n => (
              <button key={n}
                className={`${styles.batchBtn} ${h.batchCount === n ? styles.batchBtnActive : ''}`}
                onClick={() => h.setBatchCount(n)}
                title={n === 1 ? 'Single generation' : `Generate ${n} images in parallel`}
              >×{n}</button>
            ))}
          </div>
        </div>
        {h.connectedImageCount >= 2 && (
          <button className={styles.swapBtn} onClick={h.swapRefs} title="Swap Ref 1 ↔ Ref 2">⇄</button>
        )}
        {h.hasPromptEdge ? (
          h.activePrompt && (
            <div className={styles.promptPreview} title={String(h.activePrompt)}>
              {String(h.activePrompt).slice(0, 120)}{String(h.activePrompt).length > 120 ? '…' : ''}
            </div>
          )
        ) : (
          <textarea className={styles.promptTextarea} value={h.localPrompt}
            onChange={e => { h.setLocalPrompt(e.target.value); h.updateNodeData(id, { prompt: e.target.value }) }}
            placeholder="Write your prompt here..." rows={3} spellCheck={false} />
        )}
        {h.loading && h.batchCount > 1 && (
          <div className={styles.batchProgress}>{h.batchProgress}/{h.batchCount}</div>
        )}
        {h.error && <p className={styles.error}>{h.error}</p>}
        <div className={styles.previewArea}>
          {h.imageB64
            ? <img src={`data:image/png;base64,${h.imageB64}`} alt="generated" className={styles.previewImg}
                onClick={e => { e.stopPropagation(); openPreview(`data:image/png;base64,${h.imageB64}`, 'image', { mediaId: h.currentMediaId ?? undefined }) }}
                style={{ cursor: 'pointer' }} />
            : h.historyPreview
            ? <img src={h.historyPreview} alt="history" className={styles.previewImg}
                onClick={e => { e.stopPropagation(); openPreview(h.historyPreview!, 'image', { mediaId: h.currentMediaId ?? undefined }) }}
                style={{ cursor: 'pointer' }} />
            : <span className={styles.dropHint}>{h.activePrompt ? 'Ready — click Run' : 'Write a prompt or connect one'}</span>
          }
          {h.currentMediaId && (h.imageB64 || h.historyPreview) && (
            <button
              className={`${styles.favBtn} ${h.reviewStatuses[h.currentMediaId]?.favorite ? styles.favBtnActive : ''}`}
              onClick={e => h.handleFavoriteToggle(h.currentMediaId!, e)}
              title={h.reviewStatuses[h.currentMediaId]?.favorite ? 'Remove favorite' : 'Add favorite'}
            >{'\u2605'}</button>
          )}
        </div>

        {h.historyIds.length >= 1 && (
          <>
            <div className={styles.historyBar}>
              <button className={styles.historyArrow} onClick={() => h.navigateHistory(-1)}
                disabled={h.historyIndex <= 0}>&#8249;</button>
              <span className={styles.historyCount}>{h.historyIndex + 1} / {h.historyIds.length}</span>
              <button className={styles.historyArrow} onClick={() => h.navigateHistory(1)}
                disabled={h.historyIndex >= h.historyIds.length - 1}>&#8250;</button>
              <button
                className={`${styles.historyGridBtn} ${h.historyExpanded ? styles.historyGridBtnActive : ''}`}
                onClick={() => h.setHistoryExpanded(v => !v)} title="Browse history">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                  <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
                </svg>
              </button>
            </div>
            {h.historyExpanded && h.historyThumbs.length > 0 && (
              <div className={styles.historyGrid}>
                {[...h.historyThumbs].reverse().map((url, ri) => {
                  const i = h.historyThumbs.length - 1 - ri
                  if (!url) return null
                  const mid = h.historyIds[i]
                  const review = mid ? h.reviewStatuses[mid] : null
                  return (
                    <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={url} alt={`gen ${i + 1}`}
                        className={`${styles.historyThumb} ${h.historyIndex === i ? styles.historyThumbActive : ''}`}
                        onClick={() => { h.userNavigatedRef.current = true; h.setHistoryIndex(i) }}
                        onDoubleClick={e => { e.stopPropagation(); openPreview(url, 'image', { mediaId: h.historyIds[i] ?? undefined }) }}
                      />
                      {review?.status === 'approved' && (
                        <span style={{ position: 'absolute', top: 2, right: 2, color: '#22c55e', fontSize: 14, lineHeight: 1, pointerEvents: 'none', textShadow: '0 0 2px rgba(0,0,0,0.7)' }}
                          title={review.reviewed_by ? `Approved by ${review.reviewed_by}` : 'Approved'}>&#10003;</span>
                      )}
                      {review?.status === 'rejected' && (
                        <span style={{ position: 'absolute', top: 2, right: 2, color: '#ef4444', fontSize: 14, lineHeight: 1, pointerEvents: 'none', textShadow: '0 0 2px rgba(0,0,0,0.7)' }}
                          title={review.reviewed_by ? `Rejected by ${review.reviewed_by}` : 'Rejected'}>&#10007;</span>
                      )}
                      {mid && review?.favorite && (
                        <span style={{ position: 'absolute', top: 2, left: 2, color: '#f59e0b', fontSize: 12, lineHeight: 1, cursor: 'pointer', textShadow: '0 0 2px rgba(0,0,0,0.7)' }}
                          onClick={e => { e.stopPropagation(); h.handleFavoriteToggle(mid, e) }}
                          title="Remove favorite">{'\u2605'}</span>
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
