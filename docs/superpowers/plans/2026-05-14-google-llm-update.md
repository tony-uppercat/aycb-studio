# Google LLM Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `gemini-3.1-flash-lite-preview` with the GA `gemini-3.1-flash-lite` everywhere, remove the deprecated `gemini-2.5-flash` and `gemini-2.5-pro` entries, and prune the now-dead `thinking_budget` branch in the LLM router.

**Architecture:** Single source of truth lives in `src/registry.py` (BE) and `frontend/src/utils/costEstimate.ts` (FE). All other touched files mirror those. A migration alias in the frontend provider's `MODEL_MAP` keeps saved canvases with the legacy `-preview` id working transparently — the provider rewrites the id before the HTTP call.

**Tech Stack:** TypeScript 5.9 / React 19 (frontend), Python 3.11 / FastAPI (backend), Vitest (FE tests), pytest (BE tests).

**Scope reminder:** LLM **text** capability only. Image generation models (Nano Banana 2 / Pro) and embedding models are out of scope.

**Commit policy:** Single commit at the end of the plan, per Antonio's "no micro-commits" preference. Pre-commit verification: full FE + BE test suites pass.

---

## Pre-flight: confirm starting state

Before any code change, the implementer must:

- [ ] **Step 1: Read the spec**

```bash
cat docs/superpowers/specs/2026-05-14-google-llm-update-design.md
```

Expected: read fully; the spec is the source of truth for what to change.

- [ ] **Step 2: Confirm working-tree state**

```bash
git status --short
```

Expected output (the listed `M` files are in-flight image-quality work, not ours; we will edit some of them but should preserve their existing edits):

```
M frontend/src/components/media/FullscreenViewer.tsx
M frontend/src/components/media/useImageZoom.ts
M frontend/src/nodes/_shared/Node.module.css
M frontend/src/nodes/generate-image/GenerateImageNode.tsx
M frontend/src/nodes/generate-image/useGenerateImage.ts
M frontend/src/providers/geminiProvider.test.ts
M frontend/src/providers/geminiProvider.ts
M frontend/src/utils/costEstimate.test.ts
M frontend/src/utils/costEstimate.ts
M src/gemini.py
M src/routers/llm.py
M tests/test_gemini_image.py
?? scripts/smoke_test_flash_*.py
?? docs/nano_banana_api_reference.md
```

Do NOT revert or stash these. They are intentional in-flight work that this plan extends.

- [ ] **Step 3: Confirm baseline tests green**

```bash
python -m pytest -q
```

Expected: `98 passed`. If anything fails, stop and report.

```bash
cd frontend && npx vitest run --silent
```

Expected: `350 passed` (or whatever the current image-quality push has it at — record the baseline number for comparison).

```bash
cd frontend && npx tsc --noEmit
```

Expected: no output (clean).

---

## Task 1: Backend registry — add Flash-Lite GA, remove `-preview` and 2.5

**Files:**
- Modify: `src/registry.py:76-135` (the `_TEXT_MODELS` tuple)
- Modify: `tests/test_registry.py` (add new assertions)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_registry.py`:

```python
# ── LLM text-model lineup (2026-05-14 update) ──────────────────────────

def test_registry_has_flash_lite_ga():
    """Flash-Lite GA was released 2026-05-07; preview shuts down 2026-05-25."""
    from src.registry import REGISTRY
    m = REGISTRY["gemini-3.1-flash-lite"]
    assert m.cost_per_token == (0.25, 1.50)
    assert m.capability == "text"
    assert m.provider == "gemini"
    assert m.deprecated is False


def test_registry_drops_flash_lite_preview():
    """Preview id removed in favor of GA — saved canvases migrate via MODEL_MAP."""
    from src.registry import REGISTRY
    assert "gemini-3.1-flash-lite-preview" not in REGISTRY


