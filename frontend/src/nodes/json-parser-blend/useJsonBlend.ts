import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import { pullText, resolveSourceText } from '../../hooks/useDataPropagation'
import { isCascadeRunning } from '../../utils/cascadeRun'
import type { SlotDef } from '../_shared/NodeShell'

// key -> source index (0-based) or null (excluded)
type Sel = Record<string, number | null>
export type OutputFormat = 'json' | 'values' | 'kv'

const MAX_INPUTS = 10

function tryParse(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    let clean = text.trim()
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start === -1 || end === -1) return null
    clean = clean.slice(start, end + 1)
    const v = JSON.parse(clean)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
    return null
  } catch { return null }
}

interface BlendData {
  selections?: Sel
  excludedKeys?: string[]
  outputLimit?: number
  outputFormat?: OutputFormat
  overrides?: Record<string, string>
  outputText?: string
}

export function useJsonBlend(id: string, data: BlendData) {
  const { updateNodeData, getNodes, getEdges, setEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  // Dynamic input pins.
  // During cascade, pin count must never decrease (high-water mark)
  // to prevent React Flow from removing edges to vanished handles.
  const connectedCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('text-')).length
  )
  const rawPinCount = Math.min(Math.max(connectedCount + 1, 2), MAX_INPUTS)
  const pinCountRef = useRef(rawPinCount)
  if (isCascadeRunning()) {
    pinCountRef.current = Math.max(pinCountRef.current, rawPinCount)
  } else {
    pinCountRef.current = rawPinCount
  }
  const pinCount = pinCountRef.current
  const inputSlots: SlotDef[] = Array.from({ length: pinCount }, (_, i) => ({
    id: `text-${i}`,
    label: `JSON ${i + 1}`,
    type: 'text' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [pinCount, id, updateNodeInternals])

  // Subscribe to upstream data changes. Walks subnets via resolveSourceText
  // so sub_graph inner edits trigger re-render here.
  useStore(state => {
    const edges = state.edges.filter(e => e.target === id)
    return edges.map(e => {
      const txt = resolveSourceText(e.source, e.sourceHandle ?? '', state.nodes, state.edges)
      return `${e.source}:${e.targetHandle}:${txt}`
    }).join('|')
  })

  // Pull and parse all inputs
  const objects = useMemo(() => {
    const result: (Record<string, unknown> | null)[] = []
    for (let i = 0; i < pinCount; i++) {
      const raw = pullText(id, `text-${i}`, getNodes, getEdges)
      result.push(tryParse(raw))
    }
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinCount, connectedCount, id, getNodes, getEdges])

  // Collect all unique keys across all inputs
  const { allKeys, keyPresence } = useMemo(() => {
    const keysSet = new Set<string>()
    const presence = new Map<string, Set<number>>()
    objects.forEach((obj, i) => {
      if (!obj) return
      for (const k of Object.keys(obj)) {
        keysSet.add(k)
        if (!presence.has(k)) presence.set(k, new Set())
        presence.get(k)!.add(i)
      }
    })
    return { allKeys: [...keysSet], keyPresence: presence }
  }, [objects])

  const activeInputs = objects.reduce((count, obj) => count + (obj ? 1 : 0), 0)
  const connectedIndices = objects.map((obj, i) => obj ? i : -1).filter(i => i >= 0)

  const [sel, setSel] = useState<Sel>(() => data.selections as Sel ?? {})
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(() => new Set(data.excludedKeys ?? []))
  const [outputLimit, setOutputLimit] = useState<number>(() => data.outputLimit ?? 0)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>((data.outputFormat as OutputFormat) ?? 'json')
  const [overrides, setOverrides] = useState<Record<string, string>>((data.overrides as Record<string, string>) ?? {})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const escapedRef = useRef(false)

  // Effective selection with defaults
  const effectiveSel = useMemo(() => {
    const next = { ...sel }
    for (const k of allKeys) {
      if (!(k in next)) {
        const sources = keyPresence.get(k)
        next[k] = sources ? [...sources][0] : null
      }
    }
    return next
  }, [sel, allKeys, keyPresence])

  // Resolve value: override or original from selected source
  function resolveVal(key: string): string {
    if (key in overrides) return overrides[key]
    const src = effectiveSel[key]
    if (src === null || src === undefined) return ''
    const obj = objects[src]
    if (!obj || !(key in obj)) return ''
    const v = obj[key]
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  }

  // Build output respecting format + overrides
  const output = useMemo(() => {
    if (activeInputs === 0) return data.outputText ?? ''
    const items: { key: string; val: unknown }[] = []
    let count = 0
    for (const key of allKeys) {
      if (excludedKeys.has(key)) continue
      if (outputLimit > 0 && count >= outputLimit) break
      if (key in overrides) {
        items.push({ key, val: overrides[key] })
        count++
        continue
      }
      const src = effectiveSel[key]
      if (src === null || src === undefined) continue
      const obj = objects[src]
      if (obj && key in obj) {
        items.push({ key, val: obj[key] })
        count++
      }
    }
    if (items.length === 0) return '{}'
    if (outputFormat === 'values') {
      return items.map(e => typeof e.val === 'string' ? e.val : JSON.stringify(e.val, null, 2)).join('\n')
    }
    if (outputFormat === 'kv') {
      return items.map(e => {
        const v = typeof e.val === 'string' ? e.val : JSON.stringify(e.val, null, 2)
        return `${e.key}: ${v}`
      }).join('\n')
    }
    const result: Record<string, unknown> = {}
    items.forEach(e => { result[e.key] = e.val })
    return JSON.stringify(result, null, 2)
  }, [effectiveSel, objects, activeInputs, data.outputText, allKeys, excludedKeys, outputLimit, outputFormat, overrides])

  // Sync output
  const prevOutputRef = useRef(output)
  useEffect(() => {
    if (activeInputs === 0) return
    if (prevOutputRef.current === output) return
    prevOutputRef.current = output
    updateNodeData(id, {
      outputText: output, selections: effectiveSel, outputFormat, overrides,
      excludedKeys: [...excludedKeys], outputLimit,
    })
  }, [output, effectiveSel, id, updateNodeData, activeInputs, excludedKeys, outputLimit, outputFormat, overrides])

  function toggle(key: string, source: number) {
    setSel(prev => ({ ...prev, [key]: prev[key] === source ? null : source }))
  }

  // Swap edges connected to two input pins
  function swapInputs(a: number, b: number) {
    const handleA = `text-${a}`
    const handleB = `text-${b}`
    setEdges(edges => edges.map(e => {
      if (e.target !== id) return e
      if (e.targetHandle === handleA) return { ...e, targetHandle: handleB }
      if (e.targetHandle === handleB) return { ...e, targetHandle: handleA }
      return e
    }))
    setSel(prev => {
      const next: Sel = {}
      for (const [k, v] of Object.entries(prev)) {
        if (v === a) next[k] = b
        else if (v === b) next[k] = a
        else next[k] = v
      }
      return next
    })
  }

  // Alt+Click isolation (Photoshop-style)
  function toggleExclude(key: string, e?: React.MouseEvent) {
    if (e?.altKey) {
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

  const allIncluded = allKeys.length > 0 && allKeys.every(k => !excludedKeys.has(k))

  function toggleAllExclusion() {
    if (allIncluded) setExcludedKeys(new Set(allKeys))
    else setExcludedKeys(new Set())
  }

  return {
    inputSlots,
    allKeys,
    keyPresence,
    activeInputs,
    connectedIndices,
    sel,
    excludedKeys,
    outputLimit,
    setOutputLimit,
    outputFormat,
    setOutputFormat,
    overrides,
    setOverrides,
    editingKey,
    setEditingKey,
    escapedRef,
    effectiveSel,
    objects,
    output,
    resolveVal,
    toggle,
    swapInputs,
    toggleExclude,
    allIncluded,
    toggleAllExclusion,
  }
}

export default useJsonBlend
