# Google LLM Update — Design (2026-05-14)

## Context

Google Gemini API shipped the GA release of `gemini-3.1-flash-lite` on
2026-05-07 and announced shutdown of `gemini-3.1-flash-lite-preview` for
2026-05-25 — 11 days from this design. AYCB v2 still ships the preview
id in the LLM dropdown, in the backend registry, and in the analyze
default. Two further legacy ids (`gemini-2.5-flash`, `gemini-2.5-pro`)
are flagged deprecated in the registry but still appear in the pricing
tables. This design replaces the preview with GA, removes the dead 2.5
entries, and prunes one branch of `routers/llm.py` that only existed to
support 2.5's `thinking_budget` parameter.

Scope is restricted to **LLM chat (text capability)**. Image generation
models (Nano Banana 2 / Pro) and the embedding model are intentionally
left out — Nano Banana was refreshed earlier this week in the image
quality push, and the embedding model belongs to vision/analyze, not
LLM chat.

## Goals

1. Eliminate the 25 May 2026 shutdown risk by swapping the preview id
   to the GA id everywhere it ships.
2. Remove `gemini-2.5-flash` and `gemini-2.5-pro` from all pricing /
   registry sites (FE + BE).
3. Keep saved canvases functional via a migration alias in
   `MODEL_MAP` — old `…-preview` ids resolve transparently to GA.
4. Confirm thinking config is correct for every Gemini 3.x variant
   currently in use; document any constraints.

## Non-goals

- Adding new model families (Live, TTS, Robotics, Computer Use).
- Refactoring `LLMNode.tsx` to derive models from the registry
  (deferred to the C3 migration).
- Updating image generation models — already done in the image quality
  push.
- Updating the embedding model — out of LLM chat scope.

## Thinking config — empirical state

Verified against Gemini API docs (May 2026) and the smoke scripts in
`scripts/`:

| Model | Default level | Explicit `high` accepted? | Notes |
|---|---|---|---|
| `gemini-3.1-pro-preview` (text) | `high` (dynamic) | Yes | redundant but harmless |
| `gemini-3-flash-preview` (text) | `high` (dynamic) | Yes | redundant but harmless |
| `gemini-3.1-flash-lite` (text) | `minimal` | Yes | `:thinking` suffix correctly forces high |
| `gemini-3.1-flash-image-preview` | n/a | Conditionally — degrades at imageSize ≥ 2K | already gated in code |
| `gemini-3-pro-image-preview` | built-in auto | **Rejects** explicit | already gated in code |

No additional thinking fix is required for LLM chat. The
`thinking_budget` branch in `_chat_gemini` (Python) existed only for
the 2.5 family and becomes dead code after the deletions below.

## File changes (9)

### Frontend

1. **`frontend/src/nodes/llm/LLMNode.tsx`** — `LLM_MODELS`
   - Replace `gemini-3.1-flash-lite-preview` and its `:thinking`
     variant with `gemini-3.1-flash-lite` (GA id).
   - Update both tooltips to mention "default minimal thinking"
     and that the `:thinking` variant forces `high`.

2. **`frontend/src/providers/geminiProvider.ts`** — `MODEL_MAP`
   - Map display name `'Gemini 3.1 Flash-Lite'` to the GA id
     `gemini-3.1-flash-lite`.
   - Add **migration aliases** for the preview ids so canvases saved
     before this change keep working:
     - `'gemini-3.1-flash-lite-preview' → 'gemini-3.1-flash-lite'`
     - `'gemini-3.1-flash-lite-preview:thinking' → 'gemini-3.1-flash-lite:thinking'`

3. **`frontend/src/utils/costEstimate.ts`** — `MODEL_PRICING`
   - Add `'gemini-3.1-flash-lite': [0.25, 1.50]`.
   - Keep `'gemini-3.1-flash-lite-preview': [0.25, 1.50]` as a
     transition alias (so legacy canvases still produce cost
     estimates while their saved id is still the preview one).
     Comment: "transition alias — remove after 2026-06-30".
   - Remove `'gemini-2.5-flash'` and `'gemini-2.5-pro'` entries.