def test_registry_drops_gemini_2_5_text_models():
    """gemini-2.5-flash and gemini-2.5-pro shut down 2026-10-16; removed early."""
    from src.registry import REGISTRY
    assert "gemini-2.5-flash" not in REGISTRY
    assert "gemini-2.5-pro" not in REGISTRY
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest tests/test_registry.py::test_registry_has_flash_lite_ga tests/test_registry.py::test_registry_drops_flash_lite_preview tests/test_registry.py::test_registry_drops_gemini_2_5_text_models -v
```

Expected: 3 failures. The first because the GA id is not in the registry; the latter two because the preview / 2.5 ids are still present.

- [ ] **Step 3: Update `src/registry.py`**

In `_TEXT_MODELS` (lines 76-135), replace the block:

```python
    Model(
        id="gemini-3.1-flash-lite-preview",
        name="Gemini 3.1 Flash-Lite",
        provider="gemini",
        capability="text",
        cost_per_token=(0.25, 1.50),
    ),
```

with:

```python
    Model(
        id="gemini-3.1-flash-lite",
        name="Gemini 3.1 Flash-Lite",
        provider="gemini",
        capability="text",
        cost_per_token=(0.25, 1.50),
    ),
```

Then delete these two blocks entirely:

```python
    Model(
        id="gemini-2.5-flash",
        name="Gemini 2.5 Flash",
        provider="gemini",
        capability="text",
        cost_per_token=(0.30, 2.50),
        deprecated=True,
    ),
    Model(
        id="gemini-2.5-pro",
        name="Gemini 2.5 Pro",
        provider="gemini",
        capability="text",
        cost_per_token=(1.25, 10.00),
        deprecated=True,
    ),
```

- [ ] **Step 4: Run the registry tests**

```bash
python -m pytest tests/test_registry.py -v
```

Expected: all green, including the three new tests.

---

## Task 2: Backend shared.py — sync `MODELS` and `MODEL_PRICING`

**Files:**
- Modify: `src/shared.py:103-130` (`MODELS` and `MODEL_PRICING` dicts)
- Modify: `tests/test_registry.py` (the drift test `test_registry_llm_pricing_matches_shared_module` must keep passing)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_registry.py`:

```python
def test_shared_model_pricing_has_flash_lite_ga():
    from src.shared import MODEL_PRICING
    assert MODEL_PRICING["gemini-3.1-flash-lite"] == (0.25, 1.50)


def test_shared_model_pricing_keeps_preview_alias_for_transition():
    """Saved canvases still pass the -preview id to estimateCost. Keep the
    alias entry until 2026-06-30 so the cost display doesn't fall to $0."""
    from src.shared import MODEL_PRICING
    assert MODEL_PRICING["gemini-3.1-flash-lite-preview"] == (0.25, 1.50)


def test_shared_model_pricing_drops_gemini_2_5():
    from src.shared import MODEL_PRICING
    assert "gemini-2.5-flash" not in MODEL_PRICING
    assert "gemini-2.5-pro" not in MODEL_PRICING


def test_shared_models_display_map_points_to_ga():
    from src.shared import MODELS
    assert MODELS["Gemini 3.1 Flash-Lite"] == "gemini-3.1-flash-lite"
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest tests/test_registry.py::test_shared_model_pricing_has_flash_lite_ga tests/test_registry.py::test_shared_model_pricing_keeps_preview_alias_for_transition tests/test_registry.py::test_shared_model_pricing_drops_gemini_2_5 tests/test_registry.py::test_shared_models_display_map_points_to_ga -v
```

Expected: 3 failures (the GA id missing, the 2.5 entries still present, the display map still pointing to `-preview`). The alias-kept test will already pass since the preview entry is currently present — that's fine.

- [ ] **Step 3: Update `src/shared.py`**

Replace lines 103-107 (the `MODELS` dict body) with:

```python
MODELS = {
    "Gemini 3.1 Pro": "gemini-3.1-pro-preview",
    "Gemini 3.1 Flash-Lite": "gemini-3.1-flash-lite",
    "Gemini 3 Flash": "gemini-3-flash-preview",
}
```

Replace the `MODEL_PRICING` block (lines 115-130) with:

