import { create } from 'zustand'
import { socket } from '../services/socket'

export interface Stroke {
  id: string
  tool: string
  color: string
  stroke_width: number
  opacity: number
  points: { x: number; y: number; pressure?: number }[]
  author?: string
}

interface DrawingState {
  is_drawing_mode: boolean
  current_tool: string
  color: string
  stroke_width: number
  opacity: number
  strokes: Stroke[]
  undo_stack: Stroke[]
  remote_strokes: Stroke[]
  remote_cursors: Record<string, { x: number; y: number }>
  drawing_visible: boolean
  toggleDrawingMode: () => void
  setTool: (tool: string) => void
  setColor: (color: string) => void
  setStrokeWidth: (w: number) => void
  setOpacity: (o: number) => void
  toggleVisibility: () => void
  addStroke: (stroke: Stroke) => void
  undo: () => void
  redo: () => void
  clearAll: () => void
  resetForMedia: () => void
  addRemoteStroke: (stroke: Stroke) => void
  updateRemoteCursor: (userId: string, pos: { x: number; y: number }) => void
  removeRemoteCursor: (userId: string) => void
}

const MAX_UNDO = 50

export const useDrawingStore = create<DrawingState>((set) => ({
  is_drawing_mode: false,
  current_tool: 'pen',
  color: '#ef4444',
  stroke_width: 3,
  opacity: 1,
  strokes: [],
  undo_stack: [],
  remote_strokes: [],
  remote_cursors: {},
  drawing_visible: true,

  toggleDrawingMode: () => set((s) => ({ is_drawing_mode: !s.is_drawing_mode })),
  setTool: (tool) => set({ current_tool: tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (w) => set({ stroke_width: w }),
  setOpacity: (o) => set({ opacity: o }),
  toggleVisibility: () => set((s) => ({ drawing_visible: !s.drawing_visible })),

  addStroke: (stroke) =>
    set((s) => ({ strokes: [...s.strokes, stroke], undo_stack: [] })),

  undo: () =>
    set((s) => {
      if (s.strokes.length === 0) return s
      const last = s.strokes[s.strokes.length - 1]
      return {
        strokes: s.strokes.slice(0, -1),
        undo_stack: [...s.undo_stack.slice(-(MAX_UNDO - 1)), last],
      }
    }),

  redo: () =>
    set((s) => {
      if (s.undo_stack.length === 0) return s
      const last = s.undo_stack[s.undo_stack.length - 1]
      return {
        undo_stack: s.undo_stack.slice(0, -1),
        strokes: [...s.strokes, last],
      }
    }),

  clearAll: () => set({ strokes: [], undo_stack: [] }),

  resetForMedia: () =>
    set({ strokes: [], undo_stack: [], remote_strokes: [], remote_cursors: {} }),

  addRemoteStroke: (stroke) =>
    set((s) => ({ remote_strokes: [...s.remote_strokes, stroke] })),

  updateRemoteCursor: (userId, pos) =>
    set((s) => ({ remote_cursors: { ...s.remote_cursors, [userId]: pos } })),

  removeRemoteCursor: (userId) =>
    set((s) => {
      const { [userId]: _, ...rest } = s.remote_cursors
      return { remote_cursors: rest }
    }),
}))

// Socket auto-subscribe
socket.on('drawing_stroke', (data: Stroke) => {
  useDrawingStore.getState().addRemoteStroke(data)
})
socket.on('drawing_clear', () => {
  useDrawingStore.setState({ remote_strokes: [] })
})
socket.on('drawing_undo', () => {
  useDrawingStore.setState((s) => ({
    remote_strokes: s.remote_strokes.slice(0, -1),
  }))
})
socket.on('cursor_move', (data: { user_id: string; x: number; y: number }) => {
  useDrawingStore.getState().updateRemoteCursor(data.user_id, { x: data.x, y: data.y })
})