4. **`frontend/src/utils/costEstimate.test.ts`**
   - Remove tests referencing `gemini-2.5-*`.
   - Add a test for `gemini-3.1-flash-lite` pricing lookup.

### Backend

5. **`src/registry.py`** — `_TEXT_MODELS`
   - Add `Model(id="gemini-3.1-flash-lite", name="Gemini 3.1 Flash-Lite",
     provider="gemini", capability="text", cost_per_token=(0.25, 1.50))`.
   - Remove the `gemini-3.1-flash-lite-preview` entry.
   - Remove the `gemini-2.5-flash` and `gemini-2.5-pro` entries.

6. **`src/shared.py`** — `MODELS` and `MODEL_PRICING`
   - In `MODELS`: change `"Gemini 3.1 Flash-Lite"` value from
     `"gemini-3.1-flash-lite-preview"` to `"gemini-3.1-flash-lite"`.
   - In `MODEL_PRICING`: add `"gemini-3.1-flash-lite": (0.25, 1.50)`,
     keep `"gemini-3.1-flash-lite-preview": (0.25, 1.50)` as transition
     alias, remove `"gemini-2.5-flash"` and `"gemini-2.5-pro"`.

7. **`src/routers/llm.py`** — `_chat_gemini`
   - Remove the `else` branch that builds `thinking_config` with
     `thinking_budget=-1`. After the 2.5 deletions, no model passed to
     this function is non-gen3.
   - Keep the `is_gemini3` check as a safety guard but make the absence
     of gen3 a no-op (skip thinking config rather than fall through to
     the `thinking_budget` path).

8. **`config/settings.py`** — `gemini_flash_model`
   - Default value `"gemini-3.1-flash-lite-preview"` →
     `"gemini-3.1-flash-lite"`. Single-line change. Protects fresh
     installations after 2026-05-25.

9. **`tests/test_registry.py`**
   - Update tests that enumerate text models to expect
     `gemini-3.1-flash-lite` (GA) and to assert absence of
     `gemini-2.5-flash` / `gemini-2.5-pro` / the preview id.
   - Confirm the registry-vs-shared drift test still passes.

## Migration alias rationale

A user with a saved canvas selecting "Gemini 3.1 Flash-Lite" stores the
model id (`gemini-3.1-flash-lite-preview`) in node data. After this
change:

- **UI dropdown**: only the GA id appears, so new selections always
  store the GA id.
- **Existing canvases**: load with the preview id stored. The provider's
  `resolveModel()` runs the migration map and returns the GA id before
  any HTTP call. The shutdown on 2026-05-25 is invisible to the user.
- **Cost estimate**: `estimateCost(selectedModel, …)` is called with the
  preview id from the node data; the transition alias in
  `MODEL_PRICING` keeps it from falling through to the zero-cost
  default. Both FE and BE pricing tables carry the alias.

The transition aliases (pricing + map) are scheduled for removal in a
follow-up commit after 2026-06-30 — enough time for any active canvases
to have been opened at least once and re-saved with the GA id.

## Test plan

- `cd frontend && npx vitest run` — expect 350/350 plus any new tests in
  `costEstimate.test.ts`.
- `python -m pytest` — expect 98/98 with updated `test_registry.py`.
- `cd frontend && npx tsc --noEmit` — clean.
- Manual: load the LLM node, confirm the dropdown shows the GA name,
  switch to `:thinking`, run a short prompt, confirm the request goes
  through.

## Open risks

- **Pricing drift**: if Google changes Flash-Lite GA pricing after the
  initial $0.25/$1.50 rate, both `costEstimate.ts` and `shared.py` need
  re-syncing. The drift test in `tests/test_registry.py` will catch
  this.
- **Transition alias lifecycle**: the cleanup is in this design but
  not yet scheduled as a ticket. Add reminder to the project memory
  after merge.