```python
# Cost per 1M tokens (USD): (input_per_1M, output_per_1M)
MODEL_PRICING = {
    # Gemini 3.1
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    # Transition alias — canvases saved before 2026-05-14 still pass this id.
    # Safe to remove after 2026-06-30.
    "gemini-3.1-flash-lite-preview": (0.25, 1.50),
    "gemini-3.1-flash-image-preview": (0.50, 60.00),   # image gen: $60/1M output
    # Gemini 3
    "gemini-3-flash-preview": (0.50, 3.00),
    "gemini-3-pro-image-preview": (2.00, 120.00),      # image gen: $120/1M output
    # Claude (Anthropic)
    "claude-sonnet-4-6-20250620": (3.00, 15.00),
    "claude-opus-4-6-20250620": (15.00, 75.00),
    "claude-haiku-4-5-20251001": (0.80, 4.00),
}
```

- [ ] **Step 4: Run the registry tests**

```bash
python -m pytest tests/test_registry.py -v
```

Expected: all green. The drift test `test_registry_llm_pricing_matches_shared_module` continues to pass because both sides now have the GA id at the same pricing.

---

## Task 3: Backend routers/llm.py — prune dead `thinking_budget` branch

**Files:**
- Modify: `src/routers/llm.py:118-149` (the `is_gemini3` / `thinking_budget` branches in `_chat_gemini`)

Note: This file is `M` in working tree from the image-quality push. Re-read before editing — `git show :src/routers/llm.py` to see the staged-vs-working diff if needed.

- [ ] **Step 1: Re-read the current file**

```bash
cat src/routers/llm.py
```

Confirm the function `_chat_gemini` still contains the block:

```python
        if is_thinking:
            if is_gemini3:
                config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                    include_thoughts=True, thinking_level="high"
                )
            else:
                config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                    include_thoughts=True, thinking_budget=-1
                )
```

If the current text has drifted from the spec, stop and report.

- [ ] **Step 2: Apply the edit**

Replace the block above with:

```python
        if is_thinking and is_gemini3:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                include_thoughts=True, thinking_level="high"
            )
```

The `else` branch is removed: with `gemini-2.5-*` gone from `MODELS`, no caller passes a non-gen3 thinking-capable model. The `is_gemini3` guard remains so a future non-gen3 model passed in error becomes a silent no-op (no thinking config) rather than a 400 from the API.

- [ ] **Step 3: Verify the change compiles and existing tests still pass**

```bash
python -m pytest tests/ -q
```

Expected: 98 passed (or 98 + the 7 new assertions from Tasks 1-2 = 105).

---

## Task 4: Backend settings.py — update default `gemini_flash_model`

**Files:**
- Modify: `config/settings.py:40`

- [ ] **Step 1: Apply the edit**

Change line 40 from:

```python
    gemini_flash_model: str = "gemini-3.1-flash-lite-preview"
```

to:

```python
    gemini_flash_model: str = "gemini-3.1-flash-lite"
```

- [ ] **Step 2: Verify**

```bash
python -m pytest tests/ -q
```

Expected: all green. No test references the literal default value, so this is a safe one-line change.

---

## Task 5: Frontend costEstimate.ts — add GA, keep preview alias, drop 2.5

**Files:**
- Modify: `frontend/src/utils/costEstimate.ts:14-44` (the `MODEL_PRICING` const)
- Modify: `frontend/src/utils/costEstimate.test.ts` (add LLM pricing test)

Note: `costEstimate.ts` is `M` in working tree from image-quality push. Re-read before editing.

- [ ] **Step 1: Re-read the current file**

```bash
cat frontend/src/utils/costEstimate.ts | head -45
```

Confirm `MODEL_PRICING` still contains the `gemini-2.5-*` lines (27-28) and the `gemini-3.1-flash-lite-preview` line (17). If the current text has drifted, stop and report.

- [ ] **Step 2: Write the failing test**

Append to `frontend/src/utils/costEstimate.test.ts`:

