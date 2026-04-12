import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { escapeHtml } from '../../utils/jsonColorize'
import type { BracketParserNodeData } from '../../types'
import { useBracketParser } from './useBracketParser'
import styles from '../_shared/Node.module.css'

type BracketParserNodeType = Node<BracketParserNodeData, 'bracketParser'>

/** Highlight replaced values or remaining [brackets] in template output */
function colorizeTemplate(text: string): string {
  const safe = escapeHtml(text)
  // Remaining unreplaced [brackets] are purple, everything else is plain
  return safe.replace(/\[([^\[\]]*)\]/g, (_match, content) => {
    return `<span style="color:#a855f7">[${content}]</span>`
  })
}

export function BracketParserNode({ id, data, selected }: NodeProps<BracketParserNodeType>) {
  const h = useBracketParser(id, data)

  return (
    <NodeShell name="Bracket Parser" selected={selected} icon="🔧"
      inputSlots={h.bracketInputSlots}
      outputSlots={h.outputSlots}
      onRun={h.handleRun}
    >
      <div className={styles.nodeContent}>
        {/* Mode toggles: Connected/Manual + Items/Template */}
        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${!h.manualMode ? styles.toggleActive : ''}`}
            onClick={() => h.setManualMode(false)}>Connected</button>
          <button className={`${styles.toggleBtn} ${h.manualMode ? styles.toggleActive : ''}`}
            onClick={() => h.setManualMode(true)}>Manual</button>
        </div>
        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${h.outputMode === 'items' ? styles.toggleActive : ''}`}
            onClick={() => h.setOutputMode('items')}>Items</button>
          <button className={`${styles.toggleBtn} ${h.outputMode === 'template' ? styles.toggleActive : ''}`}
            onClick={() => h.setOutputMode('template')}>Template</button>
        </div>

        <p className={styles.infoBadge}>
          {!h.inputText.trim()
            ? 'Waiting for input...'
            : h.entries.length === 0
            ? 'No brackets found'
            : `${h.entries.length} unique / ${h.brackets.length} total`
          }
        </p>

        {h.manualMode && (
          <>
            <button
              className={styles.blendAllNone}
              style={{ alignSelf: 'flex-start', fontSize: 8, color: '#666' }}
              onClick={() => h.setTextCollapsed(v => !v)}
            >{h.textCollapsed ? 'Show Text' : 'Hide Text'}</button>
            {!h.textCollapsed && (
              <textarea className={styles.promptInput} placeholder="Paste text with [brackets] here..."
                value={h.manualInput} onChange={e => h.setManualInput(e.target.value)} rows={4} />
            )}
          </>
        )}

        {h.unpackError && <p className={styles.error}>{h.unpackError}</p>}

        {/* Entry grid — deduplicated by name */}
        {h.entries.length > 0 && (
          <>
            <div className={styles.blendGrid}>
              <div className={styles.blendHeader}>
                <button className={styles.blendAllNone} onClick={h.toggleAllExclusion}>
                  {h.allIncluded ? 'None' : 'All'}
                </button>
                {Object.keys(h.overrides).length > 0 && (
                  <button className={styles.blendAllNone}
                    style={{ color: '#d97706' }}
                    onClick={() => h.setOverrides({})}
                    title="Reset all overrides"
                  >Reset</button>
                )}
                <span className={styles.blendLabel}>Name</span>
                <span className={styles.blendLabel}>Value</span>
              </div>
              {h.entries.map(entry => {
                const excluded = h.excludedKeys.has(entry.key)
                const isPinConnected = h.connectedBrackets.has(entry.key)
                const isEditing = h.editingKey === entry.key && !isPinConnected
                const isOverridden = entry.key in h.overrides
                const hasJsonDef = entry.key in h.jsonDefs
                const displayVal = h.resolveVal(entry)
                const valPreview = displayVal.slice(0, 40) + (displayVal.length > 40 ? '...' : '')
                return (
                  <div key={entry.key} className={`${styles.blendRow} ${excluded ? styles.blendRowExcluded : ''}`}>
                    <button
                      className={`${styles.blendCheckbox} ${!excluded ? styles.blendCheckboxChecked : ''}`}
                      onClick={(e) => h.toggleExclude(entry.key, e)}
                      title="Alt+Click to isolate"
                    />
                    <span className={`${styles.blendKey} ${excluded ? styles.blendKeyExcluded : ''}`}
                      title={`[${entry.key}] — ${entry.count}x`}>
                      {entry.key}
                      {entry.count > 1 && <span style={{ color: '#666', fontSize: 8 }}> x{entry.count}</span>}
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
                          const originalVal = h.jsonDefs[entry.key] ?? entry.key
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
                        style={{
                          color: isPinConnected ? '#3b82f6' : isOverridden ? '#d97706' : hasJsonDef ? '#22c55e' : '#888',
                          fontSize: 9, cursor: isPinConnected ? 'default' : 'pointer',
                        }}
                        title={isPinConnected ? `via pin: ${displayVal}` : `${displayVal}\n\nClick to edit${isOverridden ? ' — Right-click to reset' : ''}`}
                        onClick={isPinConnected ? undefined : () => h.setEditingKey(entry.key)}
                        onContextMenu={(!isPinConnected && isOverridden) ? (e) => {
                          e.preventDefault()
                          h.setOverrides(prev => { const next = { ...prev }; delete next[entry.key]; return next })
                        } : undefined}
                      >
                        {!isPinConnected && isOverridden && '* '}{valPreview}
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
          </>
        )}

        {/* Output preview toggle + content */}
        {h.effectiveOutput && (
          <>
            <button
              className={styles.blendAllNone}
              style={{ alignSelf: 'flex-start', fontSize: 8, color: '#666' }}
              onClick={() => h.setPreviewCollapsed(v => !v)}
            >{h.previewCollapsed ? 'Show Preview' : 'Hide Preview'}</button>
            {!h.previewCollapsed && (
              h.editingOutput ? (
                <textarea
                  ref={h.outputTextareaRef}
                  className={`${styles.resultArea} nokey`}
                  style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto', resize: 'vertical', color: '#d97706', flex: 'none', height: h.previewSize?.h ?? 60, width: h.previewSize?.w ?? '100%', minHeight: 40, boxSizing: 'border-box' }}
                  defaultValue={h.effectiveOutput}
                  autoFocus
                  onBlur={(e) => {
                    const val = e.target.value
                    h.setOutputOverride(val === h.computedOutput ? null : val)
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
                  dangerouslySetInnerHTML={{
                    __html: h.outputMode === 'template'
                      ? colorizeTemplate(h.effectiveOutput)
                      : escapeHtml(h.effectiveOutput)
                  }}
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
          </>
        )}
        {h.outputOverride !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#d97706' }}>
            <span>* Output overridden</span>
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
                h.updateNodeData(id, { pins_collapsed: !h.pinsCollapsed })
                h.updateNodeInternals(id)
              }}
              title={h.pinsCollapsed ? 'Expand output pins' : 'Collapse output pins'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {h.pinsCollapsed
                  ? <polyline points="6 9 12 15 18 9" />
                  : <polyline points="18 15 12 9 6 15" />
                }
              </svg>
            </button>
          )}
          <button className={styles.unpackBtn} onClick={h.unpack}
            title="Create a text node for each unique bracket (live — updates when input changes)">
            Unpack {h.includedEntries.length > 0 ? `(${h.includedEntries.length})` : ''}
          </button>
        </div>
      </div>
    </NodeShell>
  )
}

export default memo(BracketParserNode)
