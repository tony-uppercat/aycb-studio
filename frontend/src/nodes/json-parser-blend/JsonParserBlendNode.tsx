import { memo } from 'react'
import { type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { colorizeJson } from '../../utils/jsonColorize'
import { useJsonBlend } from './useJsonBlend'
import type { JsonParserBlendNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

type JsonParserBlendNodeType = Node<JsonParserBlendNodeData, 'jsonParserBlend'>

export function JsonParserBlendNode({ id, data, selected }: NodeProps<JsonParserBlendNodeType>) {
  const { openPreview } = useMediaPreview()
  const blend = useJsonBlend(id, data)

  const {
    inputSlots, allKeys, keyPresence, activeInputs, connectedIndices,
    sel, excludedKeys, outputLimit, setOutputLimit,
    outputFormat, setOutputFormat, overrides, setOverrides,
    editingKey, setEditingKey, escapedRef, effectiveSel, objects,
    output, resolveVal, toggle, swapInputs, toggleExclude,
    allIncluded, toggleAllExclusion,
  } = blend

  return (
    <NodeShell name="JSON Parser Blend" selected={selected} icon="\u{1F500}"
      inputSlots={inputSlots}
      outputSlots={[{ id: 'text-out', label: 'Output', type: 'text' }]}
    >
      <div className={styles.nodeContent}>
        {activeInputs === 0 ? (
          <p className={styles.infoBadge}>Connect JSON sources...</p>
        ) : allKeys.length === 0 ? (
          <p className={styles.infoBadge}>No top-level object keys found</p>
        ) : (
          <>
            <p className={styles.infoBadge}>
              {activeInputs} input{activeInputs > 1 ? 's' : ''} &middot; {allKeys.length} keys
            </p>

            <div className={styles.blendGrid}>
              <div className={styles.blendHeader}>
                <button className={styles.blendAllNone} onClick={toggleAllExclusion}
                  title={allIncluded ? 'Deselect all' : 'Select all'}>
                  {allIncluded ? 'None' : 'All'}
                </button>
                <span className={styles.blendLabel} style={{ flex: 1 }}>Key</span>
                {connectedIndices.map((ci, idx) => (
                  <span key={ci} style={{ display: 'contents' }}>
                    <span className={styles.blendLabel}>{ci + 1}</span>
                    {idx < connectedIndices.length - 1 && (
                      <button className={styles.blendAllNone}
                        style={{ fontSize: 8, padding: '0 1px', minWidth: 'unset', lineHeight: 1, opacity: 0.6 }}
                        onClick={() => swapInputs(ci, connectedIndices[idx + 1])}
                        title={`Swap ${ci + 1} \u21c4 ${connectedIndices[idx + 1] + 1}`}
                      >{'\u21c4'}</button>
                    )}
                  </span>
                ))}
                <span className={styles.blendLabel} style={{ flex: 1 }}>Value</span>
              </div>

              {allKeys.map(key => {
                const sources = keyPresence.get(key)!
                const cur = sel[key] ?? null
                const excluded = excludedKeys.has(key)
                const isOverridden = key in overrides
                const isEditing = editingKey === key
                const displayVal = resolveVal(key)
                const valPreview = displayVal.slice(0, 30) + (displayVal.length > 30 ? '\u2026' : '')

                return (
                  <div key={key} className={`${styles.blendRow} ${excluded ? styles.blendRowExcluded : ''}`}>
                    <button
                      className={`${styles.blendCheckbox} ${!excluded ? styles.blendCheckboxChecked : ''}`}
                      onClick={(e) => toggleExclude(key, e)}
                      title="Alt+Click to isolate"
                    />
                    <span className={`${styles.blendKey} ${excluded ? styles.blendKeyExcluded : ''}`}
                      style={{ flex: 1 }} title={key}>
                      {key}
                    </span>
                    {connectedIndices.map(ci => (
                      sources.has(ci) ? (
                        <button key={ci}
                          className={`${styles.blendToggle} ${cur === ci && !excluded ? styles.blendToggleActive : ''}`}
                          onClick={() => toggle(key, ci)}
                          disabled={excluded}
                        />
                      ) : (
                        <span key={ci} className={styles.blendTogglePlaceholder} />
                      )
                    ))}
                    {/* Spacers for swap buttons between columns */}
                    {connectedIndices.length > 1 && Array.from({ length: connectedIndices.length - 1 }, (_, i) => (
                      <span key={`sp-${i}`} style={{ width: 0 }} />
                    ))}
                    {isEditing ? (
                      <input
                        className={styles.blendKey}
                        style={{ color: '#d97706', fontSize: 9, background: '#2a2a30', border: '1px solid #d97706', borderRadius: 3, padding: '1px 3px', flex: 1, outline: 'none' }}
                        autoFocus
                        defaultValue={displayVal}
                        onBlur={(ev) => {
                          if (escapedRef.current) { escapedRef.current = false; return }
                          const newVal = ev.target.value
                          const origWithout = (() => {
                            const src = effectiveSel[key]
                            if (src === null || src === undefined) return ''
                            const obj = objects[src]
                            if (!obj || !(key in obj)) return ''
                            const v = obj[key]
                            return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
                          })()
                          if (newVal !== origWithout) {
                            setOverrides(prev => ({ ...prev, [key]: newVal }))
                          } else {
                            setOverrides(prev => { const next = { ...prev }; delete next[key]; return next })
                          }
                          setEditingKey(null)
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                          if (ev.key === 'Escape') { escapedRef.current = true; setEditingKey(null) }
                        }}
                      />
                    ) : (
                      <span className={styles.blendKey}
                        style={{ color: isOverridden ? '#d97706' : '#888', fontSize: 9, cursor: 'pointer', flex: 1 }}
                        title={`${displayVal}\n\nClick to edit${isOverridden ? ' \u2014 Right-click to reset' : ''}`}
                        onClick={() => setEditingKey(key)}
                        onContextMenu={isOverridden ? (ev) => {
                          ev.preventDefault()
                          setOverrides(prev => { const next = { ...prev }; delete next[key]; return next })
                        } : undefined}
                      >
                        {isOverridden && '\u270e '}{valPreview}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Limiter + output format */}
            <div className={styles.blendLimiter}>
              <span className={styles.blendLimiterLabel}>Limit</span>
              <input type="number" className={styles.blendLimiterInput}
                value={outputLimit} min={0} step={1}
                onChange={e => setOutputLimit(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                title="Max keys in output (0 = unlimited)"
              />
              {outputLimit > 0 && <span className={styles.blendLimiterHint}>first {outputLimit}</span>}
            </div>
            <div className={styles.row}>
              <button className={`${styles.toggleBtn} ${outputFormat === 'json' ? styles.toggleActive : ''}`}
                onClick={() => setOutputFormat('json')}>JSON</button>
              <button className={`${styles.toggleBtn} ${outputFormat === 'values' ? styles.toggleActive : ''}`}
                onClick={() => setOutputFormat('values')}>Values</button>
              <button className={`${styles.toggleBtn} ${outputFormat === 'kv' ? styles.toggleActive : ''}`}
                onClick={() => setOutputFormat('kv')}>Key: Val</button>
            </div>
          </>
        )}

        {output && (
          <div className={styles.expandWrap}>
            <pre className={styles.resultArea}
              style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              dangerouslySetInnerHTML={{ __html: colorizeJson(output) }}
            />
            <button className={styles.expandBtn}
              onClick={(e) => { e.stopPropagation(); openPreview(output, 'text') }}
              title="Full screen">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(JsonParserBlendNode)
