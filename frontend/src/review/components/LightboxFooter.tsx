interface LightboxFooterProps {
  media: { metadata?: string; filename: string }
  current_index: number
  total: number
}

interface MediaMeta {
  model?: string
  cost?: number | string
  aspect_ratio?: string
  prompt?: string
}

function parse_meta(raw?: string): MediaMeta {
  if (!raw) return {}
  try { return JSON.parse(raw) as MediaMeta }
  catch { return {} }
}

export function LightboxFooter({ media, current_index, total }: LightboxFooterProps) {
  const meta = parse_meta(media.metadata)

  return (
    <div className="rh-lb-footer">
      <div className="rh-lb-footer-left">
        <div className="rh-lb-chips">
          {meta.model && <span className="rh-lb-chip">{meta.model}</span>}
          {meta.cost != null && (
            <span className="rh-lb-chip">${Number(meta.cost).toFixed(4)}</span>
          )}
          {meta.aspect_ratio && (
            <span className="rh-lb-chip">{meta.aspect_ratio}</span>
          )}
        </div>
        {meta.prompt && (
          <p className="rh-lb-prompt">{meta.prompt}</p>
        )}
      </div>
      <span className="rh-lb-counter">
        {current_index + 1} / {total}
      </span>
    </div>
  )
}
