/**
 * Tests for useDataPropagation — subnet-aware resolveSource branches.
 *
 * Covers:
 * - Pulling text from a subnet's external output handle: reactively walks
 *   DOWN into sub_graph, follows the edge feeding the matching
 *   subnet-output proxy, returns the live source node (no Run on proxy).
 * - Pulling text from a subnet-input proxy inside a subnet: walks UP to
 *   the parent's external edge.
 * - Failure paths: no inner edge, missing sub_graph, orphan pin.
 * - Regression guard: bypass chain still walks upstream.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { pullText, pullMedia, pullAllMedia, resolveSourceMediaId } from './useDataPropagation'

vi.mock('../mediaStore', () => ({
  loadMedia: vi.fn(async (id: string) => new File([id], `${id}.png`, { type: 'image/png' })),
}))

describe('pullText with subnet source', () => {
  it('reactively walks DOWN through subnet-output proxy to internal source', () => {
    // Internal source feeds the proxy; consumer reads its live outputText
    // without any Run on the proxy.
    const internal_source: Node = {
      id: 'inner-src',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { outputText: 'hello' },
    }
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'out1',
        name: 'out1',
        slot_type: 'text',
        // No `result` cache — the reactive path bypasses it.
      },
    }
    const inner_edges: Edge[] = [{
      id: 'e-inner', source: 'inner-src', sourceHandle: 'text-out',
      target: 'proxy-out', targetHandle: 'in',
    }]
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Subnet',
        sub_graph: {
          nodes: [internal_source, inner_proxy],
          edges: inner_edges,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        external_outputs: [{ handle_id: 'out1', name: 'out1', slot_type: 'text' }],
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const nodes = [subnet, reader]
    const result = pullText('reader', 'in', () => nodes, () => edges)
    expect(result).toBe('hello')
  })

  it('returns empty string when nothing is connected to the subnet-output proxy (failure path)', () => {
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'out1',
        name: 'out1',
        slot_type: 'text',
      },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_proxy],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })

  it('reactively walks up through subnet-input proxy to external source', async () => {
    // Inside a subnet: a consumer pulls text from a subnet-input proxy
    // sibling. The proxy has NO data.result cached (no Run was pressed);
    // resolveSource walks up to the containing subnet's external edge and
    // reads the external upstream node directly. This is the post-audit
    // reactive behavior — no need to Run the proxy.
    const { setRootTree, resetRootTree } = await import('./rootTreeGetter')

    const subnet_input_proxy: Node = {
      id: 'proxy-in',
      type: 'subnet-input',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'in1',
        name: 'in1',
        slot_type: 'text',
        // NOTE: no `result` field — the proxy has never Run.
      },
    }
    const consumer: Node = {
      id: 'consumer',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const inner_edges: Edge[] = [{
      id: 'e-inner',
      source: 'proxy-in',
      sourceHandle: 'out',
      target: 'consumer',
      targetHandle: 'in',
    }]

    // Parent-level: an external text-input node feeding the subnet's in1 pin.
    const external_source: Node = {
      id: 'src',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { outputText: 'hello from outside' },
    }
    const subnet: Node = {
      id: 'subnet-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [subnet_input_proxy, consumer],
          edges: inner_edges,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const external_edge: Edge = {
      id: 'e-ext', source: 'src', sourceHandle: 'text-out',
      target: 'subnet-1', targetHandle: 'in1',
    }

    setRootTree({
      root_nodes: [external_source, subnet],
      root_edges: [external_edge],
    })
    try {
      const result = pullText('consumer', 'in', () => [subnet_input_proxy, consumer], () => inner_edges)
      expect(result).toBe('hello from outside')
    } finally {
      resetRootTree()
    }
  })

  it('returns empty string when subnet-input proxy has no parent edge', async () => {
    const { setRootTree, resetRootTree } = await import('./rootTreeGetter')
    const proxy: Node = {
      id: 'orphan-proxy',
      type: 'subnet-input',
      position: { x: 0, y: 0 },
      data: { handle_id: 'h1', name: 'n', slot_type: 'text' },
    }
    const consumer: Node = { id: 'c', type: 'result-viewer', position: { x: 0, y: 0 }, data: {} }
    const inner_edges: Edge[] = [{ id: 'e', source: 'orphan-proxy', sourceHandle: 'out', target: 'c', targetHandle: 'in' }]
    const subnet: Node = {
      id: 'sub', type: 'subnet', position: { x: 0, y: 0 },
      data: { sub_graph: { nodes: [proxy, consumer], edges: inner_edges, viewport: { x: 0, y: 0, zoom: 1 } } },
    }
    // No external edge feeding the subnet.
    setRootTree({ root_nodes: [subnet], root_edges: [] })
    try {
      const result = pullText('c', 'in', () => [proxy, consumer], () => inner_edges)
      expect(result).toBe('')
    } finally {
      resetRootTree()
    }
  })

  it('returns empty string when subnet has no sub_graph (malformed subnet)', () => {
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        // sub_graph intentionally missing
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })

  it('returns empty string when subnet-output proxy with matching handle_id not found (orphan pin)', () => {
    // Subnet has a subnet-output proxy, but its handle_id does not match the
    // sourceHandle the reader is pulling from.
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'other-pin',
        name: 'other-pin',
        slot_type: 'text',
        result: 'should not be read',
      },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_proxy],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })
})

describe('pullMedia / pullAllMedia honor outputMediaIds (proxy passthrough)', () => {
  it('pullAllMedia reads outputMediaIds[srcHandle] when present, not data.mediaId', async () => {
    // Image node in proxy mode preserves its own data.mediaId and exposes the
    // upstream image via outputMediaIds['image-out']. Multi-input downstream
    // (generate-image refs, llm media, image-edit subjects, image-merge) used
    // to ignore outputMediaIds and read the stale data.mediaId — this test
    // pins the proxy-aware behavior.
    const proxy_image: Node = {
      id: 'image-1',
      type: 'imageUpload',
      position: { x: 0, y: 0 },
      data: {
        mediaId: 'own-image',
        outputMediaIds: { 'image-out': 'proxy-incoming' },
      },
    }
    const downstream: Node = {
      id: 'gen-1', type: 'generateImage', position: { x: 0, y: 0 }, data: {},
    }
    const edges: Edge[] = [
      { id: 'e1', source: 'image-1', sourceHandle: 'image-out', target: 'gen-1', targetHandle: 'image-0' },
    ]
    const files = await pullAllMedia('gen-1', 'image-', () => [proxy_image, downstream], () => edges)
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('proxy-incoming.png')
  })

  it('pullAllMedia falls back to data.mediaId when outputMediaIds has no matching handle', async () => {
    const node: Node = {
      id: 'image-1', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { mediaId: 'own-image' },
    }
    const downstream: Node = { id: 'gen-1', type: 'generateImage', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'e1', source: 'image-1', sourceHandle: 'image-out', target: 'gen-1', targetHandle: 'image-0' },
    ]
    const files = await pullAllMedia('gen-1', 'image-', () => [node, downstream], () => edges)
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('own-image.png')
  })

  it('pullMedia regression guard: still honors outputMediaIds for single-input', async () => {
    const proxy_image: Node = {
      id: 'image-1', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { mediaId: 'own-image', outputMediaIds: { 'image-out': 'proxy-incoming' } },
    }
    const downstream: Node = { id: 'fx-1', type: 'imageFx', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'e1', source: 'image-1', sourceHandle: 'image-out', target: 'fx-1', targetHandle: 'image-in' },
    ]
    const { file, mediaId } = await pullMedia('fx-1', 'image-in', () => [proxy_image, downstream], () => edges)
    expect(mediaId).toBe('proxy-incoming')
    expect(file?.name).toBe('proxy-incoming.png')
  })
})

describe('pullMedia / pullAllMedia through a subnet boundary (end-to-end)', () => {
  it('pullMedia walks DOWN into subnet sub_graph and loads the inner source file', async () => {
    const inner_src: Node = {
      id: 'inner-img', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { mediaId: 'mid-inside-sub' },
    }
    const inner_proxy: Node = {
      id: 'proxy-out', type: 'subnet-output', position: { x: 0, y: 0 },
      data: { handle_id: 'out-abc', name: 'img', slot_type: 'image' },
    }
    const subnet: Node = {
      id: 'sub-1', type: 'subnet', position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_src, inner_proxy],
          edges: [{ id: 'in-e', source: 'inner-img', sourceHandle: 'image-out', target: 'proxy-out', targetHandle: 'in' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        external_outputs: [{ handle_id: 'out-abc', name: 'img', slot_type: 'image' }],
      },
    }
    const consumer: Node = { id: 'fx', type: 'imageFx', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'ext', source: 'sub-1', sourceHandle: 'out-abc', target: 'fx', targetHandle: 'image-in' },
    ]
    const { file, mediaId } = await pullMedia('fx', 'image-in', () => [subnet, consumer], () => edges)
    expect(mediaId).toBe('mid-inside-sub')
    expect(file?.name).toBe('mid-inside-sub.png')
  })

  it('pullAllMedia honors per-pin batch outputs across subnet (image-out-1 inner → external)', async () => {
    // Inner generate-image in batch mode exposes outputMediaIds; the inner edge
    // taps the second batch slot. Across the subnet boundary, the consumer's
    // pullAllMedia must read mid-batch-2, not the first slot.
    const inner_gen: Node = {
      id: 'inner-gen', type: 'generateImage', position: { x: 0, y: 0 },
      data: { outputMediaIds: { 'image-out': 'mid-batch-1', 'image-out-1': 'mid-batch-2' } },
    }
    const inner_proxy: Node = {
      id: 'proxy-out', type: 'subnet-output', position: { x: 0, y: 0 },
      data: { handle_id: 'out-batch', name: 'pick', slot_type: 'image' },
    }
    const subnet: Node = {
      id: 'sub-1', type: 'subnet', position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_gen, inner_proxy],
          edges: [{ id: 'in-e', source: 'inner-gen', sourceHandle: 'image-out-1', target: 'proxy-out', targetHandle: 'in' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const consumer: Node = { id: 'gen2', type: 'generateImage', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'ext', source: 'sub-1', sourceHandle: 'out-batch', target: 'gen2', targetHandle: 'image-0' },
    ]
    const files = await pullAllMedia('gen2', 'image-', () => [subnet, consumer], () => edges)
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('mid-batch-2.png')
  })

  it('pullText walks DOWN into subnet sub_graph for text outputs', () => {
    const inner_src: Node = {
      id: 'txt', type: 'textInput', position: { x: 0, y: 0 },
      data: { outputText: 'hello from inside' },
    }
    const inner_proxy: Node = {
      id: 'proxy-txt', type: 'subnet-output', position: { x: 0, y: 0 },
      data: { handle_id: 'out-t', name: 't', slot_type: 'text' },
    }
    const subnet: Node = {
      id: 'sub-1', type: 'subnet', position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_src, inner_proxy],
          edges: [{ id: 'in-e', source: 'txt', sourceHandle: 'text-out', target: 'proxy-txt', targetHandle: 'in' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const consumer: Node = { id: 'rv', type: 'resultViewer', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'ext', source: 'sub-1', sourceHandle: 'out-t', target: 'rv', targetHandle: 'in' },
    ]
    const text = pullText('rv', 'in', () => [subnet, consumer], () => edges)
    expect(text).toBe('hello from inside')
  })
})

describe('resolveSourceMediaId (sync helper for reactive selectors)', () => {
  it('returns mediaId of a direct source', () => {
    const src: Node = {
      id: 'img-1', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { mediaId: 'mid-direct' },
    }
    const consumer: Node = { id: 'c', type: 'imageFx', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'e1', source: 'img-1', sourceHandle: 'image-out', target: 'c', targetHandle: 'image-in' },
    ]
    const mid = resolveSourceMediaId('img-1', 'image-out', [src, consumer], edges)
    expect(mid).toBe('mid-direct')
  })

  it('returns per-pin outputMediaIds when present (batch / proxy passthrough)', () => {
    const src: Node = {
      id: 'gen-1', type: 'generateImage', position: { x: 0, y: 0 },
      data: { mediaId: 'fallback', outputMediaIds: { 'image-out-1': 'mid-batch-1' } },
    }
    const mid = resolveSourceMediaId('gen-1', 'image-out-1', [src], [])
    expect(mid).toBe('mid-batch-1')
  })

  it('walks DOWN into a subnet to read the inner source mediaId', () => {
    // The bug this fixes: useImageUpload's reactive selector previously read
    // src.data directly. When src is a subnet, src.data has no mediaId — the
    // real one lives on a node inside sub_graph.nodes. Without resolveSource,
    // proxy mode never activates.
    const inner_src: Node = {
      id: 'inner-img', type: 'imageUpload', position: { x: 0, y: 0 },
      data: { mediaId: 'mid-inside-subnet' },
    }
    const inner_proxy: Node = {
      id: 'proxy-out', type: 'subnet-output', position: { x: 0, y: 0 },
      data: { handle_id: 'out1', name: 'out1', slot_type: 'image' },
    }
    const inner_edges: Edge[] = [{
      id: 'e-inner', source: 'inner-img', sourceHandle: 'image-out',
      target: 'proxy-out', targetHandle: 'in',
    }]
    const subnet: Node = {
      id: 'sub-1', type: 'subnet', position: { x: 0, y: 0 },
      data: {
        sub_graph: { nodes: [inner_src, inner_proxy], edges: inner_edges, viewport: { x: 0, y: 0, zoom: 1 } },
        external_outputs: [{ handle_id: 'out1', name: 'out1', slot_type: 'image' }],
      },
    }
    const consumer: Node = { id: 'c', type: 'imageUpload', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'ext', source: 'sub-1', sourceHandle: 'out1', target: 'c', targetHandle: 'image-in' },
    ]
    const mid = resolveSourceMediaId('sub-1', 'out1', [subnet, consumer], edges)
    expect(mid).toBe('mid-inside-subnet')
  })

  it('returns null when no source can be resolved', () => {
    const mid = resolveSourceMediaId('does-not-exist', 'image-out', [], [])
    expect(mid).toBeNull()
  })
})

describe('pullText regression: bypass chain', () => {
  it('walks through a bypassed node to find the real upstream source', () => {
    // source -> bypassed -> reader
    // bypassed node has _bypassed=true; resolver should walk back to source
    const upstream: Node = {
      id: 'upstream',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { text: 'from upstream' },
    }
    const bypassed: Node = {
      id: 'bypassed',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { _bypassed: true, text: 'should be skipped' },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'upstream',
        sourceHandle: 'out',
        target: 'bypassed',
        targetHandle: 'in',
      },
      {
        id: 'e2',
        source: 'bypassed',
        sourceHandle: 'out',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText(
      'reader',
      'in',
      () => [upstream, bypassed, reader],
      () => edges,
    )
    expect(result).toBe('from upstream')
  })
})
