import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { extractBrackets, getUniqueNames, extractJsonDefinitions, rebuildTemplate } from './bracketParserUtils'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
import { pullText } from '../../hooks/useDataPropagation'
import type { BracketParserNodeData } from '../../types'

export type OutputMode = 'items' | 'template'

export function useBracketParser(id: string, data: BracketParserNodeData) {
  const { updateNodeData, addNodes, addEdges, getNode, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  // Subscribe to upstream changes (text-in)
  useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'text-in')
    if (!edge) return ''
    const src = state.nodes.find(n => n.id === edge.source)
    return String((src?.data as Record<string, unknown>)?.outputText ?? '')
  })

  // Real-time subscription to all bracket-{key}-in input pins
  const bracketPinValuesJson = useStore(state => {
    const result: Record<string, string> = {}
    for (const edge of state.edges) {
      if (edge.target !== id) continue
      if (!edge.targetHandle?.startsWith('text-bk-') || !edge.targetHandle.endsWith('-in')) continue
      const key = edge.targetHandle.slice(8, -3) // strip 'text-bk-' (8) and '-in' (3)
      const src = state.nodes.find(n => n.id === edge.source)
      if (!src) continue
      const d = src.data as Record<string, unknown>
      const outputPins = d.outputPins as Record<string, string> | undefined
      if (outputPins && edge.sourceHandle && edge.sourceHandle in outputPins) {
        result[key] = outputPins[edge.sourceHandle]
      } else {
        result[key] = (d.outputText as string) || (d.text as string) || (d.prompt as string) || (d.result as string) || ''
      }
    }
    return JSON.stringify(result)
  })
  const bracketPinValues = useMemo(() => JSON.parse(bracketPinValuesJson) as Record<string, string>, [bracketPinValuesJson])
  const connectedBrackets = useMemo(() => new Set(Object.keys(bracketPinValues)), [bracketPinValues])

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
    (data.output_mode as OutputMode) ?? 'template'
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
  const [previewCollapsed, setPreviewCollapsed] = useState(data.preview_collapsed === true)
  const [textCollapsed, setTextCollapsed] = useState(data.text_collapsed === true)
  const [outputOverride, setOutputOverride] = useState<string | null>(
    typeof data.output_override === 'string' ? data.output_override : null
  )
  const [editingOutput, setEditingOutput] = useState(false)
  const outputTextareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLPreElement>(null)
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number } | null>(null)

  // Parse brackets from input
  const brackets = useMemo(() => extractBrackets(inputText), [inputText])

  // Deduplicated entries keyed by bracket name
  const uniqueNames = useMemo(() => getUniqueNames(brackets), [brackets])

  // Auto-extract JSON definitions (first block with [name] keys → class values)
  const jsonDefs = useMemo(() => extractJsonDefinitions(inputText), [inputText])

  // Build entries: key = bracket name, val = JSON definition or name itself
  const entries = useMemo(() =>
    uniqueNames.map(u => ({
      key: u.name,
      val: jsonDefs[u.name] ?? u.name,
      count: u.count,
    })),
    [uniqueNames, jsonDefs]
  )

  // Resolve value: pin > override > JSON definition > original name
  function resolveVal(entry: { key: string; val: unknown }): string {
    if (entry.key in bracketPinValues) return bracketPinValues[entry.key]
    if (entry.key in overrides) return overrides[entry.key]
    return typeof entry.val === 'string' ? entry.val : String(entry.val)
  }

  // Included entries (after exclusion + limit)
  const includedEntries = useMemo(() => {
    let items = entries.filter(e => !excludedKeys.has(e.key))
    if (outputLimit > 0) items = items.slice(0, outputLimit)
    return items
  }, [entries, excludedKeys, outputLimit])

  // Build resolved values map for template rebuild (name → resolved value)
  const resolvedValues = useMemo(() => {
    const vals: Record<string, string> = {}
    for (const entry of entries) {
      if (!excludedKeys.has(entry.key)) {
        vals[entry.key] = entry.key in overrides
          ? overrides[entry.key]
          : (jsonDefs[entry.key] ?? entry.key)
      }
    }
    return vals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, overrides, excludedKeys, jsonDefs, bracketPinValuesJson])

  // Items output: resolved values list
  const itemsOutput = useMemo(() => {
    if (includedEntries.length === 0) return ''
    return includedEntries.map(e => resolveVal(e)).join('\n')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, overrides, bracketPinValuesJson])

  // Template output: rebuilt text with name-based substitution (strips brackets)
  const templateOutput = useMemo(() => {
    if (brackets.length === 0) return inputText
    return rebuildTemplate(inputText, brackets, resolvedValues, excludedKeys)
  }, [inputText, brackets, resolvedValues, excludedKeys])

  // Computed output based on mode
  const computedOutput = outputMode === 'template' ? templateOutput : itemsOutput

  // Effective output: override takes precedence
  const effectiveOutput = outputOverride ?? computedOutput

  // Build per-pin output map (one pin per unique name)
  const outputPins = useMemo(() => {
    const pins: Record<string, string> = {}
    includedEntries.forEach((entry, i) => {
      pins[`text-${i}`] = resolveVal(entry)
    })
    return pins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, overrides])

  // Dynamic input slots: text-in + one per bracket entry
  const bracketInputSlots: SlotDef[] = useMemo(() => {
    const slots: SlotDef[] = [{ id: 'text-in', label: 'Text Input', type: 'text' as const }]
    entries.forEach(entry => {
      slots.push({ id: `text-bk-${entry.key}-in`, label: entry.key, type: 'text' as const })
    })
    return slots
  }, [entries])

  // Dynamic output slots
  const outputSlots: SlotDef[] = useMemo(() => {
    const slots: SlotDef[] = [{ id: 'text-out', label: 'Output', type: 'text' as const }]
    includedEntries.forEach((entry, i) => {
      const label = resolveVal(entry)
      const short = label.length > 20 ? label.slice(0, 20) + '...' : label
      slots.push({
        id: `text-${i}`,
        label: `${entry.key}: ${short}`,
        type: 'text' as const,
        hidden: pinsCollapsed,
      })
    })
    return slots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedEntries, pinsCollapsed, overrides, bracketPinValuesJson])

  // Notify React Flow when pin count changes
  useEffect(() => {
    updateNodeInternals(id)
  }, [outputSlots.length, bracketInputSlots.length, pinsCollapsed, id, updateNodeInternals])

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
      preview_collapsed: previewCollapsed, text_collapsed: textCollapsed,
    })
  }, [effectiveOutput, outputMode, overrides, excludedKeys, outputLimit, outputPins, id, updateNodeData, outputOverride, pinsCollapsed, previewCollapsed, textCollapsed])

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
    previewCollapsed, setPreviewCollapsed,
    textCollapsed, setTextCollapsed,
    outputOverride, setOutputOverride,
    editingOutput, setEditingOutput,
    outputTextareaRef,
    previewRef,
    previewSize, setPreviewSize,

    // Computed
    brackets,
    entries,
    includedEntries,
    bracketInputSlots,
    outputSlots,
    connectedBrackets,
    effectiveOutput,
    computedOutput,
    allIncluded,
    unpackError,
    jsonDefs,

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
