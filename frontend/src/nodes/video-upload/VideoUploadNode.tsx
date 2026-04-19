import type { NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import styles from '../_shared/Node.module.css'
import { useVideoUpload, formatTime, formatFrame } from './useVideoUpload'

// ── Component ─────────────────────────────────────────────────────────────────

export function VideoUploadNode({ id, data, selected }: NodeProps) {
  const {
    videoUrl, currentTime, duration, playing, videoRef,
    frames, statusMsg, showFrames, setShowFrames,
    fileDrop,
    togglePlay, handleTimeUpdate, handleLoadedMetadata,
    handleVideoClick, handleCaptureFrame,
    handleClearFrames, handleImportFrames,
    openPreview,
    seekTo, stepFrame, setPlaying,
  } = useVideoUpload(id, data, selected)

  const { dragging, inputRef, dragHandlers, onInputChange, openPicker } = fileDrop

  return (
    <NodeShell
      name="Video Upload"
      selected={selected}
      outputSlots={[
        { id: 'video-out', label: 'Video', type: 'video' },
        { id: 'image-out', label: 'Frames', type: 'image' },
      ]}
    >
      <div className={styles.nodeContent}>
        {videoUrl ? (
          <>
            <div className={styles.videoWrap}>
              <video
                ref={videoRef}
                src={videoUrl}
                className={styles.videoEl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setPlaying(false)}
                onClick={handleVideoClick}
                muted
              />
              {/* Timeline scrubber */}
              <div className={`${styles.videoTimeline} nodrag nowheel`}
                onMouseDown={(e) => {
                  const bar = e.currentTarget
                  const seek = (ev: { clientX: number }) => {
                    const rect = bar.getBoundingClientRect()
                    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                    seekTo(pct)
                  }
                  seek(e)
                  const handleMove = (ev: MouseEvent) => seek(ev)
                  const handleUp = () => {
                    window.removeEventListener('mousemove', handleMove)
                    window.removeEventListener('mouseup', handleUp)
                  }
                  window.addEventListener('mousemove', handleMove)
                  window.addEventListener('mouseup', handleUp)
                }}
                onWheel={(e) => {
                  e.stopPropagation()
                  stepFrame(e.deltaY > 0 ? 1 : -1, e.shiftKey)
                }}
              >
                <div className={styles.videoProgress} style={{
                  width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                }} />
                <div className={styles.videoPlayhead} style={{
                  left: `${duration ? (currentTime / duration) * 100 : 0}%`,
                }} />
              </div>
              <div className={`${styles.videoControls} nodrag`}>
                <button className={styles.videoPlayBtn} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                  {playing
                    ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18"/><rect x="14" y="3" width="5" height="18"/></svg>
                    : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3l15 9-15 9V3z"/></svg>
                  }
                </button>
                <span className={styles.videoCurrentTime}>
                  {showFrames ? formatFrame(currentTime) : formatTime(currentTime)}
                  {' / '}
                  {showFrames ? formatFrame(duration) : formatTime(duration)}
                </span>
                <button className={styles.videoModeBtn} onClick={() => setShowFrames(v => !v)} title="Switch time/frame">
                  {showFrames ? 'F' : 'T'}
                </button>
                <button className={styles.videoActionBtn} onClick={handleCaptureFrame} title="Capture current frame">
                  Capture
                </button>
                {frames.length > 0 && (
                  <>
                    <button className={styles.videoActionBtn} onClick={handleImportFrames} title="Import frames as image nodes">
                      Import
                    </button>
                    <button className={styles.videoActionBtn} onClick={handleClearFrames} title="Clear frames">
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            {frames.length > 0 && (
              <div className={`${styles.videoFrameThumbs} nodrag`}>
                {frames.map((url, i) => (
                  <img key={i} src={url} className={styles.videoFrameThumb} alt={`frame ${i + 1}`}
                    onClick={() => openPreview(url, 'image')} />
                ))}
              </div>
            )}
            {statusMsg && <div className={styles.videoStatus}>{statusMsg}</div>}
          </>
        ) : (
          <div
            className={styles.previewArea}
            onClick={openPicker}
            {...dragHandlers}
            style={dragging ? { borderColor: '#22c55e' } : undefined}
          >
            <span className={styles.dropHint}>Click or drag a video</span>
          </div>
        )}
        <input ref={inputRef} type="file" accept="video/*" className={styles.hidden}
          onChange={onInputChange} />
      </div>
    </NodeShell>
  )
}

export default VideoUploadNode
