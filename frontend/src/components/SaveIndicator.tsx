import { useCanvasStore } from '../stores/canvasStore'
import { CANVAS_EVENTS } from '../events/canvasEvents'
import styles from './SaveIndicator.module.css'

export function SaveIndicator() {
  const saveStatus = useCanvasStore(s => s.saveStatus)

  const label =
    saveStatus === 'saving' ? 'Saving...' :
    saveStatus === 'unsaved' ? 'Unsaved' :
    'Saved'

  const statusClass =
    saveStatus === 'saving' ? styles.saving :
    saveStatus === 'unsaved' ? styles.unsaved :
    styles.saved

  return (
    <div
      className={`${styles.indicator} ${statusClass}`}
      onClick={() => {
        // Trigger manual save by dispatching a custom event
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.AYCB_MANUAL_SAVE))
      }}
      title={saveStatus === 'saved' ? 'All changes saved' : 'Click to save now'}
    >
      <span className={styles.dot} />
      <span className={styles.label}>{label}</span>
    </div>
  )
}
