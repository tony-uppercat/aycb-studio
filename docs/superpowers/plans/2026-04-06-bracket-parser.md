# Bracket Parser Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Bracket Parser node that extracts `[bracketed]` text from input, allows override/select/deselect/unpack, and outputs either extracted items or reconstructed template text.

**Architecture:** Single node folder `frontend/src/nodes/bracket-parser/` with manifest, component, hook, utils, and tests. Follows the exact same pattern as the existing JSON Parser node but with bracket-specific parsing logic. Adds `BracketParserNodeData` to the shared types file.

**Tech Stack:** React 19, @xyflow/react 12, TypeScript 5.9, Vitest

---

## File Structure

| File | Responsibility | Est. Lines |
|---|---|---|
| `frontend/src/nodes/bracket-parser/bracketParserUtils.ts` | Pure parsing: extract brackets, rebuild template | ~45 |
| `frontend/src/nodes/bracket-parser/bracket-parser.test.ts` | Tests for utils + manifest | ~80 |
| `frontend/src/nodes/bracket-parser/node.manifest.ts` | Node manifest (auto-discovered) | ~15 |
| `frontend/src/nodes/bracket-parser/useBracketParser.ts` | React hook: state, entries, override, output, unpack | ~230 |
| `frontend/src/nodes/bracket-parser/BracketParserNode.tsx` | Component: UI rendering using NodeShell | ~180 |
| `frontend/src/types.ts` (modify) | Add `BracketParserNodeData` interface | +15 |

---

### Task 1: Bracket Parser Utils (Pure Logic)

**Files:**
- Create: `frontend/src/nodes/bracket-parser/bracketParserUtils.ts`
- Test: `frontend/src/nodes/bracket-parser/bracket-parser.test.ts`

- [ ] **Step 1: Write failing tests for `extractBrackets`**

Create `frontend/src/nodes/bracket-parser/bracket-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { extractBrackets, rebuildTemplate } from './bracketParserUtils'

describe('extractBrackets', () => {
  it('extracts single bracket', () => {
    const result = extractBrackets('The [dragon] flies')
    expect(result).toEqual([
      { index: 0, content: 'dragon', start: 4, end: 12 },
    ])
  })

  it('extracts multiple brackets', () => {
    const result = extractBrackets('The [dragon] flew over the [ancient castle]')
    expect(result).toEqual([
      { index: 0, content: 'dragon', start: 4, end: 12 },
      { index: 1, content: 'ancient castle', start: 27, end: 43 },
    ])
  })

  it('returns empty array for no brackets', () => {
    expect(extractBrackets('no brackets here')).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(extractBrackets('')).toEqual([])
  })

  it('handles empty brackets', () => {
    const result = extractBrackets('before [] after')
    expect(result).toEqual([
      { index: 0, content: '', start: 7, end: 9 },
    ])
  })

  it('handles adjacent brackets', () => {
    const result = extractBrackets('[one][two]')
    expect(result).toEqual([
      { index: 0, content: 'one', start: 0, end: 4 },
      { index: 1, content: 'two', start: 5, end: 9 },
    ])
  })

  it('handles unclosed bracket (ignores it)', () => {
    const result = extractBrackets('open [ but [closed]')
    expect(result).toEqual([
      { index: 0, content: 'closed', start: 11, end: 19 },
    ])
  })

  it('handles brackets with special characters', () => {
    const result = extractBrackets('a [red, glowing dragon] roars')
    expect(result).toEqual([
      { index: 0, content: 'red, glowing dragon', start: 2, end: 23 },
    ])
  })
})
```

- [ ] **Step 2: Write failing tests for `rebuildTemplate`**

Append to same test file:

