import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Handle, Position, NodeResizer, useNodeId, useReactFlow, useStore } from '@xyflow/react'
import { registerNodeRun, unregisterNodeRun, getRunnableUpstream, executeCascade, getCascadeActiveNodes, getCascadeProgress, subscribeCascade } from '../../utils/cascadeRun'
import { useCanvasStore } from '../../stores/canvasStore'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import styles from './NodeShell.module.css'

export type SlotDataType = 'text' | 'image' | 'audio' | 'video' | 'prompt' | 'media'

export interface SlotDef {
  id: string
  label: string
  type: SlotDataType
  required?: boolean
  position?: Position
  wide?: boolean  // render as tall rectangular handle (for batch/multi-input)
  hidden?: boolean // keep handle in DOM for edge preservation but visually hide it
}

interface Props {
  name: string
  icon?: string
  children: React.ReactNode
  selected?: boolean
  inputSlots?: SlotDef[]
  outputSlots?: SlotDef[]
  onRun?: () => void | Promise<void>
  running?: boolean
  autoUpdate?: boolean
  onAutoUpdateToggle?: () => void
  onSettings?: () => void
  onMenu?: () => void
  lastCost?: number
  estimatedCost?: string  // e.g. "~$0.0012"
  footerExtra?: React.ReactNode
}

const TYPE_CSS: Record<SlotDataType, string> = {
  text: styles.typeText,
  image: styles.typeImage,
  audio: styles.typeAudio,
  video: styles.typeVideo,
  prompt: styles.typePrompt,
  media: styles.typeImage,  // media slots use same color as image
}

