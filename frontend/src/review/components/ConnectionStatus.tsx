interface Props { connected: boolean }

export function ConnectionStatus({ connected }: Props) {
  return (
    <span className={`rh-status-dot ${connected ? 'rh-connected' : 'rh-disconnected'}`}
      title={connected ? 'Connected' : 'Disconnected'} />
  )
}
