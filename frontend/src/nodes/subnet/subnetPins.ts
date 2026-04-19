import type { Node } from '@xyflow/react'
import type { SlotType } from '../_shared/types'

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