function SlotHandle({ slot, side }: { slot: SlotDef; side: 'input' | 'output' }): React.ReactElement {
  const [hover, setHover] = useState(false)
  const isInput = side === 'input'
  const nodeId = useNodeId()

  const isConnected = useStore(state =>
    state.edges.some(e =>
      isInput
        ? e.target === nodeId && e.targetHandle === slot.id
        : e.source === nodeId && e.sourceHandle === slot.id
    )
  )

  // Hidden slots: keep Handle in DOM (preserves edges) but collapse visually
  if (slot.hidden) {
    return (
      <div className={`${styles.slotWrap} ${isInput ? styles.slotLeft : styles.slotRight}`}
        style={{ height: 0, overflow: 'hidden', margin: 0, padding: 0 }}>
        <Handle
          type={isInput ? 'target' : 'source'}
          position={slot.position ?? (isInput ? Position.Left : Position.Right)}
          id={slot.id}
          className={`${slot.wide ? styles.wideHandle : styles.dot} ${TYPE_CSS[slot.type]} ${isConnected ? styles.dotConnected : ''}`}
          style={{ opacity: 0, pointerEvents: 'none' }}
        />
      </div>
    )
  }

  return (
    <div
      className={`${styles.slotWrap} ${isInput ? styles.slotLeft : styles.slotRight}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && (
        <span className={`${styles.tooltip} ${isInput ? styles.tooltipRight : styles.tooltipLeft}`}>
          {slot.label}{slot.required ? ' *' : ''}
        </span>
      )}
      <Handle
        type={isInput ? 'target' : 'source'}
        position={slot.position ?? (isInput ? Position.Left : Position.Right)}
        id={slot.id}
        className={`${slot.wide ? styles.wideHandle : styles.dot} ${TYPE_CSS[slot.type]} ${isConnected ? styles.dotConnected : ''}`}
      />
    </div>
  )
}

export function NodeShell({
  name,
  icon,
  children,
  selected = false,
  inputSlots = [],
  outputSlots = [],
  onRun,
  running = false,
  autoUpdate,
  onAutoUpdateToggle,
  onSettings,
  onMenu,
  lastCost,
  estimatedCost,
  footerExtra,
}: Props): React.ReactElement {
  const nodeId = useNodeId()

  // Check if this node is bypassed
  const isBypassed = useStore(state => {
    const node = state.nodes.find(n => n.id === nodeId)
    return !!(node?.data as Record<string, unknown>)?._bypassed
  })

  const { updateNodeData } = useReactFlow()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const customName = useStore(state => {
    const node = state.nodes.find(n => n.id === nodeId)
    return (node?.data as Record<string, unknown>)?._customName as string | undefined
  })

  const [cascadeRunning, setCascadeRunning] = useState(false)

  // Subscribe to cascade progress for visual feedback
  const cascadeActiveNodes = useSyncExternalStore(subscribeCascade, getCascadeActiveNodes)
  const cascadeProgress = useSyncExternalStore(subscribeCascade, getCascadeProgress)
  const isCascadeActive = nodeId ? cascadeActiveNodes.has(nodeId) : false

  const edges = useStore(state => state.edges)

  // Register this node's onRun in the cascade registry
  useEffect(() => {
    if (nodeId && onRun) {
      registerNodeRun(nodeId, onRun)
      return () => unregisterNodeRun(nodeId)
    }
  }, [nodeId, onRun])

  const upstreamCount = nodeId ? getRunnableUpstream(nodeId, edges).length : 0

  const handleRunClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const wantsCascade = e.shiftKey || e.altKey || e.metaKey
    if (wantsCascade && nodeId && upstreamCount > 0) {
      // Shift/Alt/Cmd+Click: cascade — run all upstream nodes first, then this one
      console.log(`[Cascade] starting from ${nodeId}, ${upstreamCount} upstream nodes`)
      setCascadeRunning(true)
      executeCascade(nodeId, edges).finally(() => setCascadeRunning(false))
    } else {
      onRun?.()
    }
  }, [onRun, nodeId, upstreamCount, edges])


  const isRunning = running || cascadeRunning

  return (
    <div className={`${styles.shell} ${selected ? styles.selected : ''} ${isBypassed ? styles.bypassed : ''} ${isCascadeActive ? styles.cascadeActive : ''}`}>
      <NodeResizer
        minWidth={180}
        minHeight={80}
        isVisible={selected}
        color="rgba(245,158,11,0.5)"
        lineStyle={{ borderWidth: 1 }}
        handleStyle={{ width: 6, height: 6, borderRadius: 2 }}
      />

      <div className={styles.header}>
        {renaming ? (
          <input
            className={styles.renameInput}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={() => {
              const trimmed = renameValue.trim()
              if (nodeId) updateNodeData(nodeId, { _customName: trimmed || undefined })
              setRenaming(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setRenaming(false) }
            }}
            autoFocus
            spellCheck={false}
          />
        ) : (
          <span
            className={styles.nodeName}
            onDoubleClick={() => { setRenameValue(customName || name); setRenaming(true) }}
            title="Double-click to rename"
          >
            {icon && <span className={styles.nodeIcon}>{icon}</span>}{customName || name}
          </span>
        )}
        <div className={styles.headerActions}>
          {onSettings && (
            <button className={styles.headerBtn} onClick={onSettings} title="Settings">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
            </button>
          )}
          {onMenu && (
            <button className={styles.headerBtn} onClick={onMenu} title="Menu">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
          )}
        </div>
      </div>

      <div className={styles.slotRow}>
        <div className={styles.slotColumn}>
          {inputSlots.map(s => <SlotHandle key={s.id} slot={s} side="input" />)}
        </div>
        <div className={styles.slotColumn}>
          {outputSlots.map(s => <SlotHandle key={s.id} slot={s} side="output" />)}
        </div>
      </div>

      <div className={`${styles.body} nowheel nopan nodrag`}>
        <ErrorBoundary
          fallback={(error, reset) => (
            <div style={{
              padding: '10px 12px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 'var(--radius-md, 8px)',
              color: '#ef4444',
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                {error.message || 'Node error'}
              </span>
              <button
                onClick={reset}
                style={{
                  alignSelf: 'flex-start',
                  padding: '3px 10px',
                  fontSize: 11,
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.5)',
                  borderRadius: 'var(--radius-sm, 4px)',
                  color: '#ef4444',
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </div>
          )}
          onError={(error) => {
            useCanvasStore.getState().addError({
              timestamp: new Date().toISOString(),
              nodeId: 'node-shell',
              message: error.message,
            })
          }}
        >
          {children}
        </ErrorBoundary>
      </div>

      {onRun && (
        <div className={styles.footer}>
          {lastCost !== undefined && lastCost > 0 ? (
            <span className={styles.costBadge} title="Actual cost" data-s>
              ${lastCost < 0.01 ? lastCost.toFixed(4) : lastCost.toFixed(3)}
            </span>
          ) : estimatedCost ? (
            <span className={styles.costEstimate} title="Estimated cost" data-s>
              {estimatedCost}
            </span>
          ) : null}
          {footerExtra}
          {onAutoUpdateToggle && (
            <button
              className={styles.autoToggle}
              onClick={onAutoUpdateToggle}
              title={autoUpdate ? 'Auto update ON — click to disable' : 'Auto update OFF — click to enable'}
              style={{
                background: autoUpdate ? '#f59e0b' : '#2a2a2e',
                borderColor: autoUpdate ? '#f59e0b' : '#3a3a40',
              }}
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill={autoUpdate ? '#111' : '#666'}>
                <path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 0 1 7-7V3zm-1 18a9 9 0 0 0 9-9h3l-4-4-4 4h3a7 7 0 0 1-7 7v2z"/>
              </svg>
            </button>
          )}
          <button
            className={`${styles.runBtn} ${isRunning ? styles.runBtnRunning : ''}`}
            onClick={handleRunClick}
            disabled={isRunning}
            title={upstreamCount > 0 ? `Shift+Click to run all ${upstreamCount + 1} nodes` : undefined}
          >
            {cascadeRunning && cascadeProgress
              ? `${cascadeProgress.completed}/${cascadeProgress.total}`
              : isRunning ? 'Running...' : 'Run'}
          </button>
        </div>
      )}

    </div>
  )
}