```typescript
describe('rebuildTemplate', () => {
  it('rebuilds with no overrides', () => {
    const brackets = extractBrackets('The [dragon] flies')
    const result = rebuildTemplate('The [dragon] flies', brackets, {})
    expect(result).toBe('The [dragon] flies')
  })

  it('applies overrides', () => {
    const brackets = extractBrackets('The [dragon] flew over the [castle]')
    const result = rebuildTemplate(
      'The [dragon] flew over the [castle]',
      brackets,
      { '0': 'phoenix' }
    )
    expect(result).toBe('The [phoenix] flew over the [castle]')
  })

  it('applies multiple overrides', () => {
    const brackets = extractBrackets('[a] and [b]')
    const result = rebuildTemplate('[a] and [b]', brackets, { '0': 'x', '1': 'y' })
    expect(result).toBe('[x] and [y]')
  })

  it('handles excluded indices (keeps original)', () => {
    const brackets = extractBrackets('[a] and [b]')
    const excluded = new Set(['0'])
    const result = rebuildTemplate('[a] and [b]', brackets, { '1': 'y' }, excluded)
    expect(result).toBe('[a] and [y]')
  })

  it('returns original text when no brackets', () => {
    const result = rebuildTemplate('no brackets', [], {})
    expect(result).toBe('no brackets')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/nodes/bracket-parser/bracket-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `bracketParserUtils.ts`**

Create `frontend/src/nodes/bracket-parser/bracketParserUtils.ts`:

```typescript
export interface BracketEntry {
  index: number
  content: string
  start: number   // position of '[' in original text
  end: number     // position of ']' in original text
}

/**
 * Extract all first-level [bracketed] segments from text.
 * Ignores unclosed brackets. Does not handle nesting.
 */
export function extractBrackets(text: string): BracketEntry[] {
  const entries: BracketEntry[] = []
  const regex = /\[([^\[\]]*)\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    entries.push({
      index: entries.length,
      content: match[1],
      start: match.index,
      end: match.index + match[0].length - 1,
    })
  }
  return entries
}

/**
 * Rebuild the original text, replacing bracket contents with overrides.
 * Excluded brackets keep their original content.
 */
