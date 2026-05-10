# Generate Image — Per-ID JSON Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON toggle to the Generate Image node that parses `prompt-in` as a JSON array of strings and produces one image per element on dynamic `image-N` output pins.

**Architecture:** Extract pure helpers (parsing, label formatting, batch execution loop) to a new `jsonMode.ts` module so they're independently testable. Wire the helpers into the existing `useGenerateImage` hook with minimal new code there. UI gains a single new toggle button; the existing `outputMediaIds` map already handles multi-output dispatch downstream.

**Tech Stack:** React 19, TypeScript 5.9, @xyflow/react 12, Vitest 4, Zustand 5.

**Spec:** [`docs/superpowers/specs/2026-05-10-genimage-per-id-design.md`](../specs/2026-05-10-genimage-per-id-design.md)

---

## File map

| Action | Path | Purpose |
|---|---|---|
| Create | `frontend/src/nodes/generate-image/jsonMode.ts` | Pure helpers: parseJsonPrompts, shortLabel, computeJsonOutputSlots, executeJsonMode |
| Create | `frontend/src/nodes/generate-image/jsonMode.test.ts` | Unit tests for the helpers |
| Modify | `frontend/src/nodes/generate-image/useGenerateImage.ts` | Add jsonMode state, jsonPrompts memo, runJsonMode wrapper, dispatch |
| Modify | `frontend/src/nodes/generate-image/GenerateImageNode.tsx` | JSON toggle button, status line, conditional ×N visibility |

The first file isolates business logic (no React imports) so it's testable without rendering. The hook stays focused on React state/effects; the component stays focused on JSX.

---

## Task 1: Pure helpers — parseJsonPrompts + shortLabel

**Files:**
- Create: `frontend/src/nodes/generate-image/jsonMode.ts`
- Create: `frontend/src/nodes/generate-image/jsonMode.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// frontend/src/nodes/generate-image/jsonMode.test.ts
import { describe, it, expect } from 'vitest'
import { parseJsonPrompts, shortLabel } from './jsonMode'

describe('parseJsonPrompts', () => {
  it('returns empty array for invalid JSON', () => {
    expect(parseJsonPrompts('not json')).toEqual([])
    expect(parseJsonPrompts('')).toEqual([])
    expect(parseJsonPrompts('{}')).toEqual([])
  })

  it('returns empty array when input is not an array', () => {
    expect(parseJsonPrompts('"single string"')).toEqual([])
    expect(parseJsonPrompts('123')).toEqual([])
    expect(parseJsonPrompts('null')).toEqual([])
  })

  it('returns empty array when array contains non-strings', () => {
    expect(parseJsonPrompts('["ok", 1, "ok2"]')).toEqual([])
    expect(parseJsonPrompts('["ok", null]')).toEqual([])
    expect(parseJsonPrompts('["ok", {"id":1}]')).toEqual([])
  })

  it('returns the array when input is a valid string array', () => {
    expect(parseJsonPrompts('["a", "b", "c"]')).toEqual(['a', 'b', 'c'])
  })

  it('truncates at 20 entries', () => {
    const big = Array.from({ length: 30 }, (_, i) => `p${i}`)
    expect(parseJsonPrompts(JSON.stringify(big))).toHaveLength(20)
    expect(parseJsonPrompts(JSON.stringify(big))[0]).toBe('p0')
    expect(parseJsonPrompts(JSON.stringify(big))[19]).toBe('p19')
  })

  it('preserves empty strings inside the array', () => {
    expect(parseJsonPrompts('["a", "", "b"]')).toEqual(['a', '', 'b'])
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseJsonPrompts('  ["a"]  \n')).toEqual(['a'])
  })
})

describe('shortLabel', () => {
  it('returns first two words', () => {
    expect(shortLabel('a quick brown fox', 0)).toBe('a quick')
    expect(shortLabel('hero shot', 0)).toBe('hero shot')
  })

  it('returns single word when prompt has one', () => {
    expect(shortLabel('hero', 0)).toBe('hero')
  })

  it('returns "(empty)" for empty/whitespace prompt', () => {
    expect(shortLabel('', 0)).toBe('(empty)')
    expect(shortLabel('   ', 1)).toBe('(empty)')
  })

  it('falls back to "#N" when split produces no words', () => {
    // Edge case where trim yields a non-empty but split gives no tokens.
    // Practically unreachable, but the fallback exists for safety.
    // We test the empty branch via a string that's spaces only — covered above.
    // For non-spaceable content the first-2-words branch always wins.
    expect(shortLabel('  ', 4)).toBe('(empty)')
  })

  it('handles tabs and newlines as separators', () => {
    expect(shortLabel('hello\tworld\nfoo', 0)).toBe('hello world')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/nodes/generate-image/jsonMode.test.ts
```