```ts
describe('estimateCost — LLM text pricing (Gemini 3.1 Flash-Lite GA)', () => {
  it('returns non-zero cost for gemini-3.1-flash-lite GA id', () => {
    const result = estimateCost('gemini-3.1-flash-lite', 'llm_chat', 'hello there', 0)
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('returns non-zero cost for the transition alias gemini-3.1-flash-lite-preview', () => {
    const result = estimateCost('gemini-3.1-flash-lite-preview', 'llm_chat', 'hello there', 0)
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('returns zero cost for the removed gemini-2.5-flash', () => {
    const result = estimateCost('gemini-2.5-flash', 'llm_chat', 'hello there', 0)
    expect(result.costUsd).toBe(0)
  })

  it('returns zero cost for the removed gemini-2.5-pro', () => {
    const result = estimateCost('gemini-2.5-pro', 'llm_chat', 'hello there', 0)
    expect(result.costUsd).toBe(0)
  })
})
```

- [ ] **Step 3: Run to verify failures**

```bash
cd frontend && npx vitest run src/utils/costEstimate.test.ts
```

Expected: 2 failures — the GA pricing lookup returns 0 (model not in `MODEL_PRICING`), and the 2.5 entries currently still return non-zero. The preview alias test currently passes (because the preview entry still exists). After the edit it will keep passing.

- [ ] **Step 4: Apply the edit**

In `frontend/src/utils/costEstimate.ts`, replace lines 14-44 (the `MODEL_PRICING` const) with:

```ts
export const MODEL_PRICING: Record<string, [number, number]> = {
  // Gemini 3.1 (text/LLM)
  'gemini-3.1-pro-preview':           [2.00, 12.00],
  'gemini-3.1-flash-lite':            [0.25,  1.50],
  // Transition alias — canvases saved before 2026-05-14 still pass this id.
  // Safe to remove after 2026-06-30.
  'gemini-3.1-flash-lite-preview':    [0.25,  1.50],
  // Nano Banana 2 (Gemini 3.1 Flash Image) — ~$0.067/image @1K, $0.15 @4K
  'gemini-3.1-flash-image-preview':   [0.50, 60.00],
  // Gemini 3 (text/LLM)
  'gemini-3-flash-preview':           [0.50,  3.00],
  // Nano Banana Pro (Gemini 3 Pro Image) — ~$0.134/image @1K-2K, $0.24 @4K
  'gemini-3-pro-image-preview':       [2.00, 120.00],
  // GPT Image 2 (tokenized: $5/M text in, $8/M image in, $30/M image out)
  'gpt-image-2':                      [5.00, 30.00],
  // Claude models (approximate)
  'claude-sonnet-4-6-20250620':       [3.00, 15.00],
  'claude-opus-4-6-20250620':         [15.00, 75.00],
  'claude-haiku-4-5-20251001':        [0.80, 4.00],
  // Recraft V4 (fixed per-image pricing)
  'recraftv4':                            [0, 40.00],
  'recraftv4_pro':                        [0, 250.00],
  'recraftv4_vector':                     [0, 80.00],
  'recraftv4_pro_vector':                 [0, 300.00],
  // Flux models (BFL API — approximated per image as output tokens)
  'flux-2-klein-4b':                    [0, 14.00],
  'flux-2-klein-9b':                    [0, 15.00],
  // Local models (free)
  'local/flux-2-klein-4b':             [0, 0],
  'local/flux-2-klein-9b':             [0, 0],
}
```

The legacy "Gemini 2.5" comment block is gone; the GA + transition alias replace the lone preview entry.

- [ ] **Step 5: Run the tests**

```bash
cd frontend && npx vitest run src/utils/costEstimate.test.ts
```

Expected: all green (existing image-quality-push tests + the 4 new LLM tests).

---

## Task 6: Frontend LLMNode.tsx + manifest — switch to GA id

**Files:**
- Modify: `frontend/src/nodes/llm/LLMNode.tsx:18-27` (the `LLM_MODELS` array)
- Modify: `frontend/src/nodes/llm/node.manifest.ts:9` (the `defaultData.selectedModel`)
- Modify: `frontend/src/nodes/llm/llm.test.ts:22` (the assertion on `defaultData.selectedModel`)

- [ ] **Step 1: Update the manifest default**

In `frontend/src/nodes/llm/node.manifest.ts:9`, change:

