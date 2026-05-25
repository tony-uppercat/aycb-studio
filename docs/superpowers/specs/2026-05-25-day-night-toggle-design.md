# Day/Night Toggle — Design Spec (2026-05-25)

## Goal

Add a day/night (light/dark) theme toggle to the **AYCB studio**. Safe and
fast: additive only, default unchanged (dark), fully reversible.

## Scope

**In:** Studio canvas + chrome that already uses CSS tokens. One persisted
`theme` state drives React Flow's `colorMode` AND a `[data-theme]` attribute
that flips our shared design tokens.

**Out (v1):**
- Review Hub. `/review` is a separate full-page load (`App.tsx` branches on
  `window.location.pathname`) where the toggle never mounts, so it stays dark
  — zero risk to it, which matches "don't care about Review Hub."
- Tokenizing the ~1437 hardcoded hex across 38 CSS files. Those read as
  "dark cards on a light canvas" (intentional look) and get lightened
  incrementally later.
- `system` mode. Trivial later add — React Flow already supports it.

## Architecture — one state, two consumers

```
canvasStore.theme ('dark' | 'light', default 'dark', persisted)
   ├─ FlowCanvas:  <ReactFlow colorMode={theme}>   → RF themes pane / Controls
   │                                                  / MiniMap / edges / handles
   └─ ThemeToggle: useLayoutEffect → document.documentElement.dataset.theme
                                       → [data-theme="light"] re-declares tokens
```

- **State** lives in `canvasStore` (added to existing `partialize`, so it
  persists in `aycb_ui`). Zustand reads localStorage synchronously, so the
  value is correct on first render.
- **No flash:** `useLayoutEffect` sets `data-theme` before first paint.
- **React Flow** themes its own chrome via the `colorMode` prop (the app
  already passes `colorMode="dark"` — we just make it dynamic). RF only hands
  custom nodes a `.dark`/`.light` class; node *colors* remain our CSS, hence
  the token flip.

## Light palette (`[data-theme="light"]`)

Inverse of the existing zinc-ish dark palette → stays on-brand. Accent
`#F52776` and status/slot colors unchanged.

**`globals.css`:**

```
--surface-0:#f4f4f5; --surface-1:#f7f7f8; --surface-2:#fafafa;
--surface-3:#fcfcfd; --surface-4:#ffffff;
--surface-hover:#ececee; --surface-active:#e4e4e7;
--border:#e4e4e7; --border-bright:#d4d4d8;
--text-primary:#18181b; --text-secondary:#52525b; --text-dim:#a1a1aa;
--shadow-sm:0 1px 3px rgba(0,0,0,.08);
--shadow-md:0 4px 12px rgba(0,0,0,.10);
--shadow-lg:0 8px 24px rgba(0,0,0,.14);
```

**`design-tokens.css`:**

```
--color-bg-primary:#f4f4f5; --color-bg-secondary:#fafafa;
--color-bg-tertiary:#ffffff; --color-bg-elevated:#ffffff;
--color-border:#e4e4e7;
--color-text-primary:#18181b; --color-text-secondary:#52525b;
--color-text-tertiary:#a1a1aa;
```

Semantics preserved: index 0 = base/body bg, higher index = more elevated
(lighter → white cards), matching the dark scale's direction.

## Hardcoded canvas spots → theme-aware

- `<Background color>` (`FlowCanvas.tsx:719`): `theme==='light' ? '#d4d4d8' : '#1a1a1a'`.
- `<MiniMap>` (`:722-738`): light variants — `nodeColor #71717a`,
  `nodeStrokeColor #52525b`, `maskColor rgba(255,255,255,.6)`,
  `backgroundColor #f4f4f5`. `maskStrokeColor #f59e0b` / amber border kept
  (reads on both).

## Toggle UI

New `components/ThemeToggle.tsx`: a Sun/Moon `iconBtn` matching the existing
inline-SVG toolbar buttons (Privacy `:604`, Settings `:620` are the
precedent — Privacy already toggles a global class). Reads `theme` +
`toggleTheme` from the store, owns the `data-theme` sync `useLayoutEffect`,
renders Moon in dark / Sun in light. `title="Toggle day/night"`,
`aria-label`. Placed in the toolbar cluster next to Privacy/Settings (one
line in `FlowCanvas`) — keeps logic out of the already-787-line file.

## Safety

- Default `'dark'` → zero change for existing users; absent persisted key
  falls back to `'dark'`.
- All CSS additive; dark `:root` untouched → no risk to current appearance.
- `colorMode={theme}` defaults to dark → canvas identical when dark.
- Fully reversible: toggle to dark === today.

## Testing

- `canvasStore`: default is `'dark'`; `toggleTheme()` flips; persists to
  `aycb_ui`; rehydrate restores.
- `ThemeToggle.test.tsx`: renders; click toggles store; sets
  `document.documentElement.dataset.theme`; correct icon per mode.
- Manual: owner flips live, confirms canvas + token-driven chrome.

## Files

- M `frontend/src/stores/canvasStore.ts` — `theme` + `toggleTheme` + partialize
- M `frontend/src/styles/globals.css` — `[data-theme="light"]` block
- M `frontend/src/styles/design-tokens.css` — `[data-theme="light"]` block
- M `frontend/src/components/canvas/FlowCanvas.tsx` — dynamic `colorMode`,
  theme-aware Background/MiniMap, render `<ThemeToggle/>`
- N `frontend/src/components/ThemeToggle.tsx`
- N `frontend/src/components/ThemeToggle.test.tsx`