Expected: FAIL with `Failed to load .../jsonMode` (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/nodes/generate-image/jsonMode.ts
/**
 * Pure helpers for the Generate Image JSON mode. Kept free of React
 * imports so they can be unit-tested without rendering the node.
 */

export const MAX_JSON_PROMPTS = 20

/**
 * Parse the upstream/textarea string as a JSON array of prompt strings.
 * Returns an empty array if the input is not valid JSON, not an array,
 * or contains non-string entries. Truncates at MAX_JSON_PROMPTS.
 */
export function parseJsonPrompts(raw: string): string[] {
  if (!raw || !raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  if (!parsed.every(p => typeof p === 'string')) return []
  return (parsed as string[]).slice(0, MAX_JSON_PROMPTS)
}

/**
 * Format a per-prompt output pin label. Mirrors JSON Parser's convention
 * of showing the first two words of a string entry.
 */
export function shortLabel(prompt: string, i: number): string {
  const trimmed = prompt.trim()
  if (!trimmed) return '(empty)'
  const words = trimmed.split(/\s+/).slice(0, 2).join(' ')
  return words || `#${i + 1}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/nodes/generate-image/jsonMode.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/generate-image/jsonMode.ts frontend/src/nodes/generate-image/jsonMode.test.ts
git commit -m "[feat] generate-image — jsonMode pure helpers (parseJsonPrompts, shortLabel)"
```

---

## Task 2: Pure helpers — computeJsonOutputSlots

**Files:**
- Modify: `frontend/src/nodes/generate-image/jsonMode.ts`
- Modify: `frontend/src/nodes/generate-image/jsonMode.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `jsonMode.test.ts`:

```ts
import { computeJsonOutputSlots } from './jsonMode'
import type { SlotDef } from '../_shared/NodeShell'

describe('computeJsonOutputSlots', () => {
  it('returns just image-out when prompts is empty', () => {
    const slots = computeJsonOutputSlots([])
    expect(slots).toEqual<SlotDef[]>([
      { id: 'image-out', label: 'Last', type: 'image' },
    ])
  })

  it('appends one image-N pin per prompt with short labels', () => {
    const slots = computeJsonOutputSlots(['a quick fox', 'lazy dog'])
    expect(slots).toEqual<SlotDef[]>([
      { id: 'image-out', label: 'Last', type: 'image' },
      { id: 'image-0', label: 'a quick', type: 'image' },
      { id: 'image-1', label: 'lazy dog', type: 'image' },
    ])
  })

  it('labels empty prompts as "(empty)"', () => {
    const slots = computeJsonOutputSlots(['ok', ''])
    expect(slots[2].label).toBe('(empty)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/nodes/generate-image/jsonMode.test.ts
```

Expected: FAIL with "computeJsonOutputSlots is not a function".

- [ ] **Step 3: Add implementation**

Append to `jsonMode.ts`:

```ts
import type { SlotDef } from '../_shared/NodeShell'

/**
 * Build the dynamic output slots when JSON mode is active.
 * `image-out` always exposes the last successful generation.
 * `image-N` exposes the result for prompts[N].
 */
export function computeJsonOutputSlots(prompts: string[]): SlotDef[] {
  const slots: SlotDef[] = [{ id: 'image-out', label: 'Last', type: 'image' }]
  prompts.forEach((p, i) => {
    slots.push({ id: `image-${i}`, label: shortLabel(p, i), type: 'image' })
  })
  return slots
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/nodes/generate-image/jsonMode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/generate-image/jsonMode.ts frontend/src/nodes/generate-image/jsonMode.test.ts
git commit -m "[feat] generate-image — computeJsonOutputSlots helper"
```

---

## Task 3: Pure helper — executeJsonMode batch loop

**Files:**
- Modify: `frontend/src/nodes/generate-image/jsonMode.ts`
- Modify: `frontend/src/nodes/generate-image/jsonMode.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `jsonMode.test.ts`:

```ts
import { executeJsonMode } from './jsonMode'
import { vi } from 'vitest'

describe('executeJsonMode', () => {
  it('returns mediaIds in order, one per prompt', async () => {
    const runOnce = vi.fn(async (p: string) => `mid-${p}`)
    const onProgress = vi.fn()
    const out = await executeJsonMode({
      prompts: ['a', 'b', 'c'],
      concurrency: 4,
      runOnce,
      onProgress,
    })
    expect(out.mids).toEqual(['mid-a', 'mid-b', 'mid-c'])
    expect(out.errs).toEqual([null, null, null])
    expect(runOnce).toHaveBeenCalledTimes(3)
    expect(onProgress).toHaveBeenCalledTimes(3)
  })

  it('skips empty prompts without calling runOnce', async () => {
    const runOnce = vi.fn(async (p: string) => `mid-${p}`)
    const out = await executeJsonMode({
      prompts: ['a', '', 'c'],
      concurrency: 4,
      runOnce,
      onProgress: () => {},
    })
    expect(out.mids).toEqual(['mid-a', null, 'mid-c'])
    expect(runOnce).toHaveBeenCalledTimes(2)
    expect(runOnce).toHaveBeenCalledWith('a')
    expect(runOnce).toHaveBeenCalledWith('c')
  })

  it('captures per-prompt failures without aborting the batch', async () => {
    const runOnce = vi.fn(async (p: string) => {
      if (p === 'b') throw new Error('boom')
      return `mid-${p}`
    })
    const out = await executeJsonMode({
      prompts: ['a', 'b', 'c'],
      concurrency: 4,
      runOnce,
      onProgress: () => {},
    })
    expect(out.mids).toEqual(['mid-a', null, 'mid-c'])
    expect(out.errs[0]).toBeNull()
    expect(out.errs[1]).toBe('boom')
    expect(out.errs[2]).toBeNull()
  })

  it('respects concurrency by chunking', async () => {
    let inFlight = 0
    let peak = 0
    const runOnce = vi.fn(async (p: string) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return `mid-${p}`
    })
    await executeJsonMode({
      prompts: Array.from({ length: 10 }, (_, i) => `p${i}`),
      concurrency: 4,
      runOnce,
      onProgress: () => {},
    })
    expect(peak).toBeLessThanOrEqual(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/nodes/generate-image/jsonMode.test.ts
```

Expected: FAIL with "executeJsonMode is not a function".

- [ ] **Step 3: Add implementation**

Append to `jsonMode.ts`:

```ts
export interface ExecuteJsonModeOptions {
  prompts: string[]
  concurrency: number
  runOnce: (prompt: string) => Promise<string>
  onProgress: () => void
}

export interface ExecuteJsonModeResult {
  mids: (string | null)[]
  errs: (string | null)[]
}

/**
 * Run prompts through `runOnce` in parallel batches of `concurrency`.
 * Empty/whitespace prompts are skipped (no API call). Per-prompt errors
 * are captured into `errs[i]` and do not abort the rest of the batch.
 * Results preserve input order regardless of completion order.
 */
export async function executeJsonMode(opts: ExecuteJsonModeOptions): Promise<ExecuteJsonModeResult> {
  const { prompts, concurrency, runOnce, onProgress } = opts
  const mids: (string | null)[] = new Array(prompts.length).fill(null)
  const errs: (string | null)[] = new Array(prompts.length).fill(null)

  for (let start = 0; start < prompts.length; start += concurrency) {
    const slice = prompts.slice(start, start + concurrency)
    await Promise.all(slice.map(async (prompt, j) => {
      const idx = start + j
      if (!prompt.trim()) {
        onProgress()
        return
      }
      try {
        mids[idx] = await runOnce(prompt)
      } catch (e) {
        errs[idx] = e instanceof Error ? e.message : String(e)
      }
      onProgress()
    }))
  }

  return { mids, errs }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/nodes/generate-image/jsonMode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/generate-image/jsonMode.ts frontend/src/nodes/generate-image/jsonMode.test.ts
git commit -m "[feat] generate-image — executeJsonMode batch loop"
```

---

## Task 4: Refactor runSingle to expose runOnce(prompt)

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts:430-535`

The current `runSingle` reads the prompt from `prompt-in`/`activePrompt` and runs the full pipeline. We need a variant that takes the prompt explicitly so JSON mode can call it per item without re-pulling the same upstream string.

- [ ] **Step 1: Locate the runSingle definition**

Open `frontend/src/nodes/generate-image/useGenerateImage.ts`. Find the line:

```ts
const runSingle = useCallback(async (batchAccum?: string[]): Promise<void> => {
```

(around line 430).

- [ ] **Step 2: Read the body and identify the prompt-resolution step**

The first lines are:
```ts
const rawPrompt = pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt
if (!rawPrompt.trim()) { setError('Write a prompt'); return }
const prompt = rawPrompt.trim()
```

These lines need to become a parameter. Everything after `const prompt = ...` stays the same.

- [ ] **Step 3: Refactor — make runSingle accept an optional prompt override**

Replace the signature and the first three lines:

```ts
const runSingle = useCallback(async (
  batchAccum?: string[],
  promptOverride?: string,
): Promise<void> => {
  const rawPrompt = promptOverride ?? (pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt)
  if (!rawPrompt.trim()) { setError('Write a prompt'); return }
  const prompt = rawPrompt.trim()
  // ... rest of body unchanged
```

- [ ] **Step 4: Run the existing frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: all 350 existing tests still pass — this refactor is behavior-preserving when `promptOverride` is not provided.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts
git commit -m "[refactor] generate-image — runSingle accepts optional promptOverride"
```

---

## Task 5: Add jsonMode state + JSON toggle button

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts:147-160` (state declarations) and the return object
- Modify: `frontend/src/nodes/generate-image/GenerateImageNode.tsx:96-100` (button row)

- [ ] **Step 1: Add the state declaration**

Open `useGenerateImage.ts`, find the block that declares `editMode` (around line 156-158):

```ts
const [editMode, setEditMode, editModeRef] = useStateRef(
  Boolean((data as Record<string, unknown>).editMode)
)
```

Add immediately after it:

```ts
const [jsonMode, setJsonMode, jsonModeRef] = useStateRef(
  Boolean((data as Record<string, unknown>).jsonMode)
)
```

- [ ] **Step 2: Add toggleJsonMode with mutual exclusion**

Find `markManualOverride` (around line 583). Add immediately before its declaration:

```ts
const toggleJsonMode = useCallback(() => {
  const next = !jsonModeRef.current
  setJsonMode(next)
  if (next && editModeRef.current) {
    setEditMode(false)
    updateNodeData(id, { jsonMode: next, editMode: false })
  } else {
    updateNodeData(id, { jsonMode: next })
  }
}, [setJsonMode, setEditMode, updateNodeData, id, jsonModeRef, editModeRef])
```

Symmetrically, find the existing EDIT button onClick handler and add jsonMode disable. In `GenerateImageNode.tsx`, the EDIT button currently:

```tsx
<button
  className={`${styles.batchBtn} ${h.editMode ? styles.batchBtnActive : ''}`}
  onClick={() => { h.setEditMode(!h.editMode); h.updateNodeData(id, { editMode: !h.editMode }) }}
  title="Edit Mode — re-uses last generated image as reference for iterative editing"
>EDIT</button>
```

Change its onClick to:

```tsx
onClick={() => {
  const next = !h.editMode
  h.setEditMode(next)
  if (next && h.jsonMode) {
    h.setJsonMode(false)
    h.updateNodeData(id, { editMode: next, jsonMode: false })
  } else {
    h.updateNodeData(id, { editMode: next })
  }
}}
```

- [ ] **Step 3: Export jsonMode + setJsonMode + toggleJsonMode from the hook**

Find the `return { ... }` object at the bottom of `useGenerateImage.ts` (around line 585). Add to the State section:

```ts
jsonMode, setJsonMode, toggleJsonMode,
```

- [ ] **Step 4: Add the JSON toggle button**

In `GenerateImageNode.tsx`, find the EDIT button (line ~95-99). Add immediately after it (still inside `arResRow`):

```tsx
<button
  className={`${styles.batchBtn} ${h.jsonMode ? styles.batchBtnActive : ''}`}
  onClick={h.toggleJsonMode}
  title="JSON mode — input must be a JSON array of prompt strings; one image per element"
>JSON</button>
```

- [ ] **Step 5: Run the test suite**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass. The new toggle has no test yet — that's covered by the manifest/UI smoke tests already present (defaultData unchanged, etc.).

- [ ] **Step 6: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts frontend/src/nodes/generate-image/GenerateImageNode.tsx
git commit -m "[feat] generate-image — JSON toggle button with EDIT mutual exclusion"
```

---

## Task 6: Compute jsonPrompts derived state + status line

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts` (memo + return)
- Modify: `frontend/src/nodes/generate-image/GenerateImageNode.tsx` (status line render)

- [ ] **Step 1: Add the jsonPrompts memo**

In `useGenerateImage.ts`, after the `activePrompt` block (around line 285-290), add:

```ts
import { parseJsonPrompts } from './jsonMode'

// ... at the top of the file, add the import

// Inside the hook, after activePrompt:
const jsonPrompts = useMemo<string[]>(() => {
  if (!jsonMode) return []
  return parseJsonPrompts(activePrompt || localPrompt)
}, [jsonMode, activePrompt, localPrompt])

const jsonPromptsRef = useRef<string[]>(jsonPrompts)
useEffect(() => { jsonPromptsRef.current = jsonPrompts }, [jsonPrompts])
```

- [ ] **Step 2: Track parse status separately**

After the `jsonPrompts` memo, add:

```ts
const jsonParseStatus = useMemo<'ok' | 'invalid' | 'empty'>(() => {
  if (!jsonMode) return 'empty'
  const raw = (activePrompt || localPrompt).trim()
  if (!raw) return 'empty'
  return jsonPrompts.length > 0 ? 'ok' : 'invalid'
}, [jsonMode, activePrompt, localPrompt, jsonPrompts])
```

- [ ] **Step 3: Export from hook**

Add to the return object:

```ts
jsonPrompts,
jsonParseStatus,
```

- [ ] **Step 4: Add the status line in GenerateImageNode.tsx**

Find the prompt textarea/preview block (lines 104-114). Insert immediately after the closing `)}` of that block:

```tsx
{h.jsonMode && (
  <div className={styles.jsonStatus} style={{
    fontSize: 11,
    padding: '2px 6px',
    color: h.jsonParseStatus === 'ok' ? 'var(--color-success)' :
           h.jsonParseStatus === 'invalid' ? 'var(--color-error)' :
           'var(--color-text-secondary)',
  }}>
    {h.jsonParseStatus === 'ok' && `JSON: ${h.jsonPrompts.length} prompts`}
    {h.jsonParseStatus === 'invalid' && 'JSON: invalid input — expecting an array of strings'}
    {h.jsonParseStatus === 'empty' && 'JSON: connect or paste an array of prompts'}
  </div>
)}
```

(Inline styles are used here intentionally — adding a CSS module class would touch a 3rd file outside the spec scope. Keep it inline.)

- [ ] **Step 5: Run tests + typecheck**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts frontend/src/nodes/generate-image/GenerateImageNode.tsx
git commit -m "[feat] generate-image — jsonPrompts memo + parse-status line"
```

---

## Task 7: Dynamic outputSlots in jsonMode

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts:411-418`

- [ ] **Step 1: Update the outputSlots memo**

Find the existing block (around line 411):

```ts
const outputSlots: SlotDef[] = useMemo(() => {
  if (batchCount <= 1) return [{ id: 'image-out', label: 'Image', type: 'image' as const }]
  return Array.from({ length: batchCount }, (_, i) => ({
    id: i === 0 ? 'image-out' : `image-out-${i}`,
    label: `${i + 1}`,
    type: 'image' as const,
  }))
}, [batchCount])
```

Replace with:

```ts
const outputSlots: SlotDef[] = useMemo(() => {
  if (jsonMode && jsonPrompts.length > 0) {
    return computeJsonOutputSlots(jsonPrompts)
  }
  if (batchCount <= 1) return [{ id: 'image-out', label: 'Image', type: 'image' as const }]
  return Array.from({ length: batchCount }, (_, i) => ({
    id: i === 0 ? 'image-out' : `image-out-${i}`,
    label: `${i + 1}`,
    type: 'image' as const,
  }))
}, [batchCount, jsonMode, jsonPrompts])
```

- [ ] **Step 2: Add the import at the top of the file**

Update the existing import line for `./jsonMode` (added in Task 6) to include `computeJsonOutputSlots`:

```ts
import { parseJsonPrompts, computeJsonOutputSlots } from './jsonMode'
```

- [ ] **Step 3: Update the updateNodeInternals effect**

Find the effect around line 420:

```ts
useEffect(() => { updateNodeInternals(id) }, [batchCount, id, updateNodeInternals])
```

Replace with:

```ts
useEffect(() => { updateNodeInternals(id) }, [batchCount, jsonMode, jsonPrompts.length, id, updateNodeInternals])
```

This makes React Flow recompute pin positions when JSON mode toggles or the prompt count changes.

- [ ] **Step 4: Run tests + typecheck**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts
git commit -m "[feat] generate-image — dynamic image-N output slots in jsonMode"
```

---

## Task 8: Hide ×N batch toggle when jsonMode is on

**Files:**
- Modify: `frontend/src/nodes/generate-image/GenerateImageNode.tsx:79-87`

- [ ] **Step 1: Wrap the batch toggle in a conditional**

Find:

```tsx
<div className={styles.batchToggle}>
  {[1, 2, 4].map(n => (
    <button key={n}
      className={`${styles.batchBtn} ${h.batchCount === n ? styles.batchBtnActive : ''}`}
      onClick={() => h.setBatchCount(n)}
      title={n === 1 ? 'Single generation' : `Generate ${n} images in parallel`}
    >×{n}</button>
  ))}
</div>
```

Wrap it:

```tsx
{!h.jsonMode && (
  <div className={styles.batchToggle}>
    {[1, 2, 4].map(n => (
      <button key={n}
        className={`${styles.batchBtn} ${h.batchCount === n ? styles.batchBtnActive : ''}`}
        onClick={() => h.setBatchCount(n)}
        title={n === 1 ? 'Single generation' : `Generate ${n} images in parallel`}
      >×{n}</button>
    ))}
  </div>
)}
```

- [ ] **Step 2: Run tests + typecheck**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/nodes/generate-image/GenerateImageNode.tsx
git commit -m "[feat] generate-image — hide batch ×N toggle when jsonMode active"
```

---

## Task 9: runJsonMode wrapper + dispatch

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts:537-578`

- [ ] **Step 1: Add the import**

Update the `./jsonMode` import:

```ts
import { parseJsonPrompts, computeJsonOutputSlots, executeJsonMode } from './jsonMode'
```

- [ ] **Step 2: Refactor runSingle to expose a runOnce-style return**

Currently `runSingle` saves the new mediaId via `setActiveMediaId(mediaId)` and pushes to history internally. We need a path where the new mediaId is also returned to the caller.

Find this block (around line 455-465):

```ts
const mediaId = generateMediaId()
setActiveMediaId(mediaId)
setImageB64(r.image_b64)
```

Look at the function's return type — currently `Promise<void>`. Change to `Promise<string | null>` (the new mediaId, or null on failure). Then before each `return` statement in `runSingle`, return the appropriate value.

The simplest path: at the very end of the successful branch (after the existing history-update logic), add:

```ts
return mediaId
```

And at every early-return / catch, return `null`:

```ts
if (!rawPrompt.trim()) { setError('Write a prompt'); return null }
// ... existing logic
// final success line:
return mediaId
```

Update the signature:

```ts
const runSingle = useCallback(async (
  batchAccum?: string[],
  promptOverride?: string,
): Promise<string | null> => {
  // ...
}, [/* unchanged deps */])
```

- [ ] **Step 3: Add runJsonMode function**

After the `run` callback (around line 578), add:

```ts
const runJsonMode = useCallback(async () => {
  const prompts = jsonPromptsRef.current
  if (prompts.length === 0) {
    setError('JSON mode is on but input is not a valid array of strings')
    return
  }
  setBatchProgress(0)

  const { mids, errs } = await executeJsonMode({
    prompts,
    concurrency: 4,
    runOnce: async (prompt: string) => {
      const mid = await runSingle(undefined, prompt)
      if (!mid) throw new Error('runSingle returned no mediaId')
      return mid
    },
    onProgress: () => setBatchProgress(p => p + 1),
  })

  // Build outputMediaIds: image-N → mid, plus image-out → last successful
  const outputMediaIds: Record<string, string> = {}
  mids.forEach((mid, i) => { if (mid) outputMediaIds[`image-${i}`] = mid })
  const lastSuccess = [...mids].reverse().find((m): m is string => !!m)
  if (lastSuccess) outputMediaIds['image-out'] = lastSuccess

  // Append all successful mediaIds to history
  const successful = mids.filter((m): m is string => !!m)
  const currentIds: string[] = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
  const newHistory = [...currentIds, ...successful].slice(-MAX_HISTORY)
  updateNodeData(id, { historyIds: newHistory, outputMediaIds })
  setHistoryIds(newHistory)

  // Aggregate errors
  const failedCount = errs.filter(Boolean).length
  if (failedCount > 0) {
    const summary = errs.filter(Boolean).slice(0, 3).join('; ')
    setError(`${failedCount}/${prompts.length} failed: ${summary}`)
  }
}, [runSingle, id, getNodes, historyIds, updateNodeData, setHistoryIds, setError, setBatchProgress])
```

- [ ] **Step 4: Wire the dispatch**

Find the existing `run` callback (around line 537):

```ts
const run = useCallback(async () => {
  setLoading(true)
  setError('')
  setBatchProgress(0)
  try {
    if (batchCount <= 1) {
      await runSingle()
      setBatchProgress(1)
    } else {
      // ... existing batch logic
    }
  } catch (e: unknown) {
    // ... unchanged
  } finally {
    // ... unchanged
  }
}, [batchCount, runSingle, id, getNodes, historyIds, updateNodeData, setHistoryIds])
```

Add the jsonMode branch as the first check inside the try:

```ts
const run = useCallback(async () => {
  setLoading(true)
  setError('')
  setBatchProgress(0)
  try {
    if (jsonModeRef.current) {
      await runJsonMode()
    } else if (batchCount <= 1) {
      await runSingle()
      setBatchProgress(1)
    } else {
      // ... existing batch logic unchanged
    }
  } catch (e: unknown) {
    // ... unchanged
  } finally {
    // ... unchanged
  }
}, [batchCount, runSingle, runJsonMode, id, getNodes, historyIds, updateNodeData, setHistoryIds, jsonModeRef])
```

- [ ] **Step 5: Run tests + typecheck**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: all 350 existing tests + Task 1-3 new tests pass. TypeScript clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts
git commit -m "[feat] generate-image — runJsonMode dispatch with parallel batches"
```

---

## Task 10: Cost preview multiplied by N in jsonMode

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts:402-405`

- [ ] **Step 1: Update the cost estimate display**

Find:

```ts
const promptForEstimate = pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt
const editRefCount = (editMode && currentMediaId) ? 1 : 0
const estimate = estimateCost(selectedModel, 'generate_image', promptForEstimate, connectedImageCount + editRefCount, 0, 1, resolution)
const estimatedLabel = formatCostEstimate(estimate.costUsd)
```

Replace the `estimatedLabel` line:

```ts
const estimateMultiplier = jsonMode && jsonPrompts.length > 0 ? jsonPrompts.length : 1
const totalEstimate = estimate.costUsd * estimateMultiplier
const estimatedLabel = estimateMultiplier > 1
  ? `${formatCostEstimate(estimate.costUsd)} × ${estimateMultiplier} = ${formatCostEstimate(totalEstimate)}`
  : formatCostEstimate(estimate.costUsd)
```

- [ ] **Step 2: Run tests + typecheck**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 3: Manual verification**

Start the dev server and verify in browser:

```bash
# Terminal 1 (if backend isn't already running)
python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload

# Terminal 2
cd frontend && npm run dev
```

Open http://localhost:5100. Drag a Generate Image node onto the canvas. Verify:
- JSON button appears in the AR/Res row, after EDIT.
- Default state: button is inactive (no accent).
- Click JSON: button becomes accent-coloured, ×N toggle disappears, status line says "JSON: connect or paste an array of prompts".
- Type `["a","b","c"]` into the textarea: status flips to green "JSON: 3 prompts", output pins update to image-out + image-0/1/2 with labels "a", "b", "c". Cost preview reads `≈ $X × 3 = $Y`.
- Click EDIT: JSON disables.
- Type invalid input like `not json`: status flips to red "JSON: invalid input — expecting an array of strings".

If the OpenAI/Gemini key is configured, also click Run with valid JSON and confirm 3 images come out connectable from the dynamic pins.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts
git commit -m "[feat] generate-image — cost preview multiplies by N in jsonMode"
```

---

## Task 11: Final verification + plan complete

- [ ] **Step 1: Run the full frontend test suite one more time**

```bash
cd frontend && npx vitest run
```

Expected: 350 existing + ~14 new tests in `jsonMode.test.ts` = ~364 tests, all green.

- [ ] **Step 2: Run TypeScript across the whole frontend**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run the Python backend test suite (sanity — should be unaffected)**

```bash
python -m pytest
```

Expected: 98 tests pass (no backend changes were made).

- [ ] **Step 4: Verify git log is clean and ready to push**

```bash
git log --oneline origin/dev..HEAD
```

Expected: ~10 commits, one per task above, all on `dev` branch.

- [ ] **Step 5: Mark plan complete**

If all verifications pass, the feature is ready. The user controls when to push to `origin/dev` (per CLAUDE.md, do not push without explicit request).

---

## Out of scope (deferred to future plans)

- Object-form JSON input (`{id: prompt}`) and array-of-objects.
- Per-item AR/resolution/model overrides.
- Per-item image refs (different ref per generated image).
- Auto-unpack into downstream nodes (like JSON Parser's unpack button).
- Persisted `jsonPrompts` in node data (today: re-derived from input on each render).
