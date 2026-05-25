import { useLayoutEffect } from 'react'
import { useCanvasStore } from '../stores/canvasStore'

/**
 * Day/night toggle. Drives the global `[data-theme]` attribute (token flip)
 * and is read by FlowCanvas for React Flow's `colorMode`. Style-agnostic:
 * pass `className` (the toolbar passes its `.iconBtn` class).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useCanvasStore((s) => s.theme)
  const toggleTheme = useCanvasStore((s) => s.toggleTheme)

  // useLayoutEffect → attribute set before first paint (no flash).
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const isDark = theme === 'dark'
  return (
    <button
      className={className}
      onClick={toggleTheme}
      title="Toggle day/night"
      aria-label="Toggle day/night"
    >
      {isDark ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
    </button>
  )
}
