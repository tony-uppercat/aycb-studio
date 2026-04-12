import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals, type Node } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { parseJsonInput } from '../../utils/jsonParserUtils'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
import { pullText } from '../../hooks/useDataPropagation'
import type { JsonParserNodeData } from '../../types'

type JsonParserNodeType = Node<JsonParserNodeData, 'jsonParser'>

export type ParseMode = 'json' | 'newline'
export type OutputFormat = 'values' | 'kv' | 'json'

function flattenObject(obj: Record<string, unknown>, prefix = ''): { key: string; val: unknown }[] {
  const result: { key: string; val: unknown }[] = []
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result.push(...flattenObject(v as Record<string, unknown>, fullKey))
    } else {
      result.push({ key: fullKey, val: v })
    }
  }
  return result
}

/** Truncate a value at a given depth. At depth 0, nested objects/arrays become placeholder strings. */
function truncateAtDepth(val: unknown, remaining: number): unknown {
  if (remaining <= 0) {
    if (Array.isArray(val)) return `[Array(${val.length})]`
    if (val !== null && typeof val === 'object') return `{${Object.keys(val as Record<string, unknown>).length} keys}`
    return val
  }
  if (Array.isArray(val)) {
    return val.map(item => truncateAtDepth(item, remaining - 1))
  }
  if (val !== null && typeof val === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = truncateAtDepth(v, remaining - 1)
    }
    return out
  }
  return val
}

/** Apply depth limit to a parsed object/array. maxDepth=0 means unlimited. */
function applyDepthLimit(val: unknown, maxDepth: number): unknown {
  if (maxDepth <= 0) return val
  return truncateAtDepth(val, maxDepth)
}

