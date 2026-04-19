import type { Node } from '@xyflow/react'
import type { SlotType } from '../_shared/types'

/** Mirror of useCanvasDragDrop.getNextNodeId. Inlined so importing this
 *  module in a test does not pull in the mediaStore / IDB-heavy drag-drop
 *  module. */
function _newNodeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export interface SubnetPin {
  handle_id: string
  name: string
  slot_type: SlotType
}

interface ProxyData {
  handle_id: string
  name: string
  slot_type: SlotType
}

/**
 * Scan a sub_graph's nodes and extract the proxy definitions into pin lists.
 * Inputs come from subnet-input nodes, outputs from subnet-output nodes.
 * Each list is sorted by the y-position of the proxy on the canvas (top-down).
 */
export function buildSubnetPins(sub_nodes: Node[]): {
  external_inputs: SubnetPin[]
  external_outputs: SubnetPin[]
} {
  const inputs: Array<{ pin: SubnetPin; y: number }> = []
  const outputs: Array<{ pin: SubnetPin; y: number }> = []

  for (const node of sub_nodes) {
    const data = node.data as unknown as ProxyData
    const pin: SubnetPin = {
      handle_id: data.handle_id,
      name: data.name,
      slot_type: data.slot_type,
    }
    const y = node.position.y
    if (node.type === 'subnet-input') inputs.push({ pin, y })
    else if (node.type === 'subnet-output') outputs.push({ pin, y })
  }

  inputs.sort((a, b) => a.y - b.y)
  outputs.sort((a, b) => a.y - b.y)

  return {
    external_inputs: inputs.map((x) => x.pin),
    external_outputs: outputs.map((x) => x.pin),
  }
}


export interface SubGraph {
  nodes: Node[]
  edges: unknown[]
  viewport: unknown
}

/**
 * Commit a pending pin on a subnet: spawn a subnet-input or subnet-output
 * proxy inside the subnet's sub_graph with an inferred slot_type. The
 * caller writes `updatedSubGraph` back via updateNodeData and uses
 * `newHandleId` as the final targetHandle/sourceHandle of the edge
 * React Flow is about to accept.
 *
 * Naming: `{slot_type}_{in|out}_{N}` where N is the next index across
 * proxies of that direction — users see stable, type-hinting names.
 */
export function commitPendingPin(
  subnet: Node,
  direction: 'in' | 'out',
  slot_type: SlotType,
): { updatedSubGraph: SubGraph; newHandleId: string } {
  const proxyType = direction === 'in' ? 'subnet-input' : 'subnet-output'
  const prefix = direction === 'in' ? 'in' : 'out'
  const handle_id = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const proxyId = _newNodeId(proxyType)

  const d = subnet.data as { sub_graph?: SubGraph } | undefined
  const current_sg: SubGraph = d?.sub_graph ?? {
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  }
  const existing_of_kind = current_sg.nodes.filter((n) => n.type === proxyType).length
  const name = `${slot_type}_${prefix}_${existing_of_kind + 1}`

  // Stack proxies vertically based on how many exist for this direction
  // so the user sees them reflecting the pin order on the boundary.
  const x = direction === 'in' ? -200 : 200
  const y = existing_of_kind * 120

  const proxy: Node = {
    id: proxyId,
    type: proxyType,
    position: { x, y },
    data: { handle_id, name, slot_type },
  }

  return {
    updatedSubGraph: { ...current_sg, nodes: [...current_sg.nodes, proxy] },
    newHandleId: handle_id,
  }
}
