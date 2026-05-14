# Image Node — Max Quality Push (Gemini 3 Pro Image / Nano Banana 2)

**Date:** 2026-05-14
**Status:** Design — awaiting plan
**Owner:** Antonio

## Goal

Close the gap between what Google's Gemini image API exposes today and
what the AYCB Generate Image node actually passes through. Specifically:

1. Activate `thinkingConfig.thinking_level="HIGH"` on every Gemini call.
2. Raise the reference image cap from 8 to 14 (Pro: 6 obj + 5 char; Flash:
   10 obj + 4 char per Google docs).
3. Surface the `0.5K` (`512`) bucket for Nano Banana 2 (Flash) as a cheap
   preview tier.
4. Replace the PIL roundtrip in `_save_to_bridge` with byte-perfect tEXt
   chunk injection plus a sidecar `.meta.json`, preserving the original
   PNG bytes (and any ICC / eXIf / Google-emitted metadata) intact.

## Non-Goals

- Multi-turn chat session for Edit mode (deferred — replay-ref EDIT stays
  as today).
- 16-bit color depth output (no cloud provider in 2026 emits 16-bit
  PNGs; this is an upstream limit, not an AYCB one).
- Reference labeling in the prompt (`"[Ref 1: character] ..."`) — kept on
  the backlog; not in this scope.
- Touching non-Gemini providers (OpenAI, Recraft, Flux). They are out of
  scope.
- New batch API / Flex / Priority inference tier integration.

## Background

The Generate Image node already exposes `aspectRatio`, `imageSize`
(1K/2K/4K, plus FHD for OpenAI), `useGrounding` (with explicit
`webSearch + imageSearch` searchTypes), `editMode` (replay-ref), batch
×1/×2/×4, and up to 8 reference image pins. The current state was
verified by reading:

- `frontend/src/providers/geminiProvider.ts:76-142`
- `frontend/src/nodes/generate-image/useGenerateImage.ts:117` (`MAX_REFS = 8`)
- `frontend/src/nodes/generate-image/useGenerateImage.ts:109-115` (`RESOLUTIONS`)
- `src/gemini.py:292-359` (`generate_image`)
- `src/shared.py:264-311` (`_save_to_bridge`)
- `src/routers/generate.py:28-89` (`/api/generate/image`)
- Google docs: `ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview`
  and `ai.google.dev/gemini-api/docs/image-generation`

Gap analysis:

| Knob | AYCB today | Upstream available | Gap |
|---|---|---|---|
| `imageSize` 1K/2K/4K | ✓ exposed | ✓ | none |
| `aspectRatio` 10 / 14 values | ✓ exposed | ✓ | none |
| `googleSearch` + `searchTypes` | ✓ wired | ✓ | none |
| Reference images | cap 8 (FE+BE) | 14 (Pro 6+5, Flash 10+4) | **6 ref slots** |
| `thinkingConfig.thinking_level` HIGH | ✗ not passed | ✓ supported on Pro Image | **quality lever** |
| `imageSize="512"` (0.5K Flash) | ✗ not exposed | ✓ Flash-only | **cheap preview** |
| `_save_to_bridge` byte-perfect | ✗ PIL roundtrip | n/a (engineering) | **metadata loss** |

The `_save_to_bridge` PIL roundtrip (`pil_img.save(format="PNG", ...)`)
is pixel-lossless but recodes the PNG bitstream from scratch. Any ICC
profile, eXIf chunk, or Google-emitted tEXt metadata is dropped. CPU
cost: ~1-2 s per 4K image, paid on every save.

## Design

### UI

A new toggle `THK` joins `GND` and `EDIT` on the ar/res row. It is
visible only when `modelInfo.provider === 'gemini'` (same pattern as
`GND`). Default state for new nodes is **active (thinking ON)**.

The `RESOLUTIONS` dropdown gains a `0.5K` option that is filtered out
when the selected model is not `gemini-3.1-flash-image-preview` (mirror
of the existing FHD-on-OpenAI filter at `GenerateImageNode.tsx:75`). A
`useEffect` resets `resolution` to `''` (Auto) if the user switches off
Flash while `0.5K` was selected.

