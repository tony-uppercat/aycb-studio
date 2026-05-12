import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { colorizeJson, escapeHtml } from '../../utils/jsonColorize'
import { useFindReplace, type FindReplaceNodeData } from './useFindReplace'
import styles from '../_shared/Node.module.css'

type FindReplaceNodeType = Node<FindReplaceNodeData, 'findReplace'>

export function FindReplaceNode({ id, data, selected }: NodeProps<FindReplaceNodeType>) {
  const h = useFindReplace(id, data)

  return (
    <NodeShell name="Find Replace" selected={selected} icon="🔍"
      inputSlots={[{ id: 'text-in', label: 'Text Input', type: 'text' }]}
      outputSlots={[{ id: 'text-out', label: 'Output', type: 'text' }]}
      onRun={h.handleRun}
    >
      <div className={styles.nodeContent}>
        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${!h.manualMode ? styles.toggleActive : ''}`}
            onClick={() => h.setManualMode(false)}>Connected</button>
          <button className={`${styles.toggleBtn} ${h.manualMode ? styles.toggleActive : ''}`}
            onClick={() => h.setManualMode(true)}>Manual</button>
        </div>

        {h.manualMode && (
          <textarea className={styles.promptInput} placeholder="Paste text here..."
            value={h.manualInput} onChange={e => h.setManualInput(e.target.value)} rows={3} />
        )}

        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${h.caseSensitive ? styles.toggleActive : ''}`}
            onClick={() => h.setCaseSensitive(v => !v)}
            title="Case sensitive matching">Case</button>
          <button className={`${styles.toggleBtn} ${h.useRegex ? styles.toggleActive : ''}`}
            onClick={() => h.setUseRegex(v => !v)}
            title="Use regular expressions">Regex</button>
        </div>

        {h.rules.map((rule, i) => (
          <div key={i} className={styles.row} style={{ gap: 4, alignItems: 'center' }}>
            <input className={styles.promptInput}
              style={{ minHeight: 'unset', height: 'auto', flex: 1 }}
              type="text" placeholder="Find..."
              value={rule.find}
              onChange={e => h.updateRule(i, 'find', e.target.value)} />
            <input className={styles.promptInput}
              style={{ minHeight: 'unset', height: 'auto', flex: 1 }}
              type="text" placeholder="Replace..."
              value={rule.replace}
              onChange={e => h.updateRule(i, 'replace', e.target.value)} />
            {h.rules.length > 1 && (
              <button className={styles.toggleBtn}
                style={{ padding: '2px 6px', fontSize: 10, flex: 'none' }}
                onClick={() => h.removeRule(i)}
                title="Remove rule">x</button>
            )}
          </div>
        ))}

        <button className={styles.toggleBtn}
          style={{ alignSelf: 'flex-start', fontSize: 9 }}
          onClick={h.addRule}>+ Add Rule</button>

        <p className={styles.infoBadge}>
          {!h.inputText.trim()
            ? 'Waiting for input...'
            : `${h.result.matches} match${h.result.matches !== 1 ? 'es' : ''} found`}
        </p>

        <div className={styles.row}>
          <button className={`${styles.toggleBtn} ${h.outputFormat === 'value' ? styles.toggleActive : ''}`}
            onClick={() => h.setOutputFormat('value')}>Value</button>
          <button className={`${styles.toggleBtn} ${h.outputFormat === 'kv' ? styles.toggleActive : ''}`}
            onClick={() => h.setOutputFormat('kv')}>Key: Val</button>
          <button className={`${styles.toggleBtn} ${h.outputFormat === 'json' ? styles.toggleActive : ''}`}
            onClick={() => h.setOutputFormat('json')}>JSON</button>
        </div>

        {h.formattedOutput && (
          <>
            <button className={styles.blendAllNone}
              style={{ alignSelf: 'flex-start', fontSize: 8, color: '#666' }}
              onClick={() => h.setPreviewCollapsed(v => !v)}
            >{h.previewCollapsed ? 'Show Preview' : 'Hide Preview'}</button>
            {!h.previewCollapsed && (
              <pre className={styles.resultArea}
                style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1, minHeight: 40, overflow: 'auto' }}
                dangerouslySetInnerHTML={{
                  __html: h.outputFormat === 'json'
                    ? colorizeJson(h.formattedOutput)
                    : h.highlightedHtml || escapeHtml(h.formattedOutput)
                }}
              />
            )}
          </>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(FindReplaceNode)
