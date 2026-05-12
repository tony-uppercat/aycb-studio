import { useCallback, useRef, useState } from 'react'
import { addEdge, type Connection, type Node, type Edge } from '@xyflow/react'
import { useCanvasStore } from '../stores/canvasStore'
import { getNextNodeId } from './useCanvasDragDrop'
import { getHandleType } from './useDataPropagation'
import { NODE_CATALOG, type NodeManifest, type SlotType, areSlotsCompatible, findHandleForSlot } from '../nodes/index'
import { commitPendingPin } from '../nodes/subnet/subnetPins'
import { edgeStyle } from '../utils/edgeStyles'

type PendingConnection = {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
  slotType: string
  position: { x: number; y: number }
} | null

interface UseConnectionHandlersParams {
  getNodes: () => Node[]
  getEdges: () => Edge[]
  setNodes: (updater: Node[] | ((nodes: Node[]) => Node[])) => void
  setEdges: (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void
  snapshot: (nodes: Node[], edges: Edge[]) => void
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }
}

// Node types that allow multiple incoming edges on the same input handle
export const MULTI_INPUT_NODE_TYPES = new Set(['switch', 'batch'])

/**
 * Resolve the slot type of a handle taking subnet boundary into account.
 *
 * Subnet pins use handle ids of the form `in-{rand}` / `out-{rand}` where the
 * prefix encodes direction, NOT slot type. `getHandleType` would split on '-'
 * and return 'in'/'out' which doesn't match any real slot type, breaking
 * `isValidConnection` (drag rejected) and `onConnectStart` (pendingConnection
 * carries a useless slotType so AddNodeMenu can't filter compatible nodes).
 *
 * For subnet pins, look up the actual slot_type from the subnet's
 * `external_inputs` / `external_outputs` array. For everything else, fall
 * back to the prefix-based `getHandleType` heuristic.
 */
export function getEffectiveSlotType(
  nodeId: string | null | undefined,
  handleId: string | null | undefined,
  handleType: 'source' | 'target',
  nodes: Node[],
): string {
  if (!handleId) return ''
  const prefix = getHandleType(handleId)
  if ((prefix === 'in' || prefix === 'out') && nodeId) {
    const node = nodes.find(n => n.id === nodeId)
    if (node?.type === 'subnet') {
      const data = node.data as Record<string, unknown>
      const pins = (handleType === 'source'
        ? data.external_outputs
        : data.external_inputs) as Array<{ handle_id: string; slot_type: string }> | undefined
      const pin = pins?.find(p => p.handle_id === handleId)
      if (pin) return pin.slot_type
    }
  }
  return prefix
}

/**
 * Remove existing edges on a target handle if the node doesn't allow multi-input.
 * Returns the filtered edge array.
 */
export function enforceOneEdgePerInput(
  edges: Edge[],
  targetNodeId: string | null,
  targetHandle: string | null | undefined,
  nodes: Node[],
): Edge[] {
  if (!targetNodeId) return edges
  const targetNode = nodes.find(n => n.id === targetNodeId)
  if (targetNode && MULTI_INPUT_NODE_TYPES.has(targetNode.type ?? '')) return edges
  return edges.filter(e =>
    !(e.target === targetNodeId && e.targetHandle === targetHandle)
  )
}

