# Day/Night Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted day/night theme toggle to the AYCB studio — safe, additive, default dark.

**Architecture:** One `theme` state in `canvasStore` drives two consumers: React Flow's `colorMode` prop (canvas chrome) and a `[data-theme="light"]` attribute on `<html>` that re-declares the shared CSS tokens. A Sun/Moon button in the studio toolbar flips it; the value persists in `aycb_ui`.

**Tech Stack:** React 19 + TypeScript, Zustand 5 (persist), @xyflow/react 12 (`colorMode`), CSS custom properties, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-25-day-night-toggle-design.md`

**Commit policy (project rule — overrides per-task commits):** Do NOT commit per task. The working tree carries unrelated WIP — at the end, commit ONLY the day/night paths with an explicit `git add <paths>` (never `-A`/`.`), and only after the owner's go-ahead.

---

### Task 1: Theme state in canvasStore

**Files:**
- Modify: `frontend/src/stores/canvasStore.ts` (interface ~`:29-75`, initial state ~`:79-126`, partialize ~`:130-134`)
- Test: `frontend/src/stores/canvasStore.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/stores/canvasStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/stores/canvasStore.test.ts`
Expected: FAIL — `theme` is `undefined` / `toggleTheme is not a function`.

- [ ] **Step 3: Implement the minimal code**

In `frontend/src/stores/canvasStore.ts`:

Add to the `CanvasState` interface (near the other toggles, ~`:33`):

```ts
  theme: 'dark' | 'light';
  toggleTheme: () => void;
```

Add to the initial state object (near `minimapVisible`, ~`:83`):

```ts
      theme: 'dark' as const,
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
```

Add `theme` to `partialize` (~`:130`):

```ts
      partialize: (state) => ({
        consoleOpen: state.consoleOpen,
        minimapVisible: state.minimapVisible,
        costs: state.costs,
        theme: state.theme,
      }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/stores/canvasStore.test.ts`
Expected: PASS (3 tests).

---

### Task 2: ThemeToggle component

**Files:**
- Create: `frontend/src/components/ThemeToggle.tsx`
- Test: `frontend/src/components/ThemeToggle.test.tsx` (create)

Note: the button is style-agnostic — it takes a `className` prop so the toolbar can pass its existing `.iconBtn` class (no cross-module CSS import). It owns the `data-theme` sync because it is always mounted in the studio toolbar.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ThemeToggle.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { useCanvasStore } from '../stores/canvasStore'

describe('ThemeToggle', () => {
  beforeEach(() => {
    useCanvasStore.setState({ theme: 'dark' })
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders a labelled button', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /toggle day\/night/i })).toBeInTheDocument()
  })

  it('syncs data-theme to the current theme on mount', () => {
    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('click flips the store theme and data-theme', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /toggle day\/night/i }))
    expect(useCanvasStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies the passed className', () => {
    render(<ThemeToggle className="my-btn" />)
    expect(screen.getByRole('button', { name: /toggle day\/night/i })).toHaveClass('my-btn')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ThemeToggle.test.tsx`
Expected: FAIL — cannot find module `./ThemeToggle`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/ThemeToggle.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ThemeToggle.test.tsx`
Expected: PASS (4 tests).

---

### Task 3: Light token blocks (CSS)

**Files:**
- Modify: `frontend/src/styles/globals.css` (append at end)
- Modify: `frontend/src/styles/design-tokens.css` (append at end)

No unit test — CSS variable values are verified by build + manual flip (Task 5). Uses `:root[data-theme="light"]` (specificity 0,2,0) so it always beats the base `:root` regardless of import order.

- [ ] **Step 1: Append the light block to `globals.css`**

```css

/* Light theme — overrides the dark :root tokens when <html data-theme="light">.
   Additive: dark remains the default. */
:root[data-theme="light"] {
  --surface-0: #f4f4f5;
  --surface-1: #f7f7f8;
  --surface-2: #fafafa;
  --surface-3: #fcfcfd;
  --surface-4: #ffffff;
  --surface-hover: #ececee;
  --surface-active: #e4e4e7;
  --border: #e4e4e7;
  --border-bright: #d4d4d8;
  --text-primary: #18181b;
  --text-secondary: #52525b;
  --text-dim: #a1a1aa;
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.10);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.14);
}
```

- [ ] **Step 2: Append the light block to `design-tokens.css`**

```css

