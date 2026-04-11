import { describe, it, expect, vi } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import manifest from './node.manifest'
import SubnetOutputNode, { buildOutputOnRun, type SubnetOutputNodeData } from './SubnetOutputNode'

// Mock mediaStore — jsdom does not provide indexedDB and we only need
// to verify the mediaId fallback path when loadMedia returns null.
vi.mock('../../mediaStore', () => ({
  loadMedia: vi.fn(async () => null),
  saveMedia: vi.fn(async () => ''),
  deleteMedia: vi.fn(async () => {}),
}))

describe('subnet-output component', () => {
  it('default export is a memoized component', () => {
    expect(SubnetOutputNode).toBeDefined()
    expect(typeof SubnetOutputNode).toBe('object')
  })
})

describe('subnet-output manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('subnet-output')
    expect(manifest.label).toBe('Subnet Output')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has one input handle', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0].handleId).toBe('in')
  })

  it('has no outputs (proxy is a sink)', () => {
    expect(manifest.outputs).toHaveLength(0)
  })

  it('defaults include handle_id, name, slot_type', () => {
    const d = manifest.defaultData
    expect(d).toHaveProperty('handle_id')
    expect(d).toHaveProperty('name')
    expect(d.slot_type).toBe('text')
  })
})

// ── buildOutputOnRun pure helper ──────────────────────────────────────────

type NodeData = Record<string, unknown>

function makeTextSourceNode(id: string, text: string): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { outputText: text } as NodeData,
  } as Node
}

function makeMediaSourceNode(id: string, file: File, mediaId?: string): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { file, mediaId } as NodeData,
  } as Node
}

function makeEdge(source: string, target: string, targetHandle = 'in'): Edge {
  return { id: `${source}->${target}`, source, target, targetHandle }
}

describe('buildOutputOnRun', () => {
  it('is exported as a function', () => {
    expect(typeof buildOutputOnRun).toBe('function')
  })

  it('pulls text from upstream for text slot_type and writes result', async () => {
    const id = 'out-1'
    const upstream = makeTextSourceNode('src-1', 'hello world')
    const nodes: Node[] = [upstream, { id, position: { x: 0, y: 0 }, data: {} } as Node]
    const edges: Edge[] = [makeEdge('src-1', id)]
    const data: SubnetOutputNodeData = { handle_id: 'h1', name: 'output', slot_type: 'text' }
    const updateNodeData = vi.fn()

    const onRun = buildOutputOnRun(id, () => data, () => nodes, () => edges, updateNodeData)
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(id, { result: 'hello world' })
  })

  it('pulls text for prompt slot_type', async () => {
    const id = 'out-2'
    const upstream = makeTextSourceNode('src-2', 'a poem')
    const nodes: Node[] = [upstream, { id, position: { x: 0, y: 0 }, data: {} } as Node]
    const edges: Edge[] = [makeEdge('src-2', id)]
    const data: SubnetOutputNodeData = { handle_id: 'h2', name: 'output', slot_type: 'prompt' }
    const updateNodeData = vi.fn()

    const onRun = buildOutputOnRun(id, () => data, () => nodes, () => edges, updateNodeData)
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(id, { result: 'a poem' })
  })

  it('pulls media File for image slot_type and writes it to result', async () => {
    const id = 'out-3'
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const upstream = makeMediaSourceNode('src-3', file, 'media-id-1')
    const nodes: Node[] = [upstream, { id, position: { x: 0, y: 0 }, data: {} } as Node]
    const edges: Edge[] = [makeEdge('src-3', id)]
    const data: SubnetOutputNodeData = { handle_id: 'h3', name: 'output', slot_type: 'image' }
    const updateNodeData = vi.fn()

    const onRun = buildOutputOnRun(id, () => data, () => nodes, () => edges, updateNodeData)
    await onRun()

    expect(updateNodeData).toHaveBeenCalledTimes(1)
    const call = updateNodeData.mock.calls[0]
    expect(call[0]).toBe(id)
    expect(call[1]).toEqual({ result: file })
  })

  it('falls back to mediaId when no file is present for media slot_type', async () => {
    const id = 'out-4'
    // Source has only mediaId, no file/imageFile/videoFile
    const upstream: Node = {
      id: 'src-4',
      position: { x: 0, y: 0 },
      data: { mediaId: 'media-xyz' } as NodeData,
    } as Node
    const nodes: Node[] = [upstream, { id, position: { x: 0, y: 0 }, data: {} } as Node]
    const edges: Edge[] = [makeEdge('src-4', id)]
    const data: SubnetOutputNodeData = { handle_id: 'h4', name: 'output', slot_type: 'media' }
    const updateNodeData = vi.fn()

    const onRun = buildOutputOnRun(id, () => data, () => nodes, () => edges, updateNodeData)
    await onRun()

    // loadMedia will return null in the test env (no IndexedDB real store),
    // so .file is null and we fall back to mediaId.
    expect(updateNodeData).toHaveBeenCalledWith(id, { result: 'media-xyz' })
  })

  it('writes null to result when no upstream edge is connected (failure path)', async () => {
    const id = 'out-5'
    const nodes: Node[] = [{ id, position: { x: 0, y: 0 }, data: {} } as Node]
    const edges: Edge[] = []
    const data: SubnetOutputNodeData = { handle_id: 'h5', name: 'output', slot_type: 'image' }
    const updateNodeData = vi.fn()

    const onRun = buildOutputOnRun(id, () => data, () => nodes, () => edges, updateNodeData)
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(id, { result: null })
  })

  it('writes empty string to result when text slot_type has no connection (failure path)', async () => {
    const id = 'out-6'
    const nodes: Node[] = [{ id, position: { x: 0, y: 0 }, data: {} } as Node]
    const edges: Edge[] = []
    const data: SubnetOutputNodeData = { handle_id: 'h6', name: 'output', slot_type: 'text' }
    const updateNodeData = vi.fn()

    const onRun = buildOutputOnRun(id, () => data, () => nodes, () => edges, updateNodeData)
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(id, { result: '' })
  })
})
