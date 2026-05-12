import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { pullText, resolveSourceText } from '../../hooks/useDataPropagation'

export interface FindReplaceRule {
  find: string
  replace: string
}

export type OutputFormat = 'value' | 'kv' | 'json'

export interface FindReplaceNodeData extends Record<string, unknown> {
  outputText?: string
  rules?: FindReplaceRule[]
  case_sensitive?: boolean
  use_regex?: boolean
  output_format?: OutputFormat
  manual_input?: string
  manual_mode?: boolean
  preview_collapsed?: boolean
}

export function useFindReplace(id: string, data: FindReplaceNodeData) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()

  // Re-render trigger that walks subnets so sub_graph inner edits propagate.
  useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'text-in')
    if (!edge) return ''
    return resolveSourceText(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges)
  })

  function handleRun() {
    const upstream = pullText(id, 'text-in', getNodes, getEdges)
    if (upstream) updateNodeData(id, { text: upstream })
  }

  const [manualMode, setManualMode] = useState(data.manual_mode === true)
  const [manualInput, setManualInput] = useState(typeof data.manual_input === 'string' ? data.manual_input : '')
  const upstreamText = pullText(id, 'text-in', getNodes, getEdges)
  const inputText = manualMode ? manualInput : upstreamText

  const [rules, setRules] = useState<FindReplaceRule[]>(
    Array.isArray(data.rules) && data.rules.length > 0 ? data.rules : [{ find: '', replace: '' }]
  )
  const [caseSensitive, setCaseSensitive] = useState(data.case_sensitive === true)
  const [useRegex, setUseRegex] = useState(data.use_regex === true)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    (data.output_format as OutputFormat) ?? 'value'
  )
  const [previewCollapsed, setPreviewCollapsed] = useState(data.preview_collapsed === true)

  const result = useMemo(() => {
    if (!inputText.trim()) return { text: '', matches: 0, details: [] as Array<{ find: string; replace: string; count: number }> }

    let text = inputText
    let totalMatches = 0
    const details: Array<{ find: string; replace: string; count: number }> = []

    for (const rule of rules) {
      if (!rule.find) continue
      try {
        const pattern = useRegex ? rule.find : rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const flags = caseSensitive ? 'g' : 'gi'
        const re = new RegExp(pattern, flags)
        const matches = text.match(re)
        const count = matches?.length ?? 0
        text = text.replace(re, rule.replace)
        totalMatches += count
        details.push({ find: rule.find, replace: rule.replace, count })
      } catch {
        details.push({ find: rule.find, replace: rule.replace, count: 0 })
      }
    }

    return { text, matches: totalMatches, details }
  }, [inputText, rules, caseSensitive, useRegex])

  const formattedOutput = useMemo(() => {
    if (!inputText.trim()) return ''
    if (outputFormat === 'kv') {
      return result.details
        .filter(d => d.find)
        .map(d => `${d.find}: ${d.replace} (${d.count})`)
        .join('\n')
    }
    if (outputFormat === 'json') {
      return JSON.stringify({
        original: inputText,
        result: result.text,
        total_matches: result.matches,
        rules: result.details.filter(d => d.find),
      }, null, 2)
    }
    return result.text
  }, [inputText, result, outputFormat])

  const HIGHLIGHT_COLORS = [
    'rgba(245,39,118,0.35)',
    'rgba(59,130,246,0.35)',
    'rgba(34,197,94,0.35)',
    'rgba(249,115,22,0.35)',
    'rgba(168,85,247,0.35)',
    'rgba(234,179,8,0.35)',
    'rgba(6,182,212,0.35)',
    'rgba(239,68,68,0.35)',
  ]

  const highlightedHtml = useMemo(() => {
    if (!inputText.trim() || outputFormat !== 'value') return ''
    const S = '\x01', E = '\x02'
    let text = inputText
    let ruleIdx = 0
    for (const rule of rules) {
      if (!rule.find) { ruleIdx++; continue }
      try {
        const pattern = useRegex ? rule.find : rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const flags = caseSensitive ? 'g' : 'gi'
        const re = new RegExp(pattern, flags)
        const idx = ruleIdx
        text = text.replace(re, `${S}${String.fromCharCode(idx)}${rule.replace}${E}`)
      } catch { /* skip invalid regex */ }
      ruleIdx++
    }
    let html = ''
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === S) {
        const idx = text.charCodeAt(++i)
        const bg = HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length]
        html += `<mark style="background:${bg};border-radius:2px;padding:0 1px">`
        continue
      }
      if (ch === E) { html += '</mark>'; continue }
      if (ch === '&') html += '&amp;'
      else if (ch === '<') html += '&lt;'
      else if (ch === '>') html += '&gt;'
      else if (ch === '"') html += '&quot;'
      else html += ch
    }
    return html
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText, rules, caseSensitive, useRegex, outputFormat])

  const prevOutputRef = useRef('')
  useEffect(() => {
    if (prevOutputRef.current === formattedOutput) return
    prevOutputRef.current = formattedOutput
    updateNodeData(id, {
      outputText: formattedOutput,
      rules, case_sensitive: caseSensitive, use_regex: useRegex,
      output_format: outputFormat, manual_input: manualInput, manual_mode: manualMode,
      preview_collapsed: previewCollapsed,
    })
  }, [formattedOutput, rules, caseSensitive, useRegex, outputFormat, manualInput, manualMode, previewCollapsed, id, updateNodeData])

  function addRule() {
    setRules(prev => [...prev, { find: '', replace: '' }])
  }

  function removeRule(index: number) {
    setRules(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))
  }

  function updateRule(index: number, field: 'find' | 'replace', value: string) {
    setRules(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  return {
    manualMode, setManualMode,
    manualInput, setManualInput,
    inputText,
    rules, addRule, removeRule, updateRule,
    caseSensitive, setCaseSensitive,
    useRegex, setUseRegex,
    outputFormat, setOutputFormat,
    previewCollapsed, setPreviewCollapsed,
    result,
    formattedOutput,
    highlightedHtml,
    handleRun,
  }
}