```ts
  defaultData: { prompt: '', systemPrompt: '', selectedModel: 'gemini-3.1-flash-lite-preview:thinking' },
```

to:

```ts
  defaultData: { prompt: '', systemPrompt: '', selectedModel: 'gemini-3.1-flash-lite:thinking' },
```

- [ ] **Step 2: Update the manifest test**

In `frontend/src/nodes/llm/llm.test.ts:22`, change:

```ts
    expect(manifest.defaultData.selectedModel).toBe('gemini-3.1-flash-lite-preview:thinking')
```

to:

```ts
    expect(manifest.defaultData.selectedModel).toBe('gemini-3.1-flash-lite:thinking')
```

- [ ] **Step 3: Update `LLM_MODELS` in LLMNode.tsx**

In `frontend/src/nodes/llm/LLMNode.tsx`, replace lines 19-20:

```ts
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', api: 'gemini', tooltip: 'Ultra fast & cheap, thinking support', price: '$0.25/$1.50', cost: 0.25, deprecated: false },
  { id: 'gemini-3.1-flash-lite-preview:thinking', name: 'Gemini 3.1 Flash-Lite Thinking', api: 'gemini', tooltip: '3.1 Flash-Lite with high thinking level', price: '$0.25/$1.50', cost: 0.25, deprecated: false },
```

with:

```ts
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', api: 'gemini', tooltip: 'GA — ultra fast & cheap, default minimal thinking', price: '$0.25/$1.50', cost: 0.25, deprecated: false },
  { id: 'gemini-3.1-flash-lite:thinking', name: 'Gemini 3.1 Flash-Lite Thinking', api: 'gemini', tooltip: 'GA — Flash-Lite with thinking forced to high', price: '$0.25/$1.50', cost: 0.25, deprecated: false },
```

- [ ] **Step 4: Run the LLM tests**

```bash
cd frontend && npx vitest run src/nodes/llm/llm.test.ts
```

Expected: all green.

---

## Task 7: Frontend geminiProvider.ts — add migration alias

**Files:**
- Modify: `frontend/src/providers/geminiProvider.ts:17-25` (the `MODEL_MAP` const)
- Modify: `frontend/src/providers/geminiProvider.test.ts` (append a `describe` for `resolveModel`)

Note: `geminiProvider.ts` and `geminiProvider.test.ts` are `M` in working tree from image-quality push. Re-read before editing.

- [ ] **Step 1: Re-read the current file**

```bash
cat frontend/src/providers/geminiProvider.ts | head -30
```

Confirm `MODEL_MAP` still maps `'Gemini 3.1 Flash-Lite'` to `'gemini-3.1-flash-lite-preview'`. If drifted, stop and report.

- [ ] **Step 2: Write the failing test**

Append to `frontend/src/providers/geminiProvider.test.ts`:

```ts
describe('resolveModel — migration aliases (2026-05-14)', () => {
  it('maps the display name "Gemini 3.1 Flash-Lite" to the GA id', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('Gemini 3.1 Flash-Lite')).toBe('gemini-3.1-flash-lite')
  })

  it('migrates the legacy preview id to the GA id (saved canvases)', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('gemini-3.1-flash-lite-preview')).toBe('gemini-3.1-flash-lite')
  })

  it('migrates the legacy preview :thinking id to the GA :thinking id', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('gemini-3.1-flash-lite-preview:thinking')).toBe('gemini-3.1-flash-lite:thinking')
  })

  it('passes the GA id through unchanged', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('gemini-3.1-flash-lite')).toBe('gemini-3.1-flash-lite')
  })
})
```

- [ ] **Step 3: Run to verify the failures**

```bash
cd frontend && npx vitest run src/providers/geminiProvider.test.ts
```

Expected: 2 failures — the display-name test maps to the legacy id, and the preview-id migration tests return their input unchanged.

- [ ] **Step 4: Apply the edit**

In `frontend/src/providers/geminiProvider.ts`, replace the `MODEL_MAP` const (lines 17-25):