export function useConnectionHandlers(params: UseConnectionHandlersParams) {
  const { getNodes, getEdges, setNodes, setEdges, snapshot, screenToFlowPosition } = params

  const [pendingConnection, setPendingConnection] = useState<PendingConnection>(null)
  const pendingRef = useRef<PendingConnection>(null)
  const connectionMadeRef = useRef(false)

  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
    if (params.nodeId && params.handleId && params.handleType) {
      const slotType = getEffectiveSlotType(params.nodeId, params.handleId, params.handleType, getNodes())
      const pending: NonNullable<PendingConnection> = {
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
        slotType,
        position: { x: 0, y: 0 },
      }
      pendingRef.current = pending
      setPendingConnection(pending)
    }
  }, [getNodes])

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const pending = pendingRef.current
    if (!pending) return

    // Connection was successfully made — don't open drag-to-create menu
    if (connectionMadeRef.current) {
      connectionMadeRef.current = false
      pendingRef.current = null
      setPendingConnection(null)
      return
    }

    const target = event.target as HTMLElement
    if (target.closest('.react-flow__handle')) {
      pendingRef.current = null
      setPendingConnection(null)
      return
    }

    const clientX = 'changedTouches' in event ? event.changedTouches[0].clientX : event.clientX
    const clientY = 'changedTouches' in event ? event.changedTouches[0].clientY : event.clientY

    // Ctrl+drag from a text output with 2+ selected text nodes → auto-create TextCombine
    const isCtrl = event instanceof MouseEvent ? event.ctrlKey || event.metaKey : false
    if (isCtrl && pending.handleType === 'source' && (pending.slotType === 'text' || pending.slotType === 'prompt')) {
      const allNodes = getNodes()
      const selectedTextNodes = allNodes
        .filter(n => n.selected && n.type !== 'group')
        .filter(n => {
          // Check node has a text/prompt output
          const nodeType = n.type ?? ''
          const hasTextOut = ['textInput', 'llm', 'llmGemini', 'jsonParser', 'jsonParserBlend',
            'textCombine', 'videoAnalysis', 'imageMerge'].includes(nodeType)
          return hasTextOut
        })
        .sort((a, b) => a.position.y - b.position.y) // top-to-bottom order

      if (selectedTextNodes.length >= 2) {
        const flowPos = screenToFlowPosition({ x: clientX, y: clientY })
        const combineId = getNextNodeId('textCombine')
        const combineNode = {
          id: combineId,
          type: 'textCombine' as const,
          position: { x: flowPos.x - 100, y: flowPos.y - 50 },
          data: { separator: '\n' },
        }

        const newEdges = selectedTextNodes.map((n, i) => {
          // Find the text output handle for this node type
          const sourceHandle = n.type === 'jsonParser' || n.type === 'jsonParserBlend' || n.type === 'textCombine'
            ? 'text-out'
            : n.type === 'textInput' ? 'text-out'
            : n.type === 'videoAnalysis' ? 'text-out'
            : 'text-out' // default
          return {
            id: `e-${n.id}-${combineId}-${i}`,
            source: n.id,
            sourceHandle,
            target: combineId,
            targetHandle: `text-${i}`,
            style: edgeStyle(sourceHandle),
          }
        })

        const postNodes = [...allNodes, combineNode]
        const postEdges = [...getEdges(), ...newEdges]
        snapshot(postNodes, postEdges)
        setNodes(postNodes)
        setEdges(postEdges)

        pendingRef.current = null
        setPendingConnection(null)
        return
      }
    }

    const updated = { ...pending, position: { x: clientX, y: clientY } }
    pendingRef.current = updated
    setPendingConnection(updated)
    useCanvasStore.setState({ addMenuOpen: true })
  }, [getNodes, getEdges, setNodes, setEdges, snapshot, screenToFlowPosition])

  const handleAddNodeFromDrag = useCallback((entry: NodeManifest) => {
    if (!pendingConnection) return

    const id = getNextNodeId(entry.type)
    const flowPos = screenToFlowPosition(pendingConnection.position)

    const newNode: Node = {
      id,
      type: entry.type,
      position: { x: flowPos.x - 100, y: flowPos.y - 50 },
      data: { ...entry.defaultData },
    }

    let connection: Connection
    if (pendingConnection.handleType === 'source') {
      const compatibleInput = findHandleForSlot(NODE_CATALOG, entry.type, pendingConnection.slotType as SlotType, 'in')
        ?? (pendingConnection.slotType + '-in')
      connection = {
        source: pendingConnection.nodeId,
        sourceHandle: pendingConnection.handleId,
        target: id,
        targetHandle: compatibleInput,
      }
    } else {
      const compatibleOutput = findHandleForSlot(NODE_CATALOG, entry.type, pendingConnection.slotType as SlotType, 'out')
        ?? (pendingConnection.slotType + '-out')
      connection = {
        source: id,
        sourceHandle: compatibleOutput,
        target: pendingConnection.nodeId,
        targetHandle: pendingConnection.handleId,
      }
    }

    // Compute post-mutation state for snapshot (redo support)
    const postNodes = [...getNodes(), newNode]
    const currentNodes = getNodes()
    const edges = enforceOneEdgePerInput(getEdges(), connection.target, connection.targetHandle, currentNodes)
    const postEdges = addEdge({ ...connection, style: edgeStyle(connection.sourceHandle) }, edges)
    snapshot(postNodes, postEdges)
    setNodes(postNodes)
    setEdges(postEdges)
    pendingRef.current = null
    setPendingConnection(null)
  }, [pendingConnection, setNodes, setEdges, screenToFlowPosition, getNodes, getEdges, snapshot])

  const handleAddNode = useCallback((entry: NodeManifest) => {
    const id = getNextNodeId(entry.type)
    // Use the React Flow container bounds (not window center) so node lands at the visible canvas center
    const rfContainer = document.querySelector('.react-flow')
    const rect = rfContainer?.getBoundingClientRect()
    const screenCenterX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const screenCenterY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    const pos = screenToFlowPosition({ x: screenCenterX, y: screenCenterY })
    const newNode: Node = {
      id,
      type: entry.type,
      position: { x: pos.x - 150, y: pos.y - 100 },
      data: { ...entry.defaultData },
    }
    setNodes(ns => [...ns, newNode])
  }, [setNodes, screenToFlowPosition])

  const onConnect = useCallback(
    (connection: Connection) => {
      connectionMadeRef.current = true
      let currentNodes = getNodes()
      const currentEdges = getEdges()

      // ── Pending subnet pin auto-commit ──────────────────────────────────
      // If the user dropped an edge onto a subnet's "__pending_in__" or
      // "__pending_out__" sentinel handle, materialize a real proxy inside
      // the subnet's sub_graph and rewrite the connection to use the new
      // real handle_id. The pending pin then re-spawns one row below on
      // the next render.
      const PENDING_IN = '__pending_in__'
      const PENDING_OUT = '__pending_out__'
      if (connection.targetHandle === PENDING_IN && connection.target) {
        const subnet = currentNodes.find(n => n.id === connection.target)
        if (subnet?.type === 'subnet') {
          const slot_type = (getEffectiveSlotType(connection.source, connection.sourceHandle, 'source', currentNodes) || 'text') as SlotType
          const { updatedSubGraph, newHandleId } = commitPendingPin(subnet, 'in', slot_type)
          setNodes(ns => ns.map(n => n.id === subnet.id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), sub_graph: updatedSubGraph } }
            : n))
          currentNodes = currentNodes.map(n => n.id === subnet.id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), sub_graph: updatedSubGraph } }
            : n)
          connection = { ...connection, targetHandle: newHandleId }
        }
      } else if (connection.sourceHandle === PENDING_OUT && connection.source) {
        const subnet = currentNodes.find(n => n.id === connection.source)
        if (subnet?.type === 'subnet') {
          const slot_type = (getEffectiveSlotType(connection.target, connection.targetHandle, 'target', currentNodes) || 'text') as SlotType
          const { updatedSubGraph, newHandleId } = commitPendingPin(subnet, 'out', slot_type)
          setNodes(ns => ns.map(n => n.id === subnet.id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), sub_graph: updatedSubGraph } }
            : n))
          currentNodes = currentNodes.map(n => n.id === subnet.id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), sub_graph: updatedSubGraph } }
            : n)
          connection = { ...connection, sourceHandle: newHandleId }
        }
      }

      const targetNode = currentNodes.find(n => n.id === connection.target)
      const targetHandle = connection.targetHandle ?? ''
      const isMediaPin = targetHandle.startsWith('media-')
      const isLLMTarget = targetNode?.type === 'llm' || targetNode?.type === 'llmGemini'

      // Multi-select media connection
      if (isLLMTarget && isMediaPin) {
        const selectedSources = currentNodes.filter(n =>
          n.selected && n.id !== connection.target &&
          (n.type === 'imageUpload' || n.type === 'videoUpload')
        )

        if (selectedSources.length > 1) {
          const newConns: Connection[] = []
          let pinIndex = 0

          selectedSources.slice(0, 8).forEach(srcNode => {
            while (pinIndex < 8 && currentEdges.some((ed: Edge) =>
              ed.target === connection.target && ed.targetHandle === `media-${pinIndex}`
            )) { pinIndex++ }
            if (pinIndex >= 8) return

            newConns.push({
              source: srcNode.id,
              sourceHandle: srcNode.type === 'imageUpload' ? 'image-out' : 'video-out',
              target: connection.target!,
              targetHandle: `media-${pinIndex}`,
            })
            pinIndex++
          })

          // Compute post-mutation edges and snapshot them
          let postEdges = currentEdges
          newConns.forEach(c => { postEdges = addEdge({ ...c, style: edgeStyle(c.sourceHandle) }, postEdges) })
          snapshot(currentNodes, postEdges)
          setEdges(postEdges)
          return
        }
      }

      // Regular single connection — enforce 1 edge per input pin (except switch/batch)
      let postEdges = enforceOneEdgePerInput(currentEdges, connection.target, connection.targetHandle, currentNodes)
      // Output pins can have unlimited outgoing edges — no filtering on source handle
      postEdges = addEdge({ ...connection, style: edgeStyle(connection.sourceHandle) }, postEdges)
      snapshot(currentNodes, postEdges)
      setEdges(postEdges)
    },
    [setEdges, getNodes, getEdges, snapshot]
  )

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (connection.source === connection.target) return false

      const targetNode = getNodes().find(n => n.id === connection.target)
      const targetType = targetNode?.type

      // Batch node accepts any input type and multiple edges
      if (targetType === 'batch') return true

      // Subnet "pending" pins accept any type — slot_type is inferred
      // from the other end of the connection at auto-commit time in
      // onConnect above.
      if (connection.targetHandle === '__pending_in__' ||
          connection.sourceHandle === '__pending_out__') {
        return true
      }

      // We allow connections to occupied input pins so onConnect can replace the old edge.
      // Blocking here would prevent replacement (isValidConnection=false → onConnect never fires).

      const nodes = getNodes()
      return areSlotsCompatible(
        getEffectiveSlotType(connection.source, connection.sourceHandle, 'source', nodes),
        getEffectiveSlotType(connection.target, connection.targetHandle, 'target', nodes),
      )
    },
    [getNodes]
  )

  return {
    pendingConnection,
    setPendingConnection,
    pendingRef,
    onConnectStart,
    onConnectEnd,
    handleAddNodeFromDrag,
    handleAddNode,
    onConnect,
    isValidConnection,
  }
}
