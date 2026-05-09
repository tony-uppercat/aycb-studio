# Generate Image — Per-ID JSON Mode

**Date:** 2026-05-10
**Status:** Draft
**Owner:** Antonio

## Summary

Add a JSON toggle to the Generate Image node. When active, the node treats
its `prompt-in` input as a JSON array of prompt strings and produces one
image per element, exposed on dynamic output pins (`image-0`, `image-1`, ...).

This extends the existing batch ×N mechanism: instead of generating N
copies of the same prompt, we generate one image per JSON-supplied prompt.

## Motivation

Today, batch generation (×2/×4) iterates a single prompt. To generate from
a list of prompts (storyboard frames, character variations, A/B tests), the
user must duplicate the node N times or unpack the JSON manually. The new
mode collapses that loop into a single Run.

## Non-goals

- Per-item AR/resolution/model overrides (input is array of strings only).
- Object-form JSON (`{id: prompt}`) or array-of-objects (`[{id, prompt}]`).
  These can be added later if real use cases emerge.
- Per-item image refs. Refs on `image-N` input pins apply to every
  generation as common references.

## User-facing design

### Trigger
A new `JSON` toggle on the AR/Resolution row, next to `EDIT` and `GND`,
styled identically (`batchBtn`/`batchBtnActive`). Persisted in
`data.jsonMode: boolean`.

### Input format
The node parses the upstream text from `prompt-in` (or the local textarea
if no edge is connected) as a JSON array of strings:

```json
["prompt for first image", "prompt for second image", "prompt for third"]
```

Anything else (object, mixed types, parse error) shows a banner error in
the node and disables Run.

### Output pins
When `jsonMode` is on and N valid prompts are parsed:
```
image-out          label "Last"     — last successful generation
image-0            label "<2 words>" — from prompts[0]
image-1            label "<2 words>"
...
image-{N-1}        label "<2 words>"
```
Pin labels are the first 2 words of each prompt, mirroring the convention
already used by JSON Parser. Empty prompts get the literal label `(empty)`.

When `jsonMode` is off, the node behaves as today: ×1 → single
`image-out`, ×N → `image-out`, `image-out-1`, ..., `image-out-{N-1}`.

### Run flow
```
1. Click Run with jsonMode active.
2. Parse prompt-in as JSON array of strings → jsonPrompts.
3. Generate in parallel batches of max 4:
     for batch in chunks(jsonPrompts, 4):
       await Promise.all(batch.map(runOnce))
4. Each runOnce(prompt) calls the same provider as a normal Run —
   same selectedModel, AR, resolution, refs — only the prompt text
   differs. On success returns the new mediaId.
5. Build outputMediaIds map: { "image-N": mid_N, ... } for every success.
   Last successful entry also maps to "image-out".
6. Append all successful mediaIds to data.historyIds (capped at MAX_HISTORY=50).
7. Failed items leave their pin unset (downstream pulls null).
8. Aggregate per-item errors into one banner: "2/5 failed: timeout; quota".
```

### Cost preview
When `jsonMode` is on and N > 1, the estimate shows
`≈ $X × N = $Y` instead of the single-image figure.

## Technical design

### File scope (only 2 files)
- `frontend/src/nodes/generate-image/useGenerateImage.ts` — state, parsing,
  run dispatcher, output slot computation.
- `frontend/src/nodes/generate-image/GenerateImageNode.tsx` — the JSON toggle
  button, layout in the AR/Res row.

No changes to the data-propagation system: `outputMediaIds` is already the
canonical multi-output channel (used by batch ×N). Downstream nodes
already consume it via `useDataPropagation`.

### State additions
```ts
const [jsonMode, setJsonMode, jsonModeRef] = useStateRef(Boolean(data.jsonMode))
```
Same `useStateRef` pattern used for `editMode`, `useGrounding`, etc.

### Derived: jsonPrompts
```ts
const jsonPrompts = useMemo<string[]>(() => {
  if (!jsonMode) return []
  const raw = (pulled prompt text) ?? localPrompt
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    if (!parsed.every(p => typeof p === 'string')) return []
    return parsed.slice(0, 20)  // hard cap
  } catch { return [] }
}, [jsonMode, activePrompt, localPrompt])
```