```ts
const MODEL_MAP: Record<string, string> = {
  'Gemini 3.1 Pro': 'gemini-3.1-pro-preview',
  'Gemini 3.1 Flash-Lite': 'gemini-3.1-flash-lite-preview',
  'Gemini 3.1 Flash-Lite Thinking': 'gemini-3.1-flash-lite-preview:thinking',
  'Gemini 3 Flash': 'gemini-3-flash-preview',
  'Gemini 3 Flash Thinking': 'gemini-3-flash-preview:thinking',
  'Gemini 3.1 Flash Image': 'gemini-3.1-flash-image-preview',
  'Gemini 3 Pro Image': 'gemini-3-pro-image-preview',
}
```

with:

```ts
const MODEL_MAP: Record<string, string> = {
  // Display-name → id aliases (legacy callers passing labels rather than ids)
  'Gemini 3.1 Pro': 'gemini-3.1-pro-preview',
  'Gemini 3.1 Flash-Lite': 'gemini-3.1-flash-lite',
  'Gemini 3.1 Flash-Lite Thinking': 'gemini-3.1-flash-lite:thinking',
  'Gemini 3 Flash': 'gemini-3-flash-preview',
  'Gemini 3 Flash Thinking': 'gemini-3-flash-preview:thinking',
  'Gemini 3.1 Flash Image': 'gemini-3.1-flash-image-preview',
  'Gemini 3 Pro Image': 'gemini-3-pro-image-preview',
  // Migration aliases — saved canvases serialized before 2026-05-14 carry the
  // -preview id; rewrite to GA before the HTTP call so the API still resolves.
  // Safe to remove after 2026-06-30.
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview:thinking': 'gemini-3.1-flash-lite:thinking',
}
```

- [ ] **Step 5: Run the provider tests**

```bash
cd frontend && npx vitest run src/providers/geminiProvider.test.ts
```

Expected: all green (existing image-quality-push tests + the 4 new alias tests).

---

## Task 8: Final verification + commit

- [ ] **Step 1: Full backend suite**

```bash
python -m pytest -q
```

Expected: 98 + 7 = 105 passed (or whatever the new total is — confirm zero failures and zero errors).

- [ ] **Step 2: Full frontend suite**

```bash
cd frontend && npx vitest run --silent
```

Expected: baseline + 8 = total passed, zero failures.

- [ ] **Step 3: TypeScript clean**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Inspect the diff**

```bash
git diff --stat
```

Expected to show changes in exactly these files (plus the pre-existing `M` files from image-quality push):

```
 config/settings.py                                   |   2 +-
 frontend/src/nodes/llm/LLMNode.tsx                   |   4 +-
 frontend/src/nodes/llm/llm.test.ts                   |   2 +-
 frontend/src/nodes/llm/node.manifest.ts              |   2 +-
 frontend/src/providers/geminiProvider.ts             |   ?
 frontend/src/providers/geminiProvider.test.ts        |   ?
 frontend/src/utils/costEstimate.ts                   |   ?
 frontend/src/utils/costEstimate.test.ts              |   ?
 src/registry.py                                      |   ?
 src/routers/llm.py                                   |   ?
 src/shared.py                                        |   ?
 tests/test_registry.py                               |   ?
```

Any other file touched is a bug — stop and investigate.

- [ ] **Step 5: Stage and commit**

```bash
git add config/settings.py \
  frontend/src/nodes/llm/LLMNode.tsx \
  frontend/src/nodes/llm/llm.test.ts \
  frontend/src/nodes/llm/node.manifest.ts \
  frontend/src/providers/geminiProvider.ts \
  frontend/src/providers/geminiProvider.test.ts \
  frontend/src/utils/costEstimate.ts \
  frontend/src/utils/costEstimate.test.ts \
  src/registry.py \
  src/routers/llm.py \
  src/shared.py \
  tests/test_registry.py
```

Do NOT use `git add -A` or `git add .` — that would also stage the unrelated `M` files from image-quality push. Stage exactly the 12 files this plan touched.

