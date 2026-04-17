import { useState } from 'react'

interface MediaMeta {
  model?: string
  cost?: number | string
  aspect_ratio?: string
  prompt?: string
}

interface Props {
  media: {
    filename: string
    directory?: string
    width?: number
    height?: number
    metadata?: string
  }
  on_close: () => void
}

function parse_meta(raw?: string): MediaMeta {
  if (!raw) return {}
  try { return JSON.parse(raw) as MediaMeta } catch { return {} }
}

export function LightboxInfoPanel({ media, on_close }: Props) {
  const meta = parse_meta(media.metadata)
  const [copied, setCopied] = useState(false)

  const copy_prompt = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rh-lb-info">
      <div className="rh-lb-info-header">
        <span>Details</span>
        <button className="rh-lb-info-close" onClick={on_close}>&times;</button>
      </div>
      <div className="rh-lb-info-body">
        <section className="rh-lb-info-section">
          <h4>File</h4>
          <dl className="rh-lb-info-dl">
            <dt>Name</dt><dd>{media.filename}</dd>
            {media.directory && <><dt>Project</dt><dd data-s>{media.directory}</dd></>}
            {media.width != null && media.height != null && (
              <><dt>Resolution</dt><dd>{media.width} x {media.height}</dd></>
            )}
          </dl>
        </section>

        <section className="rh-lb-info-section">
          <h4>AI Generation</h4>
          {meta.model || meta.cost != null || meta.aspect_ratio || meta.prompt ? (
            <dl className="rh-lb-info-dl">
              {meta.model && <><dt>Model</dt><dd>{meta.model}</dd></>}
              {meta.aspect_ratio && <><dt>Aspect</dt><dd>{meta.aspect_ratio}</dd></>}
              {meta.cost != null && (
                <><dt>Cost</dt><dd data-s>${Number(meta.cost).toFixed(4)}</dd></>
              )}
            </dl>
          ) : <p className="rh-lb-info-none">No metadata</p>}
          {meta.prompt && (
            <div className="rh-lb-info-prompt">
              <div className="rh-lb-info-prompt-label">
                <span>Prompt</span>
                <button
                  className="rh-lb-info-copy"
                  onClick={() => copy_prompt(meta.prompt!)}
                >{copied ? 'Copied!' : 'Copy'}</button>
              </div>
              <p className="rh-lb-info-prompt-text">{meta.prompt}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