export function useJsonParser(id: string, data: JsonParserNodeData) {
  const { updateNodeData, addNodes, addEdges, getNode, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

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

  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const upstreamText = pullText(id, 'text-in', getNodes, getEdges)
  const inputText = manualMode ? manualInput : upstreamText

  const [path, setPath] = useState(typeof data.jsonPath === 'string' ? data.jsonPath : '')
  const [parseMode, setParseMode] = useState<ParseMode>(data.parseMode === 'newline' ? 'newline' : 'json')
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set(data.excludedKeys ?? []))
  const [outputLimit, setOutputLimit] = useState<number>(typeof data.outputLimit === 'number' ? data.outputLimit : 0)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    (data.outputFormat as OutputFormat) ?? 'values'
  )
  const [flatten, setFlatten] = useState(data.flatten === true)
  const [maxDepth, setMaxDepth] = useState<number>(typeof data.maxDepth === 'number' ? data.maxDepth : 0)
  const [excludedSections, setExcludedSections] = useState<Set<string>>(
    new Set(data.excludedSections as string[] ?? [])
  )
  // Inline value overrides: key -> edited string (persisted in node data)
  const [overrides, setOverrides] = useState<Record<string, string>>(
    (data.overrides as Record<string, string>) ?? {}
  )
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const escapedRef = useRef(false)

  // Collapse/expand dynamic output pins
  const [pinsCollapsed, setPinsCollapsed] = useState(data.pinsCollapsed === true)
  const [previewCollapsed, setPreviewCollapsed] = useState(data.previewCollapsed === true)
  const [textCollapsed, setTextCollapsed] = useState(data.textCollapsed === true)

  // Full output override: editable directly from preview area
  const [outputOverride, setOutputOverride] = useState<string | null>(
    typeof data.outputOverride === 'string' ? data.outputOverride : null
  )
  const [editingOutput, setEditingOutput] = useState(false)
  const outputTextareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLPreElement>(null)
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number } | null>(null)

  // Parse result based on mode
  const result = useMemo(() => {
    if (parseMode === 'newline') {
      if (!inputText.trim()) return { ok: false as const, error: 'No input', display: '', value: null }
      const lines = inputText.split('\n').filter(l => l.trim())
      const obj: Record<string, string> = {}
      lines.forEach((line, i) => { obj[`line_${String(i).padStart(4, '0')}`] = line.trim() })
      return { ok: true as const, display: JSON.stringify(obj, null, 2), value: obj, error: '' }
    }
    return parseJsonInput(inputText, path)
  }, [inputText, path, parseMode])

  // Apply depth limit to parsed value
  const depthLimitedValue = useMemo(() => {
    if (!result.ok) return null
    if (result.value == null) return result.value
    return applyDepthLimit(result.value, maxDepth)
  }, [result, maxDepth])

  // Compute entries from parsed value (flatten nested objects when enabled)
  const entries = useMemo(() => {
    if (!result.ok || depthLimitedValue == null || typeof depthLimitedValue !== 'object') return []
    if (Array.isArray(depthLimitedValue)) {
      return (depthLimitedValue as unknown[]).map((val: unknown, i: number) => ({ key: String(i), val }))
    }
    const obj = depthLimitedValue as Record<string, unknown>
    if (flatten) return flattenObject(obj)
    return Object.entries(obj).map(([key, val]) => ({ key, val }))
  }, [result, depthLimitedValue, flatten])

  // Top-level sections (only meaningful when flatten is on)
  const sections = useMemo(() => {
    if (!flatten) return []
    const seen = new Set<string>()
    for (const e of entries) {
      const dot = e.key.indexOf('.')
      if (dot > 0) seen.add(e.key.slice(0, dot))
      else seen.add(e.key)
    }
    return [...seen]
  }, [entries, flatten])

  // Entries filtered by section (then key exclusion applies on top)
  const visibleEntries = useMemo(() => {
    if (!flatten || excludedSections.size === 0) return entries
    return entries.filter(e => {
      const dot = e.key.indexOf('.')
      const section = dot > 0 ? e.key.slice(0, dot) : e.key
      return !excludedSections.has(section)
    })
  }, [entries, flatten, excludedSections])

  // Resolve value: use override if present, otherwise original
  function resolveVal(entry: { key: string; val: unknown }): string {
    if (entry.key in overrides) return overrides[entry.key]
    return typeof entry.val === 'string' ? entry.val : JSON.stringify(entry.val, null, 2)
  }

  // Apply selector + limiter + overrides to build output
  const filteredOutput = useMemo(() => {
    let items = visibleEntries.filter(e => !excludedKeys.has(e.key))
    if (outputLimit > 0) items = items.slice(0, outputLimit)
    if (items.length === 0) return ''
    if (outputFormat === 'json') {
      const obj: Record<string, unknown> = {}
      items.forEach(e => {
        const v = e.key in overrides ? overrides[e.key] : e.val
        obj[e.key] = v
      })
      return JSON.stringify(obj, null, 2)
    }
    if (outputFormat === 'kv') {
      return items.map(e => `${e.key}: ${resolveVal(e)}`).join('\n')
    }
    return items.map(e => resolveVal(e)).join('\n')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEntries, excludedKeys, outputLimit, outputFormat, overrides])

  // Build per-pin output map for dynamic output pins
  const includedEntries = useMemo(() => {
    let items = visibleEntries.filter(e => !excludedKeys.has(e.key))
    if (outputLimit > 0) items = items.slice(0, outputLimit)
    return items
  }, [visibleEntries, excludedKeys, outputLimit])

  const outputPins = useMemo(() => {
    const pins: Record<string, string> = {}
    includedEntries.forEach((entry, i) => {
      pins[`text-${i}`] = resolveVal(entry)
    })
    return pins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, overrides])

  // Dynamic output slots: combined output + one per included entry
  // When collapsed, dynamic pins are hidden (kept in DOM for edge preservation)
  const outputSlots: SlotDef[] = useMemo(() => {
    const slots: SlotDef[] = [{ id: 'text-out', label: 'Output', type: 'text' as const }]
    includedEntries.forEach((entry, i) => {
      slots.push({
        id: `text-${i}`,
        label: entryLabel(entry),
        type: 'text' as const,
        hidden: pinsCollapsed,
      })
    })
    return slots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, pinsCollapsed])

  // Notify React Flow when output pin count or visibility changes
  useEffect(() => {
    updateNodeInternals(id)
  }, [outputSlots.length, pinsCollapsed, id, updateNodeInternals])

  // Effective output: override takes precedence over computed
  const effectiveOutput = outputOverride ?? (visibleEntries.length > 0 ? filteredOutput : (result.ok ? result.display : ''))

  // Sync output (skip if unchanged)
  const prevOutputRef = useRef('')
  const prevPinsRef = useRef('')
  useEffect(() => {
    const pinsJson = JSON.stringify(outputPins)
    if (prevOutputRef.current === effectiveOutput && prevPinsRef.current === pinsJson) return
    prevOutputRef.current = effectiveOutput
    prevPinsRef.current = pinsJson
    updateNodeData(id, {
      outputText: effectiveOutput, outputPins, jsonPath: path, parseMode, outputFormat, flatten, overrides,
      excludedKeys: [...excludedKeys], excludedSections: [...excludedSections], outputLimit, maxDepth,
      outputOverride: outputOverride, pinsCollapsed, previewCollapsed, textCollapsed,
    })
  }, [effectiveOutput, path, parseMode, outputFormat, flatten, overrides, excludedKeys, excludedSections, outputLimit, maxDepth, outputPins, id, updateNodeData, outputOverride, pinsCollapsed, previewCollapsed, textCollapsed])

  // Display label: in newline mode show first 2 words of value, otherwise show key
  function entryLabel(entry: { key: string; val: unknown }): string {
    if (parseMode === 'newline' && typeof entry.val === 'string') {
      const words = entry.val.trim().split(/\s+/).slice(0, 2).join(' ')
      return words || entry.key
    }
    return entry.key
  }

  function toggleExclude(key: string, e?: React.MouseEvent) {
    // Alt+Click = isolate (Photoshop-style)
    if (e?.altKey) {
      const allKeys = visibleEntries.map(en => en.key)
      const onlyThisIncluded = allKeys.every(k => k === key ? !excludedKeys.has(k) : excludedKeys.has(k))
      if (onlyThisIncluded) {
        // Already isolated -> restore all
        setExcludedKeys(new Set())
      } else {
        // Isolate: exclude everything except this key
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

  const allIncluded = visibleEntries.length > 0 && visibleEntries.every(e => !excludedKeys.has(e.key))

  function toggleAllExclusion() {
    if (allIncluded) {
      setExcludedKeys(new Set(visibleEntries.map(e => e.key)))
    } else {
      setExcludedKeys(new Set())
    }
  }

  function toggleSection(section: string, e?: React.MouseEvent) {
    if (e?.altKey) {
      const onlyThisIncluded = sections.every(s => s === section ? !excludedSections.has(s) : excludedSections.has(s))
      if (onlyThisIncluded) {
        setExcludedSections(new Set())
      } else {
        setExcludedSections(new Set(sections.filter(s => s !== section)))
      }
      return
    }
    setExcludedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section); else next.add(section)
      return next
    })
  }

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
    // Connect each node to its specific per-entry output pin (live updates)
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
    path, setPath,
    parseMode, setParseMode,
    excludedKeys, setExcludedKeys,
    outputLimit, setOutputLimit,
    outputFormat, setOutputFormat,
    flatten, setFlatten,
    maxDepth, setMaxDepth,
    excludedSections, setExcludedSections,
    overrides, setOverrides,
    editingKey, setEditingKey,
    escapedRef,
    pinsCollapsed, setPinsCollapsed,
    previewCollapsed, setPreviewCollapsed,
    textCollapsed, setTextCollapsed,
    outputOverride, setOutputOverride,
    editingOutput, setEditingOutput,
    outputTextareaRef,
    previewRef,
    previewSize, setPreviewSize,

    // Computed
    result,
    visibleEntries,
    sections,
    includedEntries,
    outputSlots,
    effectiveOutput,
    filteredOutput,
    allIncluded,
    unpackError,

    // Actions
    handleRun,
    resolveVal,
    entryLabel,
    toggleExclude,
    toggleAllExclusion,
    toggleSection,
    unpack,
    updateNodeData,
    updateNodeInternals,
  }
}