:root[data-theme="light"] {
  --color-bg-primary: #f4f4f5;
  --color-bg-secondary: #fafafa;
  --color-bg-tertiary: #ffffff;
  --color-bg-elevated: #ffffff;
  --color-border: #e4e4e7;
  --color-text-primary: #18181b;
  --color-text-secondary: #52525b;
  --color-text-tertiary: #a1a1aa;
}
```

- [ ] **Step 3: Verify build is clean**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (CSS doesn't affect tsc, but confirms nothing else broke).

---

### Task 4: Wire FlowCanvas to the theme

**Files:**
- Modify: `frontend/src/components/canvas/FlowCanvas.tsx` (import + toolbar ~`:618`, `colorMode` `:700`, `Background` `:719`, `MiniMap` `:722-738`)

- [ ] **Step 1: Import ThemeToggle**

Near the other component imports (e.g. after the `BackendStatusDot` import ~`:11`):

```tsx
import { ThemeToggle } from '../ThemeToggle'
```

- [ ] **Step 2: Read `theme` from the store**

Add alongside the other `useCanvasStore` selector reads inside `FlowCanvasInner`:

```tsx
  const theme = useCanvasStore((s) => s.theme)
```

- [ ] **Step 3: Render the toggle in the toolbar**

In the icon-button cluster, immediately before the Settings button (`:620`), add:

```tsx
          <ThemeToggle className={styles.iconBtn} />
```

- [ ] **Step 4: Make `colorMode` dynamic**

Replace `:700`:

```tsx
          colorMode={theme}
```

- [ ] **Step 5: Make Background + MiniMap theme-aware**

Replace `<Background ... />` (`:719`):

```tsx
          <Background color={theme === 'light' ? '#d4d4d8' : '#1a1a1a'} gap={20} />
```

Replace the `<MiniMap>` color props/style (`:722-738`) with:

```tsx
            <MiniMap
              nodeColor={theme === 'light' ? '#71717a' : '#aaa'}
              nodeStrokeColor={theme === 'light' ? '#52525b' : '#d4d4d8'}
              nodeStrokeWidth={2}
              maskColor={theme === 'light' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.7)'}
              maskStrokeColor="#f59e0b"
              maskStrokeWidth={2}
              pannable
              zoomable
              style={{
                backgroundColor: theme === 'light' ? '#f4f4f5' : '#18181b',
                border: '1px solid #f59e0b55',
                borderRadius: 8,
                width: 180,
                height: 120,
              }}
            />
```

- [ ] **Step 6: Verify types + full frontend suite**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (`theme: 'dark' | 'light'` is assignable to RF `ColorMode`).

Run: `cd frontend && npx vitest run`
Expected: PASS — all existing tests + the 7 new theme tests.

---

### Task 5: Verify end-to-end, then commit (on go-ahead)

**Files:** none (verification + commit)

- [ ] **Step 1: Manual flip in the running app**

Start the app (`AYCB Studio.bat`, or `npm run dev` + backend). Click the new Sun/Moon button in the toolbar. Confirm:
- Canvas pane / Controls / MiniMap flip (React Flow `colorMode`).
- Token-driven chrome (panels, toolbar, settings, console) flips to light.
- Reload → theme persists. Default on a fresh profile is dark.
- Hardcoded-hex areas staying dark is expected (intentional "dark cards" look).
- `/review` stays dark (separate page) — expected.

- [ ] **Step 2: Final type + test gate**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean tsc, all tests green.

- [ ] **Step 3: Commit ONLY the day/night paths (after owner confirms)**

```bash
git add frontend/src/stores/canvasStore.ts frontend/src/stores/canvasStore.test.ts \
        frontend/src/components/ThemeToggle.tsx frontend/src/components/ThemeToggle.test.tsx \
        frontend/src/styles/globals.css frontend/src/styles/design-tokens.css \
        frontend/src/components/canvas/FlowCanvas.tsx \
        docs/superpowers/specs/2026-05-25-day-night-toggle-design.md \
        docs/superpowers/plans/2026-05-25-day-night-toggle.md
git commit -m "$(cat <<'EOF'
[feat] Day/night theme toggle for studio

React Flow colorMode + [data-theme] token flip, one persisted canvasStore
state. Additive, default dark. Review Hub unaffected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Do not stage any other working-tree files (unrelated WIP).
