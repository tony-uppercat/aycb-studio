import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { colorizeJson } from '../../utils/jsonColorize'
import type { JsonParserNodeData } from '../../types'
import { useJsonParser } from './useJsonParser'
import styles from '../_shared/Node.module.css'

type JsonParserNodeType = Node<JsonParserNodeData, 'jsonParser'>

export function JsonParserNode({ id, data, selected }: NodeProps<JsonParserNodeType>) {
  const h = useJsonParser(id, data)

  return (
    <NodeShell name="JSON Parser" selected={selected} icon="🔧"
      inputSlots={[{ id: 'text-in', label: 'JSON Input', type: 'text' }]}
      outputSlots={h.outputSlots}
      onRun={h.handleRun}
    >
      <div className={styles.nodeContent}>
        {/* Mode toggles: Connected/Manual + JSON/Newline */}
        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${!h.manualMode ? styles.toggleActive : ''}`}
            onClick={() => h.setManualMode(false)}>Connected</button>
          <button className={`${styles.toggleBtn} ${h.manualMode ? styles.toggleActive : ''}`}
            onClick={() => h.setManualMode(true)}>Manual</button>
        </div>
        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${h.parseMode === 'json' ? styles.toggleActive : ''}`}
            onClick={() => h.setParseMode('json')}>JSON</button>
          <button className={`${styles.toggleBtn} ${h.parseMode === 'newline' ? styles.toggleActive : ''}`}
            onClick={() => h.setParseMode('newline')}>Newline</button>
          {h.parseMode === 'json' && (
            <button className={`${styles.toggleBtn} ${h.flatten ? styles.toggleActive : ''}`}
              onClick={() => { h.setFlatten(f => !f); h.setExcludedKeys(new Set()); h.setExcludedSections(new Set()) }}
              title="Flatten nested objects into dot-notation keys">Flatten</button>
          )}
        </div>

        <p className={styles.infoBadge}>
          {!h.inputText.trim()
            ? '⏳ Waiting for input...'
            : !h.result.ok
            ? `⚠ ${h.result.error}`
            : Array.isArray(h.result.value)
            ? `📋 Array [${(h.result.value as unknown[]).length} items]`
            : h.result.value !== null && typeof h.result.value === 'object'
            ? `📦 Object {${Object.keys(h.result.value as Record<string, unknown>).length} keys}`
            : typeof h.result.value === 'string'
            ? `📝 String (${(h.result.value as string).length} chars)`
            : `✓ ${typeof h.result.value}`
          }
        </p>

        {h.manualMode && (
          <textarea className={styles.promptInput} placeholder="Paste JSON here..."
            value={h.manualInput} onChange={e => h.setManualInput(e.target.value)} rows={4} />
        )}

        {h.parseMode === 'json' && (
          <input className={styles.promptInput} style={{ minHeight: 'unset', flex: 'none' }}
            type="text" placeholder="Path (e.g. data.items[0].name)"
            value={h.path} onChange={e => h.setPath(e.target.value)} />
        )}

        {/* Depth slider */}
        {h.parseMode === 'json' && (
          <div className={styles.blendLimiter}>
            <span className={styles.blendLimiterLabel}>Depth</span>
            <input
              type="range"
              min={0} max={10} step={1}
              value={h.maxDepth}
              onChange={e => { h.setMaxDepth(Number(e.target.value)); h.setExcludedKeys(new Set()); h.setExcludedSections(new Set()) }}
              style={{ flex: 1, height: 14, accentColor: '#f59e0b', cursor: 'pointer' }}
              title={h.maxDepth === 0 ? 'Depth: unlimited' : `Depth: ${h.maxDepth}`}
            />
            <span className={styles.blendLimiterHint} style={{ minWidth: 28, textAlign: 'right' }}>
              {h.maxDepth === 0 ? 'All' : h.maxDepth}
            </span>
          </div>
        )}

        {!h.result.ok && <p className={styles.error}>{h.result.error}</p>}
        {h.unpackError && <p className={styles.error}>{h.unpackError}</p>}

        {/* Section filter (flatten mode only) */}
        {h.flatten && h.sections.length > 0 && (
          <div className={styles.row} style={{ flexWrap: 'wrap', gap: 2 }}>
            {h.sections.map(s => {
              const excluded = h.excludedSections.has(s)
              return (
                <button key={s}
                  className={`${styles.toggleBtn} ${!excluded ? styles.toggleActive : ''}`}
                  style={{ fontSize: 9, padding: '1px 5px', opacity: excluded ? 0.4 : 1 }}
                  onClick={(e) => h.toggleSection(s, e)}
                  title={`${excluded ? 'Show' : 'Hide'} ${s} — Alt+Click to isolate`}
                >{s}</button>
              )
            })}
          </div>
        )}

        {/* Key selector + limiter (when we have entries) */}
        {h.visibleEntries.length > 0 && (
          <>
            <div className={styles.blendGrid}>
              <div className={styles.blendHeader}>
                <button className={styles.blendAllNone} onClick={h.toggleAllExclusion}>
                  {h.allIncluded ? 'None' : 'All'}
                </button>
                <span className={styles.blendLabel}>Key</span>
                <span className={styles.blendLabel}>Value</span>
              </div>
              {h.visibleEntries.map(entry => {
                const excluded = h.excludedKeys.has(entry.key)
                const isEditing = h.editingKey === entry.key
                const isOverridden = entry.key in h.overrides
                const displayVal = h.resolveVal(entry)
                const valPreview = displayVal.slice(0, 40) + (displayVal.length > 40 ? '...' : '')
                return (
                  <div key={entry.key} className={`${styles.blendRow} ${excluded ? styles.blendRowExcluded : ''}`}>
                    <button
                      className={`${styles.blendCheckbox} ${!excluded ? styles.blendCheckboxChecked : ''}`}
                      onClick={(e) => h.toggleExclude(entry.key, e)}
                      title="Alt+Click to isolate"
                    />
                    <span className={`${styles.blendKey} ${excluded ? styles.blendKeyExcluded : ''}`} title={entry.key}>
                      {h.entryLabel(entry)}
                    </span>
                    {isEditing ? (
                      <input
                        className={styles.blendKey}
                        style={{ color: '#d97706', fontSize: 9, background: '#2a2a30', border: '1px solid #d97706', borderRadius: 3, padding: '1px 3px', flex: 1, outline: 'none' }}
                        autoFocus
                        defaultValue={displayVal}
                        onBlur={(e) => {
                          if (h.escapedRef.current) { h.escapedRef.current = false; return }
                          const newVal = e.target.value
                          const originalVal = typeof entry.val === 'string' ? entry.val : JSON.stringify(entry.val, null, 2)
                          if (newVal !== originalVal) {
                            h.setOverrides(prev => ({ ...prev, [entry.key]: newVal }))
                          } else {
                            h.setOverrides(prev => { const next = { ...prev }; delete next[entry.key]; return next })
                          }
                          h.setEditingKey(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') { h.escapedRef.current = true; h.setEditingKey(null) }
                        }}
                      />
                    ) : (
                      <span
                        className={styles.blendKey}
                        style={{ color: isOverridden ? '#d97706' : '#888', fontSize: 9, cursor: 'pointer' }}
                        title={`${displayVal}\n\nClick to edit${isOverridden ? ' — Right-click to reset' : ''}`}
                        onClick={() => h.setEditingKey(entry.key)}
                        onContextMenu={isOverridden ? (e) => {
                          e.preventDefault()
                          h.setOverrides(prev => { const next = { ...prev }; delete next[entry.key]; return next })
                        } : undefined}
                      >
                        {isOverridden && '✎ '}{valPreview}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            <div className={styles.blendLimiter}>
              <span className={styles.blendLimiterLabel}>Limit</span>
              <input className={styles.blendLimiterInput} type="number" min={0} max={999}
                value={h.outputLimit} onChange={e => h.setOutputLimit(Math.max(0, Number(e.target.value)))} />
              {h.outputLimit > 0 && <span className={styles.blendLimiterHint}>first {h.outputLimit}</span>}
            </div>
            <div className={styles.row}>
              <button className={`${styles.toggleBtn} ${h.outputFormat === 'values' ? styles.toggleActive : ''}`}
                onClick={() => h.setOutputFormat('values')}>Values</button>
              <button className={`${styles.toggleBtn} ${h.outputFormat === 'kv' ? styles.toggleActive : ''}`}
                onClick={() => h.setOutputFormat('kv')}>Key: Val</button>
              <button className={`${styles.toggleBtn} ${h.outputFormat === 'json' ? styles.toggleActive : ''}`}
                onClick={() => h.setOutputFormat('json')}>JSON</button>
            </div>
          </>
        )}

        {/* Colorized JSON output — click to edit override */}
        {h.effectiveOutput && (
          h.editingOutput ? (
            <textarea
              ref={h.outputTextareaRef}
              className={`${styles.resultArea} nokey`}
              style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto', resize: 'vertical', color: '#d97706', flex: 'none', height: h.previewSize?.h ?? 60, width: h.previewSize?.w ?? '100%', minHeight: 40, boxSizing: 'border-box' }}
              defaultValue={h.effectiveOutput}
              autoFocus
              onBlur={(e) => {
                const val = e.target.value
                const computed = h.visibleEntries.length > 0 ? h.filteredOutput : (h.result.ok ? h.result.display : '')
                h.setOutputOverride(val === computed ? null : val)
                h.setEditingOutput(false)
                h.setPreviewSize(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  h.setEditingOutput(false)
                  h.setPreviewSize(null)
                }
              }}
            />
          ) : (
            <pre ref={h.previewRef} className={styles.resultArea}
              style={{
                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1, minHeight: 40, overflow: 'auto', cursor: 'text',
                borderColor: h.outputOverride !== null ? '#d97706' : undefined,
              }}
              dangerouslySetInnerHTML={{ __html: colorizeJson(h.effectiveOutput) }}
              onClick={() => {
                if (h.previewRef.current) h.setPreviewSize({ w: h.previewRef.current.offsetWidth, h: h.previewRef.current.offsetHeight })
                h.setEditingOutput(true)
              }}
              title={h.outputOverride !== null ? 'Overridden — click to edit, right-click to reset' : 'Click to edit output'}
              onContextMenu={h.outputOverride !== null ? (e) => {
                e.preventDefault()
                h.setOutputOverride(null)
              } : undefined}
            />
          )
        )}
        {h.outputOverride !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#d97706' }}>
            <span>✎ Output overridden</span>
            <button
              className={styles.toggleBtn}
              style={{ fontSize: 8, padding: '0 4px', color: '#888' }}
              onClick={() => h.setOutputOverride(null)}
              title="Reset to computed output"
            >Reset</button>
          </div>
        )}

        <div className={styles.row} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {h.includedEntries.length > 1 && (
            <button
              className={`${styles.subtleToggle} ${h.pinsCollapsed ? '' : styles.subtleToggleOn}`}
              onClick={() => {
                h.setPinsCollapsed(v => !v)
                h.updateNodeData(id, { pinsCollapsed: !h.pinsCollapsed })
                h.updateNodeInternals(id)
              }}
              title={h.pinsCollapsed ? 'Expand output pins' : 'Collapse output pins'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {h.pinsCollapsed
                  ? <><polyline points="6 9 12 15 18 9" /></>
                  : <><polyline points="18 15 12 9 6 15" /></>
                }
              </svg>
            </button>
          )}
          <button className={styles.unpackBtn} onClick={h.unpack}
            title="Create a text node for each item (live — updates when JSON changes)">
            Unpack {h.includedEntries.length > 0 ? `(${h.includedEntries.length})` : ''}
          </button>
        </div>
      </div>
    </NodeShell>
  )
}

export default memo(JsonParserNode)
