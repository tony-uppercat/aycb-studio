// @vitest-environment jsdom
/**
 * Critical-path regression tests for the 5 flows that break most often.
 *
 * 1. Node serialization (serializeNodes)
 * 2. Edge connection rules (getHandleType + areSlotsCompatible)
 * 3. pullText with outputPins
 * 4. Cascade parallel execution
 * 5. History/undo stack doesn't retain File objects
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { renderHook, act } from '@testing-library/react'

import { serializeNodes } from '../hooks/useCanvasPersistence.ts'
import { getHandleType, pullText } from '../hooks/useDataPropagation.ts'
import { areSlotsCompatible } from '../nodes/index'
import {
  registerNodeRun,
  unregisterNodeRun,
  executeCascadesParallel,
  getCascadeProgress,
} from '../utils/cascadeRun.ts'
import { useCanvasHistory } from '../hooks/useCanvasHistory.ts'

// ---------------------------------------------------------------------------
// 1. Node serialization
// ---------------------------------------------------------------------------
describe('serializeNodes', () => {
  it('strips File objects from data', () => {
    const file = new File(['test'], 'test.png', { type: 'image/png' })
    const nodes: Node[] = [{
      id: 'n1', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { file, label: 'keep' },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].data.file).toBeUndefined()
    expect(result[0].data.label).toBe('keep')
  })

  it('strips blob: URLs from data', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { preview: 'blob:http://localhost:3000/abc123', label: 'keep' },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].data.preview).toBeUndefined()
    expect(result[0].data.label).toBe('keep')
  })

  it('strips result and analysisHistory keys', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'imageAnalysis', position: { x: 0, y: 0 },
      data: {
        result: 'huge base64 data...',
        analysisHistory: [{ ts: 1, text: 'old' }],
        outputText: 'actual output',
      },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].data.result).toBeUndefined()
    expect(result[0].data.analysisHistory).toBeUndefined()
    expect(result[0].data.outputText).toBe('actual output')
  })

  it('strips React Flow internals (measured, selected, dragging)', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'textInput', position: { x: 10, y: 20 },
      data: { outputText: 'hello' },
      measured: { width: 200, height: 100 },
      selected: true,
      dragging: false,
    } as Node]
    const result = serializeNodes(nodes)
    expect((result[0] as Record<string, unknown>).measured).toBeUndefined()
    expect((result[0] as Record<string, unknown>).selected).toBeUndefined()
    expect((result[0] as Record<string, unknown>).dragging).toBeUndefined()
  })

  it('preserves mediaId', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { mediaId: 'abc-123', file: new File(['x'], 'x.png') },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].data.mediaId).toBe('abc-123')
    expect(result[0].data.file).toBeUndefined()
  })

  it('preserves outputText', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'textInput', position: { x: 0, y: 0 },
      data: { outputText: 'some text output' },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].data.outputText).toBe('some text output')
  })

  it('handles nested data correctly (only top-level data keys are filtered)', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'llm', position: { x: 0, y: 0 },
      data: {
        config: { nested: 'value', result: 'inside nested is fine' },
        outputText: 'ok',
      },
    }]
    const result = serializeNodes(nodes)
    // Top-level filter only — nested objects are kept as-is
    expect(result[0].data.config).toEqual({ nested: 'value', result: 'inside nested is fine' })
    expect(result[0].data.outputText).toBe('ok')
  })

  it('strips functions and symbols from data', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'textInput', position: { x: 0, y: 0 },
      data: {
        onRun: () => {},
        tag: Symbol('test'),
        outputText: 'kept',
      },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].data.onRun).toBeUndefined()
    expect(result[0].data.tag).toBeUndefined()
    expect(result[0].data.outputText).toBe('kept')
  })

  it('preserves position and id on the node itself', () => {
    const nodes: Node[] = [{
      id: 'node-42', type: 'textInput', position: { x: 100, y: 200 },
      data: { outputText: '' },
    }]
    const result = serializeNodes(nodes)
    expect(result[0].id).toBe('node-42')
    expect(result[0].position).toEqual({ x: 100, y: 200 })
    expect(result[0].type).toBe('textInput')
  })
})

// ---------------------------------------------------------------------------
// 2. Edge connection rules
// ---------------------------------------------------------------------------
describe('getHandleType', () => {
  it('returns "text" for "text-0"', () => {
    expect(getHandleType('text-0')).toBe('text')
  })

  it('returns "text" for "text-out"', () => {
    expect(getHandleType('text-out')).toBe('text')
  })

  it('returns "media" for "media-in"', () => {
    expect(getHandleType('media-in')).toBe('media')
  })

  it('returns "image" for "image-3"', () => {
    expect(getHandleType('image-3')).toBe('image')
  })

  it('returns empty string for null/undefined', () => {
    expect(getHandleType(null)).toBe('')
    expect(getHandleType(undefined)).toBe('')
  })

  it('documents actual behavior for "text-out-0" (known bug source)', () => {
    // "text-out-0": split('-')[0] => "text" — now correctly extracts the type
    const actual = getHandleType('text-out-0')
    expect(actual).toBe('text')
  })

  it('handles "prompt-in" correctly', () => {
    expect(getHandleType('prompt-in')).toBe('prompt')
  })

  it('handles "json-out" correctly', () => {
    expect(getHandleType('json-out')).toBe('json')
  })
})

describe('areSlotsCompatible', () => {
  it('text and prompt are compatible', () => {
    expect(areSlotsCompatible('text', 'prompt')).toBe(true)
    expect(areSlotsCompatible('prompt', 'text')).toBe(true)
  })

  it('media and image are compatible', () => {
    expect(areSlotsCompatible('media', 'image')).toBe(true)
    expect(areSlotsCompatible('image', 'media')).toBe(true)
  })

  it('media and video are compatible', () => {
    expect(areSlotsCompatible('media', 'video')).toBe(true)
    expect(areSlotsCompatible('video', 'media')).toBe(true)
  })

  it('text and image are NOT compatible', () => {
    expect(areSlotsCompatible('text', 'image')).toBe(false)
  })

  it('image and video are NOT compatible', () => {
    expect(areSlotsCompatible('image', 'video')).toBe(false)
  })

  it('same types are always compatible', () => {
    expect(areSlotsCompatible('text', 'text')).toBe(true)
    expect(areSlotsCompatible('image', 'image')).toBe(true)
    expect(areSlotsCompatible('video', 'video')).toBe(true)
    expect(areSlotsCompatible('media', 'media')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. pullText with outputPins
// ---------------------------------------------------------------------------
describe('pullText', () => {
  function makeGetNodes(nodes: Node[]): () => Node[] {
    return () => nodes
  }
  function makeGetEdges(edges: Edge[]): () => Edge[] {
    return () => edges
  }

  it('returns empty string when no edge exists', () => {
    const nodes: Node[] = [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { outputText: 'hello' } },
      { id: 'n2', type: 'llm', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [] // no connection
    const result = pullText('n2', 'prompt-in', makeGetNodes(nodes), makeGetEdges(edges))
    expect(result).toBe('')
  })

  it('reads outputText from source node', () => {
    const nodes: Node[] = [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { outputText: 'hello world' } },
      { id: 'n2', type: 'llm', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'text-out', targetHandle: 'prompt-in' },
    ]
    const result = pullText('n2', 'prompt-in', makeGetNodes(nodes), makeGetEdges(edges))
    expect(result).toBe('hello world')
  })

  it('reads outputPins[sourceHandle] when available', () => {
    const nodes: Node[] = [
      {
        id: 'n1', type: 'jsonParser', position: { x: 0, y: 0 },
        data: {
          outputText: 'fallback text',
          outputPins: { 'text-out': 'pin-specific value' },
        },
      },
      { id: 'n2', type: 'llm', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'text-out', targetHandle: 'prompt-in' },
    ]
    const result = pullText('n2', 'prompt-in', makeGetNodes(nodes), makeGetEdges(edges))
    expect(result).toBe('pin-specific value')
  })

  it('outputPins takes priority over outputText', () => {
    const nodes: Node[] = [
      {
        id: 'n1', type: 'jsonParser', position: { x: 0, y: 0 },
        data: {
          outputText: 'should NOT be returned',
          outputPins: { 'json-out': 'from pin' },
        },
      },
      { id: 'n2', type: 'resultViewer', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'json-out', targetHandle: 'text-in' },
    ]
    const result = pullText('n2', 'text-in', makeGetNodes(nodes), makeGetEdges(edges))
    expect(result).toBe('from pin')
  })

  it('falls back to data.text when outputText is empty', () => {
    const nodes: Node[] = [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { text: 'raw text field' } },
      { id: 'n2', type: 'llm', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'text-out', targetHandle: 'prompt-in' },
    ]
    const result = pullText('n2', 'prompt-in', makeGetNodes(nodes), makeGetEdges(edges))
    expect(result).toBe('raw text field')
  })

  it('follows bypass chain to find real source', () => {
    const nodes: Node[] = [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { outputText: 'origin' } },
      { id: 'n2', type: 'llm', position: { x: 100, y: 0 }, data: { _bypassed: true } },
      { id: 'n3', type: 'resultViewer', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'text-out', targetHandle: 'prompt-in' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'text-out', targetHandle: 'text-in' },
    ]
    const result = pullText('n3', 'text-in', makeGetNodes(nodes), makeGetEdges(edges))
    expect(result).toBe('origin')
  })
})

// ---------------------------------------------------------------------------
// 4. Cascade parallel execution
// ---------------------------------------------------------------------------
describe('executeCascadesParallel', () => {
  afterEach(() => {
    // Clean up registered runs
    ;['a', 'b', 'c', 'shared', 'leaf1', 'leaf2', 'leaf3'].forEach(id => unregisterNodeRun(id))
  })

  it('returns immediately for empty startIds', async () => {
    await executeCascadesParallel([], [])
    // No error = pass
  })

  it('falls through to executeCascade for a single source', async () => {
    const runOrder: string[] = []
    registerNodeRun('a', async () => { runOrder.push('a') })
    registerNodeRun('b', async () => { runOrder.push('b') })

    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'text-out', targetHandle: 'text-in' },
    ]

    await executeCascadesParallel(['b'], edges)
    // Single source delegates to executeCascade — upstream 'a' runs first, then 'b'
    expect(runOrder).toEqual(['a', 'b'])
  })

  it('runs multiple leaf nodes in parallel after shared upstream', async () => {
    const runOrder: string[] = []
    const timestamps: Record<string, number> = {}

    registerNodeRun('shared', async () => {
      runOrder.push('shared')
      timestamps.shared = Date.now()
    })
    registerNodeRun('leaf1', async () => {
      // Small delay to verify parallelism
      await new Promise(r => setTimeout(r, 30))
      runOrder.push('leaf1')
      timestamps.leaf1 = Date.now()
    })
    registerNodeRun('leaf2', async () => {
      await new Promise(r => setTimeout(r, 30))
      runOrder.push('leaf2')
      timestamps.leaf2 = Date.now()
    })

    const edges: Edge[] = [
      { id: 'e1', source: 'shared', target: 'leaf1', sourceHandle: 'text-out', targetHandle: 'text-in' },
      { id: 'e2', source: 'shared', target: 'leaf2', sourceHandle: 'text-out', targetHandle: 'text-in' },
    ]

    await executeCascadesParallel(['leaf1', 'leaf2'], edges)

    // Shared upstream runs first
    expect(runOrder[0]).toBe('shared')
    // Both leaves are present
    expect(runOrder).toContain('leaf1')
    expect(runOrder).toContain('leaf2')
    // Shared runs only once (not duplicated)
    expect(runOrder.filter(x => x === 'shared')).toHaveLength(1)
  })

  it('calls all registered run functions', async () => {
    const fnA = vi.fn()
    const fnB = vi.fn()
    const fnC = vi.fn()

    registerNodeRun('a', fnA)
    registerNodeRun('b', fnB)
    registerNodeRun('c', fnC)

    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'text-out', targetHandle: 'text-in' },
      { id: 'e2', source: 'a', target: 'c', sourceHandle: 'text-out', targetHandle: 'text-in' },
    ]

    await executeCascadesParallel(['b', 'c'], edges)

    expect(fnA).toHaveBeenCalledTimes(1) // shared upstream, once
    expect(fnB).toHaveBeenCalledTimes(1)
    expect(fnC).toHaveBeenCalledTimes(1)
  })

  it('progress is null after completion', async () => {
    registerNodeRun('a', vi.fn())
    await executeCascadesParallel(['a'], [])
    expect(getCascadeProgress()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. History/undo stack doesn't retain File objects
// ---------------------------------------------------------------------------
describe('useCanvasHistory — snapshot stripping', () => {
  it('stored nodes do not contain File instances after snapshot', () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const initialNodes: Node[] = [
      { id: 'n1', type: 'imageUpload', position: { x: 0, y: 0 }, data: { mediaId: 'mid-1' } },
    ]
    const initialEdges: Edge[] = []

    let capturedNodes: Node[] = []
    const setNodes = vi.fn((v: Node[] | ((p: Node[]) => Node[])) => {
      capturedNodes = typeof v === 'function' ? v(capturedNodes) : v
    })
    const setEdges = vi.fn()

    const { result } = renderHook(() =>
      useCanvasHistory(
        () => initialNodes,
        () => initialEdges,
        setNodes,
        setEdges,
        { nodes: initialNodes, edges: initialEdges },
      )
    )

    // Snapshot nodes that contain a File
    const nodesWithFile: Node[] = [
      { id: 'n1', type: 'imageUpload', position: { x: 0, y: 0 }, data: { mediaId: 'mid-1', file } },
    ]

    act(() => {
      result.current.snapshot(nodesWithFile, [])
    })

    // Now undo to restore the snapshot — the stored data should have null instead of File
    act(() => {
      result.current.undo()
    })

    // The first undo goes back to the initial snapshot (index 0)
    // Let's redo to get back to the snapshot we pushed (index 1)
    act(() => {
      result.current.redo()
    })

    // setNodes was called with restored nodes — check the File was stripped (undefined, not null)
    const lastCall = setNodes.mock.calls[setNodes.mock.calls.length - 1]
    const restoredNodes = lastCall[0] as Node[]
    expect(restoredNodes[0].data.file).toBeUndefined()
    expect(restoredNodes[0].data.mediaId).toBe('mid-1')
  })

  it('preserves mediaId in the snapshot', () => {
    const initialNodes: Node[] = [
      { id: 'n1', type: 'imageUpload', position: { x: 0, y: 0 }, data: { mediaId: 'keep-me' } },
    ]

    const setNodes = vi.fn()
    const setEdges = vi.fn()

    const { result } = renderHook(() =>
      useCanvasHistory(
        () => initialNodes,
        () => [],
        setNodes,
        setEdges,
        { nodes: initialNodes, edges: [] },
      )
    )

    act(() => {
      result.current.snapshot(
        [{ id: 'n1', type: 'imageUpload', position: { x: 10, y: 20 }, data: { mediaId: 'keep-me', extra: 'data' } }],
        [],
      )
    })

    act(() => {
      result.current.undo()
      result.current.redo()
    })

    const lastCall = setNodes.mock.calls[setNodes.mock.calls.length - 1]
    const restoredNodes = lastCall[0] as Node[]
    expect(restoredNodes[0].data.mediaId).toBe('keep-me')
  })

  it('strips result and analysisHistory from snapshot data', () => {
    const initialNodes: Node[] = [
      { id: 'n1', type: 'generateImage', position: { x: 0, y: 0 }, data: { mediaId: 'mid-1' } },
    ]

    let capturedNodes: Node[] = []
    const setNodes = vi.fn((v: Node[] | ((p: Node[]) => Node[])) => {
      capturedNodes = typeof v === 'function' ? v(capturedNodes) : v
    })
    const setEdges = vi.fn()

    const { result } = renderHook(() =>
      useCanvasHistory(
        () => initialNodes,
        () => [],
        setNodes,
        setEdges,
        { nodes: initialNodes, edges: [] },
      )
    )

    const heavyNodes: Node[] = [
      {
        id: 'n1', type: 'generateImage', position: { x: 10, y: 20 },
        data: {
          mediaId: 'mid-1',
          result: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAA...huge...',
          analysisHistory: [{ ts: 1, text: 'old analysis with large content' }],
          outputText: 'keep this',
          preview: 'blob:http://localhost:3000/abc123',
        },
      },
    ]

    act(() => {
      result.current.snapshot(heavyNodes, [])
    })

    // Redo to restore the heavy snapshot
    act(() => { result.current.undo() })
    act(() => { result.current.redo() })

    const lastCall = setNodes.mock.calls[setNodes.mock.calls.length - 1]
    const restoredNodes = lastCall[0] as Node[]
    expect(restoredNodes[0].data.result).toBeUndefined()
    expect(restoredNodes[0].data.analysisHistory).toBeUndefined()
    expect(restoredNodes[0].data.preview).toBeUndefined()
    expect(restoredNodes[0].data.mediaId).toBe('mid-1')
    expect(restoredNodes[0].data.outputText).toBe('keep this')
  })

  it('stack is capped at MAX_HISTORY (50)', () => {
    const initialNodes: Node[] = [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { outputText: '' } },
    ]

    let undoCount = 0
    const setNodes = vi.fn(() => { undoCount++ })
    const setEdges = vi.fn()

    const { result } = renderHook(() =>
      useCanvasHistory(
        () => initialNodes,
        () => [],
        setNodes,
        setEdges,
        { nodes: initialNodes, edges: [] },
      )
    )

    // Push 60 snapshots (exceeds MAX_HISTORY of 50)
    act(() => {
      for (let i = 0; i < 60; i++) {
        result.current.snapshot(
          [{ id: 'n1', type: 'textInput', position: { x: i, y: 0 }, data: { outputText: `v${i}` } }],
          [],
        )
      }
    })

    // Now undo as many times as possible
    undoCount = 0
    act(() => {
      for (let i = 0; i < 100; i++) {
        result.current.undo()
      }
    })

    // Should have been able to undo at most 49 times
    // (50 entries in stack means 49 undo steps from the latest to the oldest)
    expect(undoCount).toBeLessThanOrEqual(49)
  })
})

// ---------------------------------------------------------------------------
// 6. Media store — enforceStorageCap
// ---------------------------------------------------------------------------
describe('enforceStorageCap', () => {
  it('is exported from mediaStore', async () => {
    const mod = await import('../mediaStore')
    expect(typeof mod.enforceStorageCap).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 7. Review status cache cap
// ---------------------------------------------------------------------------
describe('reviewStatus cache', () => {
  it('clearReviewCache is exported', async () => {
    const mod = await import('../utils/reviewStatus')
    expect(typeof mod.clearReviewCache).toBe('function')
  })

  it('MAX_REVIEW_CACHE is exported and is a reasonable number', async () => {
    const mod = await import('../utils/reviewStatus')
    expect(typeof mod.MAX_REVIEW_CACHE).toBe('number')
    expect(mod.MAX_REVIEW_CACHE).toBeGreaterThanOrEqual(100)
    expect(mod.MAX_REVIEW_CACHE).toBeLessThanOrEqual(1000)
  })
})

// ---------------------------------------------------------------------------
// 8. Cost estimation — resolution-aware pricing
// ---------------------------------------------------------------------------
describe('estimateCost resolution-aware pricing', () => {
  it('returns correct cost per resolution for Nano Banana 2', async () => {
    const { estimateCost } = await import('../utils/costEstimate')
    const r1k  = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'test', 0, 0, 1, '1K')
    const r2k  = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'test', 0, 0, 1, '2K')
    // Flash+4K is auto-swapped to Pro at the provider level (Issue #1461 workaround).
    // Cost estimate mirrors that swap: returns Pro 4K price ($0.240), not Flash 4K ($0.151).
    const r4k  = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'test', 0, 0, 1, '4K')
    expect(r1k.costUsd).toBeCloseTo(0.067, 3)
    expect(r2k.costUsd).toBeCloseTo(0.101, 3)
    expect(r4k.costUsd).toBeCloseTo(0.240, 3)
  })

  it('defaults to 1K price when resolution is empty', async () => {
    const { estimateCost } = await import('../utils/costEstimate')
    const rAuto = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'test', 0, 0, 1, '')
    expect(rAuto.costUsd).toBeCloseTo(0.067, 3)
  })

  it('adds input cost for reference images in edit mode', async () => {
    const { estimateCost } = await import('../utils/costEstimate')
    const noRef = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'test', 0, 0, 1, '1K')
    const withRef = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'test', 1, 0, 1, '1K')
    expect(withRef.costUsd).toBeGreaterThan(noRef.costUsd)
    expect(withRef.inputTokens).toBe(560)
    // Input cost: 560 tokens * $0.50/M = $0.00028
    expect(withRef.costUsd - noRef.costUsd).toBeCloseTo(0.00028, 4)
  })

  it('returns correct cost for Nano Banana Pro', async () => {
    const { estimateCost } = await import('../utils/costEstimate')
    const r1k = estimateCost('gemini-3-pro-image-preview', 'generate_image', 'test', 0, 0, 1, '1K')
    const r4k = estimateCost('gemini-3-pro-image-preview', 'generate_image', 'test', 0, 0, 1, '4K')
    expect(r1k.costUsd).toBeCloseTo(0.134, 3)
    expect(r4k.costUsd).toBeCloseTo(0.240, 3)
  })
})
