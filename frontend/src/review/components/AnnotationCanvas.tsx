import { useState, useEffect } from 'react'
import { rhApi } from '../services/api'

interface Props { mediaId: number; imageWidth: number; imageHeight: number }

export function AnnotationCanvas({ mediaId, imageWidth, imageHeight }: Props) {
  const [annotations, setAnnotations] = useState<any[]>([])

  useEffect(() => {
    rhApi.listComments(mediaId).then(d => {
      setAnnotations((d.comments || []).filter((c: any) => c.x_position != null))
    })
  }, [mediaId])

  return (
    <div className="rh-annotation-layer">
      {annotations.map(a => (
        <div key={a.id}
          className={`rh-annotation-marker ${a.annotation_type === 'box' ? 'rh-annotation-box' : 'rh-annotation-pin'}`}
          style={{
            left: `${(a.x_position || 0) * 100}%`,
            top: `${(a.y_position || 0) * 100}%`,
            ...(a.annotation_type === 'box' ? { width: `${(a.box_width || 0.1) * 100}%`, height: `${(a.box_height || 0.1) * 100}%` } : {}),
          }}
          title={a.content}
        >
          {a.annotation_type !== 'box' && <span className="rh-pin-dot" />}
        </div>
      ))}
    </div>
  )
}
