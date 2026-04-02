import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { api } from '../../api'
import styles from '../_shared/Node.module.css'

export function ConsoleNode({ selected }: NodeProps) {
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await api.getLogs()
        setLogs(r.logs)
      } catch {
        setLogs(prev => prev.length === 0 ? ['[!] Backend not reachable'] : prev)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <NodeShell name="Console" icon="📋" selected={selected}>
      <div className={styles.nodeContent}>
        <textarea
          className={styles.resultArea}
          readOnly
          value={logs.join('\n')}
          rows={8}
          style={{ fontFamily: 'monospace', fontSize: '10px' }}
        />
      </div>
    </NodeShell>
  )
}

export default ConsoleNode
