import { describe, it, expect } from 'vitest'
import { useCanvasStore } from './canvasStore'

describe('canvasStore theme', () => {
  it('defaults to dark', () => {
    expect(useCanvasStore.getState().theme).toBe('dark')
  })

  it('toggleTheme flips dark -> light -> dark', () => {
    useCanvasStore.setState({ theme: 'dark' })
    useCanvasStore.getState().toggleTheme()
    expect(useCanvasStore.getState().theme).toBe('light')
    useCanvasStore.getState().toggleTheme()
    expect(useCanvasStore.getState().theme).toBe('dark')
  })

  it('persists theme to the aycb_ui store', () => {
    useCanvasStore.setState({ theme: 'dark' })
    useCanvasStore.getState().toggleTheme() // -> light
    expect(localStorage.getItem('aycb_ui') ?? '').toContain('"theme":"light"')
  })
})