### Output slots
```ts
const outputSlots = useMemo<SlotDef[]>(() => {
  if (jsonMode && jsonPrompts.length > 0) {
    return [
      { id: 'image-out', label: 'Last', type: 'image' },
      ...jsonPrompts.map((p, i) => ({
        id: `image-${i}`,
        label: shortLabel(p, i),
        type: 'image' as const,
      })),
    ]
  }
  // existing batchCount logic
}, [jsonMode, jsonPrompts, batchCount])

function shortLabel(prompt: string, i: number): string {
  if (!prompt.trim()) return '(empty)'
  return prompt.trim().split(/\s+/).slice(0, 2).join(' ') || `#${i + 1}`
}
```

### Run dispatcher
The existing `run()` function gains an early branch:
```ts
const run = useCallback(async () => {
  setLoading(true); setError(''); setBatchProgress(0)
  try {
    if (jsonModeRef.current) {
      await runJsonMode()
    } else if (batchCount <= 1) {
      await runSingle()
    } else {
      // existing batch logic unchanged
    }
  } finally {
    setLoading(false); setBatchProgress(0)
  }
}, [...])
```

`runJsonMode()` is new and adapts the existing batch loop:
```ts
async function runJsonMode() {
  const prompts = jsonPrompts
  if (prompts.length === 0) {
    setError('JSON mode is on but input is not a valid array of strings')
    return
  }
  const concurrency = 4
  const mids = new Array<string | null>(prompts.length).fill(null)
  const errs = new Array<string | null>(prompts.length).fill(null)

  for (let start = 0; start < prompts.length; start += concurrency) {
    const slice = prompts.slice(start, start + concurrency)
    await Promise.all(slice.map(async (prompt, j) => {
      const idx = start + j
      if (!prompt.trim()) { mids[idx] = null; return }
      try {
        const mid = await runOnce(prompt)  // shared with runSingle
        mids[idx] = mid
      } catch (e) {
        errs[idx] = e instanceof Error ? e.message : String(e)
      }
      setBatchProgress(p => p + 1)
    }))
  }

  const outputMediaIds: Record<string, string> = {}
  mids.forEach((mid, i) => { if (mid) outputMediaIds[`image-${i}`] = mid })
  const lastSuccess = [...mids].reverse().find(m => m !== null)
  if (lastSuccess) outputMediaIds['image-out'] = lastSuccess

  const newHistory = [...historyIds, ...mids.filter((m): m is string => !!m)].slice(-MAX_HISTORY)
  updateNodeData(id, { historyIds: newHistory, outputMediaIds })
  setHistoryIds(newHistory)

  const failedCount = errs.filter(Boolean).length
  if (failedCount > 0) {
    const summary = errs.filter(Boolean).slice(0, 3).join('; ')
    setError(`${failedCount}/${prompts.length} failed: ${summary}`)
  }
}
```

`runOnce(prompt)` is a small refactor of the body of `runSingle()` that
takes an explicit prompt string and returns the new mediaId. The existing
`runSingle()` becomes a thin wrapper that pulls the prompt from
`prompt-in`/`activePrompt` then calls `runOnce`. Same code, narrower input.

### Mutual exclusion
```ts
// In setJsonMode: if turning JSON on, also turn EDIT off.
function toggleJsonMode() {
  const next = !jsonMode
  setJsonMode(next)
  if (next && editMode) setEditMode(false)
  updateNodeData(id, { jsonMode: next, ...(next && editMode ? { editMode: false } : {}) })
}
// Symmetric: toggling EDIT on while JSON is on disables JSON.
```

### UI changes (GenerateImageNode.tsx)
Add the JSON button after EDIT in the existing `arResRow`:
```tsx
<button
  className={`${styles.batchBtn} ${h.jsonMode ? styles.batchBtnActive : ''}`}
  onClick={h.toggleJsonMode}
  title="JSON mode — input must be a JSON array of prompt strings; one image per element"
>JSON</button>
```

When `jsonMode` is on:
- Hide the `×1 ×2 ×4` toggle (JSON drives N).
- Show parse-status line: `JSON: 5 prompts` (green) or `JSON: invalid input` (red).
- Show cost preview as `≈ $0.04 × 5 = $0.20`.

## Edge cases

| Case | Behavior |
|---|---|
| N > 20 prompts | Truncate at 20, show toast "Too many prompts (max 20)" |
| `×N` toggle visible while jsonMode on | Hidden visually; ignored at runtime |
| EDIT and JSON both attempted on | Mutual exclusion — toggling one off disables the other |
| GND + JSON | Compatible — grounding applied to every generation (Gemini only) |
| Empty string in array | Pin labelled `(empty)`, no API call, pin stays unset |
| Invalid JSON | Banner error, Run disabled |
| `prompt-in` disconnected | Parse the local textarea instead |
| Partial failure (2/5) | Successful pins emit; banner reports failed indices |
| Project save/load | `jsonMode` + `outputMediaIds` persisted; pins reconstruct from live parse on reload |

## Testing

Add `frontend/src/nodes/generate-image/jsonMode.test.ts`:
- `parseJsonPrompts` returns `[]` on invalid JSON, non-array, mixed types
- `parseJsonPrompts` truncates at 20 and reports it
- `shortLabel` returns first-2-words, `(empty)` for blank, `#N` fallback
- `outputSlots` includes `image-out` + N indexed pins when jsonMode on
- `outputSlots` falls back to batch logic when jsonMode off
- `runJsonMode` produces correct `outputMediaIds` map (mock provider)
- `runJsonMode` aggregates partial failures into one error banner
- Mutual exclusion: turning JSON on while EDIT is on disables EDIT

Test count target: ~10 tests, single file, no changes to existing
generate-image.test.ts (manifest test stays as-is).

## Migration & rollback

No data migration needed. New field `data.jsonMode` defaults to `false`
for existing projects (absent → falsy). Rollback = remove the toggle and
the `runJsonMode` branch; existing nodes continue to work.

## Open questions

None. All decisions confirmed in brainstorming session 2026-05-10.