export function rebuildTemplate(
  original: string,
  brackets: BracketEntry[],
  overrides: Record<string, string>,
  excluded?: Set<string>,
): string {
  if (brackets.length === 0) return original
  let result = ''
  let cursor = 0
  for (const b of brackets) {
    result += original.slice(cursor, b.start)
    const key = String(b.index)
    const isExcluded = excluded?.has(key)
    const content = !isExcluded && key in overrides ? overrides[key] : b.content
    result += `[${content}]`
    cursor = b.end + 1
  }
  result += original.slice(cursor)
  return result
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/nodes/bracket-parser/bracket-parser.test.ts`
Expected: All 13 tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/nodes/bracket-parser/bracketParserUtils.ts frontend/src/nodes/bracket-parser/bracket-parser.test.ts
git commit -m "[node] bracket-parser: utils + tests (extract & rebuild)"
```

---

### Task 2: Node Manifest + Type Interface

**Files:**
- Create: `frontend/src/nodes/bracket-parser/node.manifest.ts`
- Modify: `frontend/src/types.ts` (add interface after `JsonParserNodeData`, around line 156)
- Test: `frontend/src/nodes/bracket-parser/bracket-parser.test.ts` (append manifest tests)

- [ ] **Step 1: Write failing manifest test**

Append to `bracket-parser.test.ts`:

```typescript
import manifest from './node.manifest'

describe('bracket-parser manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('bracketParser')
    expect(manifest.label).toBe('Bracket Parser')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/nodes/bracket-parser/bracket-parser.test.ts`
Expected: FAIL — cannot resolve `./node.manifest`

- [ ] **Step 3: Create manifest**

Create `frontend/src/nodes/bracket-parser/node.manifest.ts`:

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'bracketParser',
  label: 'Bracket Parser',
  icon: '🔧',
  category: 'utility',
  description: 'Extract and edit [bracketed] text segments',
  defaultData: {},
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
```

- [ ] **Step 4: Add `BracketParserNodeData` to types.ts**

Add after `JsonParserNodeData` (after line 156 in `frontend/src/types.ts`):

```typescript
export interface BracketParserNodeData extends Record<string, unknown> {
  text?: string
  outputText?: string
  output_mode?: 'items' | 'template'
  excluded_keys?: string[]
  output_limit?: number
  overrides?: Record<string, string>
  output_override?: string | null
  pins_collapsed?: boolean
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/nodes/bracket-parser/bracket-parser.test.ts`
Expected: All 16 tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/nodes/bracket-parser/node.manifest.ts frontend/src/types.ts frontend/src/nodes/bracket-parser/bracket-parser.test.ts
git commit -m "[node] bracket-parser: manifest + type interface"
```

---

### Task 3: Hook — `useBracketParser`

**Files:**
- Create: `frontend/src/nodes/bracket-parser/useBracketParser.ts`

**Dependencies:** Task 1 (utils), Task 2 (types)

This hook mirrors `useJsonParser` but is simpler: no JSON/newline mode, no flatten, no depth, no sections.

- [ ] **Step 1: Create the hook**

Create `frontend/src/nodes/bracket-parser/useBracketParser.ts`:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals, type Node } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { extractBrackets, rebuildTemplate, type BracketEntry } from './bracketParserUtils'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
import { pullText } from '../../hooks/useDataPropagation'
import type { BracketParserNodeData } from '../../types'

type BracketParserNodeType = Node<BracketParserNodeData, 'bracketParser'>

export type OutputMode = 'items' | 'template'

export function useBracketParser(id: string, data: BracketParserNodeData) {
  const { updateNodeData, addNodes, addEdges, getNode, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  // Subscribe to upstream changes
  useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'text-in')
    if (!edge) return ''
    const src = state.nodes.find(n => n.id === edge.source)
    return String((src?.data as Record<string, unknown>)?.outputText ?? '')
  })

  function handleRun() {
    const upstream = pullText(id, 'text-in', getNodes, getEdges)
    if (upstream) updateNodeData(id, { text: upstream })
  }

  // Input source: manual or connected
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const upstreamText = pullText(id, 'text-in', getNodes, getEdges)
  const inputText = manualMode ? manualInput : upstreamText

  // State
  const [outputMode, setOutputMode] = useState<OutputMode>(
    (data.output_mode as OutputMode) ?? 'items'
  )
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(
    new Set(data.excluded_keys ?? [])
  )
  const [outputLimit, setOutputLimit] = useState<number>(
    typeof data.output_limit === 'number' ? data.output_limit : 0
  )
  const [overrides, setOverrides] = useState<Record<string, string>>(
    (data.overrides as Record<string, string>) ?? {}
  )
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const escapedRef = useRef(false)
  const [pinsCollapsed, setPinsCollapsed] = useState(data.pins_collapsed === true)
  const [outputOverride, setOutputOverride] = useState<string | null>(
    typeof data.output_override === 'string' ? data.output_override : null
  )
  const [editingOutput, setEditingOutput] = useState(false)
  const outputTextareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLPreElement>(null)
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number } | null>(null)

  // Parse brackets from input
  const brackets = useMemo(() => extractBrackets(inputText), [inputText])

  // Build entries from brackets (each entry has key = index string)
  const entries = useMemo(() =>
    brackets.map(b => ({ key: String(b.index), val: b.content })),
    [brackets]
  )

  // Resolve value: use override if present, otherwise original
  function resolveVal(entry: { key: string; val: unknown }): string {
    if (entry.key in overrides) return overrides[entry.key]
    return typeof entry.val === 'string' ? entry.val : String(entry.val)
  }

  // Included entries (after exclusion + limit)
  const includedEntries = useMemo(() => {
    let items = entries.filter(e => !excludedKeys.has(e.key))
    if (outputLimit > 0) items = items.slice(0, outputLimit)
    return items
  }, [entries, excludedKeys, outputLimit])

  // Items output: values list
  const itemsOutput = useMemo(() => {
    if (includedEntries.length === 0) return ''
    return includedEntries.map(e => resolveVal(e)).join('\n')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, overrides])

  // Template output: rebuilt text with overrides
  const templateOutput = useMemo(() => {
    if (brackets.length === 0) return inputText
    return rebuildTemplate(inputText, brackets, overrides, excludedKeys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText, brackets, overrides, excludedKeys])

  // Computed output based on mode
  const computedOutput = outputMode === 'template' ? templateOutput : itemsOutput

  // Effective output: override takes precedence
  const effectiveOutput = outputOverride ?? computedOutput

  // Build per-pin output map
  const outputPins = useMemo(() => {
    const pins: Record<string, string> = {}
    includedEntries.forEach((entry, i) => {
      pins[`text-${i}`] = resolveVal(entry)
    })
    return pins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, overrides])

  // Dynamic output slots
  const outputSlots: SlotDef[] = useMemo(() => {
    const slots: SlotDef[] = [{ id: 'text-out', label: 'Output', type: 'text' as const }]
    includedEntries.forEach((entry, i) => {
      const label = resolveVal(entry)
      const short = label.length > 20 ? label.slice(0, 20) + '...' : label
      slots.push({
        id: `text-${i}`,
        label: `[${entry.key}] ${short}`,
        type: 'text' as const,
        hidden: pinsCollapsed,
      })
    })
    return slots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, pinsCollapsed, overrides])

  // Notify React Flow when pin count changes
  useEffect(() => {
    updateNodeInternals(id)
  }, [outputSlots.length, pinsCollapsed, id, updateNodeInternals])

  // Sync output to node data (skip if unchanged)
  const prevOutputRef = useRef('')
  const prevPinsRef = useRef('')
  useEffect(() => {
    const pinsJson = JSON.stringify(outputPins)
    if (prevOutputRef.current === effectiveOutput && prevPinsRef.current === pinsJson) return
    prevOutputRef.current = effectiveOutput
    prevPinsRef.current = pinsJson
    updateNodeData(id, {
      outputText: effectiveOutput, outputPins, output_mode: outputMode, overrides,
      excluded_keys: [...excludedKeys], output_limit: outputLimit,
      output_override: outputOverride, pins_collapsed: pinsCollapsed,
    })
  }, [effectiveOutput, outputMode, overrides, excludedKeys, outputLimit, outputPins, id, updateNodeData, outputOverride, pinsCollapsed])

  // Toggle exclude (with Alt+Click isolate)
  function toggleExclude(key: string, e?: React.MouseEvent) {
    if (e?.altKey) {
      const allKeys = entries.map(en => en.key)
      const onlyThisIncluded = allKeys.every(k => k === key ? !excludedKeys.has(k) : excludedKeys.has(k))
      if (onlyThisIncluded) {
        setExcludedKeys(new Set())
      } else {
        setExcludedKeys(new Set(allKeys.filter(k => k !== key)))
      }
      return
    }
    setExcludedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const allIncluded = entries.length > 0 && entries.every(e => !excludedKeys.has(e.key))

  function toggleAllExclusion() {
    if (allIncluded) {
      setExcludedKeys(new Set(entries.map(e => e.key)))
    } else {
      setExcludedKeys(new Set())
    }
  }

  // Unpack: create text nodes for each included entry
  const [unpackError, setUnpackError] = useState('')

  function unpack() {
    setUnpackError('')
    if (includedEntries.length === 0) { setUnpackError('No items to unpack'); return }

    const currentNode = getNode(id)
    const baseX = (currentNode?.position.x ?? 0) + 350
    const baseY = (currentNode?.position.y ?? 0)

    const newNodes = includedEntries.map((entry, i) => {
      const text = resolveVal(entry)
      return {
        id: getNextNodeId('textInput'),
        type: 'textInput' as const,
        position: { x: baseX, y: baseY + i * 180 },
        data: { outputText: text, text },
      }
    })

    addNodes(newNodes)
    const newEdges = newNodes.map((node, i) => ({
      id: `${id}-unpack-${i}`,
      source: id, sourceHandle: `text-${i}`,
      target: node.id, targetHandle: 'text-in',
    }))
    addEdges(newEdges)
  }

  return {
    // State
    manualMode, setManualMode,
    manualInput, setManualInput,
    inputText,
    outputMode, setOutputMode,
    excludedKeys, setExcludedKeys,
    outputLimit, setOutputLimit,
    overrides, setOverrides,
    editingKey, setEditingKey,
    escapedRef,
    pinsCollapsed, setPinsCollapsed,
    outputOverride, setOutputOverride,
    editingOutput, setEditingOutput,
    outputTextareaRef,
    previewRef,
    previewSize, setPreviewSize,

    // Computed
    brackets,
    entries,
    includedEntries,
    outputSlots,
    effectiveOutput,
    computedOutput,
    allIncluded,
    unpackError,

    // Actions
    handleRun,
    resolveVal,
    toggleExclude,
    toggleAllExclusion,
    unpack,
    updateNodeData,
    updateNodeInternals,
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in bracket-parser files

- [ ] **Step 3: Commit**

```bash
git add frontend/src/nodes/bracket-parser/useBracketParser.ts
git commit -m "[node] bracket-parser: hook (state, entries, override, unpack)"
```

---

### Task 4: Component — `BracketParserNode`

**Files:**
- Create: `frontend/src/nodes/bracket-parser/BracketParserNode.tsx`

**Dependencies:** Task 3 (hook)

- [ ] **Step 1: Create the component**

Create `frontend/src/nodes/bracket-parser/BracketParserNode.tsx`:

```tsx
import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { escapeHtml } from '../../utils/jsonColorize'
import type { BracketParserNodeData } from '../../types'
import { useBracketParser } from './useBracketParser'
import styles from '../_shared/Node.module.css'

type BracketParserNodeType = Node<BracketParserNodeData, 'bracketParser'>

/** Highlight [brackets] in text — overridden brackets get accent color */
function colorizeBrackets(text: string, overrides: Record<string, string>): string {
  const safe = escapeHtml(text)
  let idx = 0
  return safe.replace(/\[([^\[\]]*)\]/g, (match, content) => {
    const key = String(idx++)
    const isOverridden = key in overrides
    const color = isOverridden ? '#d97706' : '#a855f7'
    return `<span style="color:${color}">[${escapeHtml(content)}]</span>`
  })
}

export function BracketParserNode({ id, data, selected }: NodeProps<BracketParserNodeType>) {
  const h = useBracketParser(id, data)

  return (
    <NodeShell name="Bracket Parser" selected={selected} icon="🔧"
      inputSlots={[{ id: 'text-in', label: 'Text Input', type: 'text' }]}
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
            : h.brackets.length === 0
            ? 'No brackets found'
            : `${h.brackets.length} bracket${h.brackets.length > 1 ? 's' : ''} found`
          }
        </p>

        {h.manualMode && (
          <textarea className={styles.promptInput} placeholder="Paste text with [brackets] here..."
            value={h.manualInput} onChange={e => h.setManualInput(e.target.value)} rows={4} />
        )}

        {h.unpackError && <p className={styles.error}>{h.unpackError}</p>}

        {/* Entry grid */}
        {h.entries.length > 0 && (
          <>
            <div className={styles.blendGrid}>
              <div className={styles.blendHeader}>
                <button className={styles.blendAllNone} onClick={h.toggleAllExclusion}>
                  {h.allIncluded ? 'None' : 'All'}
                </button>
                <span className={styles.blendLabel}>Bracket</span>
                <span className={styles.blendLabel}>Value</span>
              </div>
              {h.entries.map(entry => {
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
                    <span className={`${styles.blendKey} ${excluded ? styles.blendKeyExcluded : ''}`}
                      title={`[${entry.key}]`}>
                      [{entry.key}]
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
                          if (newVal !== entry.val) {
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
                        {isOverridden && '* '}{valPreview}
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

        {/* Output preview */}
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
                  ? colorizeBrackets(h.effectiveOutput, h.overrides)
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
            title="Create a text node for each bracket (live — updates when input changes)">
            Unpack {h.includedEntries.length > 0 ? `(${h.includedEntries.length})` : ''}
          </button>
        </div>
      </div>
    </NodeShell>
  )
}

export default memo(BracketParserNode)
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/nodes/bracket-parser/BracketParserNode.tsx
git commit -m "[node] bracket-parser: component (UI with entry grid, preview, unpack)"
```

---

### Task 5: Integration Test — Full Node Rendering

**Files:**
- Modify: `frontend/src/nodes/bracket-parser/bracket-parser.test.ts` (append)

- [ ] **Step 1: Run all existing tests to verify nothing is broken**

Run: `cd frontend && npx vitest run`
Expected: All tests pass, bracket-parser tests included

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: All tests pass (existing 115 + new bracket-parser tests)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "[node] bracket-parser: integration verified, all tests pass"
```