```bash
git commit -m "$(cat <<'EOF'
[feat] LLM models — migrate Flash-Lite preview→GA, drop gemini-2.5-*

- Replace gemini-3.1-flash-lite-preview with gemini-3.1-flash-lite (GA)
  everywhere. Preview shuts down 2026-05-25.
- Remove gemini-2.5-flash and gemini-2.5-pro from registry + pricing
  tables (deprecated, shutdown 2026-10-16).
- Add migration alias gemini-3.1-flash-lite-preview → -lite in
  geminiProvider MODEL_MAP and keep matching pricing entry so saved
  canvases continue to work; cleanup scheduled after 2026-06-30.
- Prune dead thinking_budget branch in routers/llm.py (was only used
  by gemini-2.5-*).
- Update settings.py gemini_flash_model default to GA id.

Scope: LLM chat only. Image gen and embedding models unchanged.
Spec: docs/superpowers/specs/2026-05-14-google-llm-update-design.md
EOF
)"
```

- [ ] **Step 6: Confirm commit landed**

```bash
git log --oneline -3
```

Expected: top entry is the new commit, second is `f6b9627` (spec), third is the prior commit.

- [ ] **Step 7: Add a follow-up memory note**

Save a project memory at `C:\Users\upper\.claude\projects\C--Users-upper-Documents-00-aycb-v2\memory\project_llm_alias_cleanup.md`:

```markdown
---
name: project-llm-alias-cleanup
description: 2026-06-30 cleanup — remove the gemini-3.1-flash-lite-preview transition aliases added on 2026-05-14
metadata:
  type: project
---

After 2026-06-30, remove the transition aliases for
`gemini-3.1-flash-lite-preview`:

- `frontend/src/providers/geminiProvider.ts` MODEL_MAP migration entries
- `frontend/src/utils/costEstimate.ts` MODEL_PRICING preview entry
- `src/shared.py` MODEL_PRICING preview entry

**Why:** The preview model shut down 2026-05-25; after one month any
canvas still using the saved preview id has almost certainly been
re-opened and re-saved with the GA id. The aliases protect from one
edge case (frozen canvases never touched).

**How to apply:** Grep for `gemini-3.1-flash-lite-preview` after
2026-06-30; if any references remain in non-archive code, remove them.
Update [[feedback_verify_empirically]] check: a smoke test confirms
the GA id still serves.
```

Add a one-liner to `MEMORY.md`:

```markdown
- [LLM alias cleanup](project_llm_alias_cleanup.md) — Remove flash-lite-preview transition aliases after 2026-06-30
```

---

## Self-Review

**Spec coverage:**
- Replace preview→GA → Tasks 1, 2, 4, 5, 6, 7 (registry, shared, settings, costEstimate, LLMNode+manifest, provider MODEL_MAP)
- Remove 2.5 → Tasks 1 (registry), 2 (shared), 5 (costEstimate)
- Migration alias → Tasks 2, 5, 7 (pricing on both sides, MODEL_MAP)
- Prune `thinking_budget` → Task 3
- Test coverage → embedded in each task

**Placeholder scan:** No TBD / TODO / "fill in" / "similar to" / "add error handling" patterns. Every edit shows the exact code.

**Type consistency:**
- The GA id `gemini-3.1-flash-lite` is used in: `LLM_MODELS` (FE), `MODELS` (BE display map), `_TEXT_MODELS` (BE registry), both `MODEL_PRICING` tables, `MODEL_MAP` (FE provider), `node.manifest.ts` defaultData, `llm.test.ts` assertion, `settings.py` default. All match.
- The `:thinking` suffix variant is used in `LLM_MODELS`, `MODEL_MAP` migration, and `node.manifest.ts`. All consistent.
- The transition alias preview id is kept in both pricing tables and in the migration `MODEL_MAP`, never in `MODELS` (display-side) or `_TEXT_MODELS` (registry).

**Risks acknowledged:**
- The image-quality-push files (`geminiProvider.ts`, `costEstimate.ts`, `routers/llm.py`, etc.) are `M` in working tree. Each task that touches them includes a re-read step to detect drift.
- The commit uses an explicit file list, not `git add -A`, to avoid sweeping in unrelated changes.

---

**End of plan.**
