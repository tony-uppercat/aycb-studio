import { create } from 'zustand'

interface DrawingToolState {
  tool: 'pen' | 'eraser'
  color: string
  size: number
  opacity: number
  setTool: (t: 'pen' | 'eraser') => void
  setColor: (c: string) => void
  setSize: (s: number) => void
  setOpacity: (o: number) => void
}

export const useDrawingToolStore = create<DrawingToolState>((set) => ({
  tool: 'pen',
  color: '#ffffff',
  size: 4,
  opacity: 1,
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setSize: (size) => set({ size }),
  setOpacity: (opacity) => set({ opacity }),
}))
