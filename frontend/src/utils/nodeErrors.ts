import { useCanvasStore } from '../stores/canvasStore'

/** Report a node error to the console Errors tab. */
export function reportNodeError(nodeId: string, message: string): void {
  useCanvasStore.getState().addError({
    timestamp: new Date().toISOString(),
    nodeId,
    message,
  })
}