Reference pins continue to grow dynamically (`useGenerateImage.ts:127-131`)
but the cap constant rises from 8 to 14. When the user has 9+ refs
connected, a tooltip on the node header explains the Pro vs Flash
allocation ("Pro: 6 obj + 5 char | Flash: 10 obj + 4 char — extras
ignored by API").

### Frontend — providers

`frontend/src/providers/index.ts`:

```ts
interface ImageGenerationOptions {
  aspectRatio?: string
  imageSize?: string
  useGrounding?: boolean
  thinking?: boolean   // NEW — undefined or true ⇒ thinking HIGH
}
```

`frontend/src/providers/geminiProvider.ts`:

- Add to the `config` object construction (after the existing `imageConfig`
  block, before grounding):

```ts
if (options?.thinking !== false) {
  config.thinkingConfig = {
    includeThoughts: true,
    thinkingLevel: 'HIGH',
  }
}
```

- Map `imageSize === '0.5K'` to `'512'` before assigning to
  `imageConfig.imageSize` (Gemini SDK expects the literal `'512'`).

### Frontend — node

`frontend/src/nodes/generate-image/useGenerateImage.ts`:

- `MAX_REFS = 14`
- `RESOLUTIONS` gains `{ value: '0.5K', label: '0.5K' }` after `1K`
- New state via `useStateRef`:
  ```ts
  const [thinking, setThinking, thinkingRef] = useStateRef(
    typeof (data as Record<string, unknown>).thinking === 'boolean'
      ? (data as Record<string, unknown>).thinking as boolean
      : true,
  )
  ```
- `imageOptions` (line 458-462) gains `...(thinkingRef.current === false ? { thinking: false } : {})`
- New `useEffect` resets `resolution` to `''` when `0.5K` is selected
  and the model is not Flash (parallel to the existing FHD effect at
  line 310-315)
- Export `thinking` and `setThinking` in the hook return object

`frontend/src/nodes/generate-image/GenerateImageNode.tsx`:

- New `THK` button rendered next to `GND` (visible iff
  `h.modelInfo.provider === 'gemini'`). Active class when
  `h.thinking === true`.
- `RESOLUTIONS` filter line 74-77 gains `.filter(r => r.value !== '0.5K' || h.modelInfo.id === 'gemini-3.1-flash-image-preview')`

`frontend/src/utils/costEstimate.ts`:

- Add `'0.5K': 0.045` to the Flash per-bucket map
- Thinking surcharge: estimate is rough (Google bills thinking tokens
  per output token at the same rate as candidate tokens). Apply a flat
  `* 1.3` multiplier to the cost estimate when `thinking === true`. The
  cost panel already uses the real `cost_usd` from `usage_metadata`
  after the call returns, so this only affects the pre-flight estimate.

### Backend

`src/gemini.py` — `generate_image()`:

```python
def generate_image(
    prompt: str,
    reference_images: list[Image.Image] | None = None,
    model_id: str | None = None,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    api_key: str | None = None,
    use_grounding: bool = False,
    thinking: bool = True,   # NEW
) -> Image.Image | None:
    ...
    if thinking:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            include_thoughts=True, thinking_level="HIGH",
        )
    ...
```

Map `image_size == "0.5K"` to `"512"` before constructing `ImageConfig`.

Lift `reference_images[:8]` to `reference_images[:14]` at the contents
build site.

`src/routers/generate.py` — `/api/generate/image`:

- New form field: `thinking: str = Form("true")`. Convert with the same
  lower-case truthy check used for `use_grounding`.
- `ref_images[:8]` → `ref_images[:14]`.
- Pass `thinking=thinking_bool` into `generate_image(...)`.

`src/shared.py` — byte-perfect save:

New helper:

```python
def _inject_png_text_chunks(png_bytes: bytes, meta: dict[str, str]) -> bytes:
    """Inject tEXt chunks before the IEND chunk without re-encoding pixels.

    PNG is structurally `signature(8) + chunks + IEND`. Each chunk is
    `length(4) + type(4) + data + crc(4)`. tEXt chunks carry
    `keyword(1-79 bytes) + 0x00 + Latin-1 text`. We locate IEND, splice
    new tEXt chunks before it, and return the resulting bytes. CRC is
    `zlib.crc32(type_bytes + data_bytes)`.

    Falls back to returning `png_bytes` unchanged on parse failure so
    that a malformed PNG never breaks the save path.
    """
```

~30 lines, pure stdlib (`struct`, `zlib`), no PIL dependency. Lives
next to `_save_to_bridge`.

`_save_to_bridge` refactor:

- When `img_bytes is not None`:
  1. `safe_meta = {k: str(v) for k, v in meta.items() if v is not None}`
  2. `enriched = _inject_png_text_chunks(img_bytes, safe_meta)`
  3. `img_path.write_bytes(enriched)`
  4. `(target_dir / f"{stem}.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8", newline="\n")`
- When `pil_image is not None`: legacy path stays as today (only hit by
  the backend `/api/generate/image` fallback). PIL roundtrip plus
  sidecar JSON (we still write the sidecar in both branches so
  downstream readers can rely on a single reader function).

`_find_png_meta` and `_find_json_meta` stay as-is. The existing
`get_bridge_meta` route (`src/routers/bridge.py:273-292`) already tries
PNG first then falls back to the JSON sidecar — that two-step lookup
keeps working unchanged because `_find_json_meta` globs
`{stem}.meta.json` recursively without caring whether the stem belongs
to an image or a video. New PNGs get both tEXt chunks (injected) and a
sidecar JSON; older PNGs still resolve via tEXt only. No reader
changes needed.

## Files Changed

| File | Change | Est. lines |
|---|---|---|
| `frontend/src/providers/index.ts` | `ImageGenerationOptions.thinking` field | +1 |
| `frontend/src/providers/geminiProvider.ts` | `thinkingConfig` + `0.5K → 512` mapping | +10 |
| `frontend/src/nodes/generate-image/useGenerateImage.ts` | `MAX_REFS=14`, `thinking` state, `0.5K` in `RESOLUTIONS`, reset effect | +18 |
| `frontend/src/nodes/generate-image/GenerateImageNode.tsx` | THK button, `0.5K` filter | +12 |
| `frontend/src/utils/costEstimate.ts` | `0.5K` cost, thinking ×1.3 multiplier | +5 |
| `frontend/src/nodes/generate-image/generate-image.test.ts` | new tests | +30 |
| `src/routers/generate.py` | `thinking` form param, `ref_images[:14]` | +6 |
| `src/gemini.py` | `thinking` param, `ThinkingConfig`, `512` mapping, ref cap 14 | +14 |
| `src/shared.py` | `_inject_png_text_chunks` helper, `_save_to_bridge` refactor (img_bytes branch writes raw + sidecar, pil_image branch keeps legacy + sidecar) | +55 |
| `tests/test_shared.py` | byte-perfect roundtrip + tEXt injection tests | +40 |

**Total: ~191 lines across 10 files. Single PR on `dev`.**

## Test Plan

Backend:

- `tests/test_shared.py::test_inject_png_text_preserves_idat` — load a
  fixture PNG, inject metadata, assert that the sha256 of the IDAT
  chunks (everything between IHDR and IEND that is not a tEXt chunk) is
  identical between input and output.
- `tests/test_shared.py::test_inject_png_text_round_trip_meta` — inject
  meta, parse the result with `PILImage.open(...).info`, assert each
  key-value comes back unchanged.
- `tests/test_shared.py::test_inject_png_text_malformed_falls_back` —
  pass `b"not a png"`, assert the function returns the input unchanged
  and logs (no exception bubbles up).
- `tests/test_shared.py::test_save_to_bridge_writes_sidecar` — assert
  both the `.png` and `.meta.json` exist after a save, and the JSON
  matches the meta passed in.
- `tests/test_routers/test_generate.py::test_thinking_default_true` —
  POST `/api/generate/image` with no `thinking` field, assert the
  mocked `generate_image` was called with `thinking=True`.

Frontend:

- `generate-image.test.ts` — render the node, assert the THK button is
  present when provider is gemini, absent otherwise.
- `generate-image.test.ts` — toggle THK, assert the next `runSingle`
  call's `imageOptions` includes `thinking: false`.
- `generate-image.test.ts` — assert `RESOLUTIONS` filters `0.5K` for
  non-Flash models.
- `useGenerateImage.test.ts` — verify the reset effect fires when the
  model switches off Flash with `0.5K` selected.

Manual verification (visual):

- Run 1 × 4K Pro Image generation with THK ON, capture output.
- Run 1 × 4K Pro Image generation with same prompt and THK OFF, capture.
- Open both in Photoshop / preview, compare detail, text rendering,
  small-object fidelity. Antonio confirms uplift is worth the cost
  delta.

## Risks & Mitigations

- **Billing surprise.** Default thinking ON multiplies token usage on
  every Gemini image generation. _Mitigation:_ toggle is visible and
  one click away. The `usage_metadata` cost arrives back from Google
  and shows on the node — no estimate drift.

- **Flash + thinking economics.** Flash exists as the cheap-and-fast
  tier; thinking ON dulls that. _Mitigation:_ user-chosen scope. The
  toggle is per-node, so Antonio can flip individual Flash nodes off
  when he just needs a quick preview.

- **14 refs misuse.** Pro silently ignores refs past 11 (6 obj + 5
  char). _Mitigation:_ tooltip explains the cap; existing parallel-pin
  growth is unchanged so the UI does not crowd unless the user
  intentionally connects many pins.

- **`_inject_png_text_chunks` on malformed input.** _Mitigation:_
  fallback to PIL roundtrip on `struct.unpack` / `zlib.crc32` error.
  Test `test_inject_png_text_malformed_falls_back` covers the path.

- **`_find_png_meta` returning stale data after the byte-perfect
  switch.** Files written before this change still have tEXt chunks
  (the legacy PIL save wrote them). After the change, new files also
  have tEXt (we inject them) **and** a sidecar JSON. Both readers find
  the meta. No migration needed.

## Rollout

Single PR on `dev`. Tests green (350+ frontend, 98+ backend) before
opening PR. Manual visual check on at least one 4K Pro + one Flash
generation before marking ready for review.

No feature flag — the THK toggle is the runtime control. No data
migration — PNG sidecars are additive.
