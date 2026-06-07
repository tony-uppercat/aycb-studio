# GPT Image 2 — API Spec (AYCB Studio v2)

How AYCB calls OpenAI `gpt-image-2`. Source of truth: `frontend/src/providers/openaiProvider.ts`.

## Model

- **id:** `gpt-image-2`
- **provider:** `openai`
- **registry:** `src/registry.py` — capability `image`, aspect ratios `1:1, 3:2, 2:3, 16:9, 9:16, 21:9`.

## Auth

`Authorization: Bearer <OPENAI_API_KEY>` — sourced from Settings > API Keys (never auto-persisted from request handlers).

## Endpoints

Base: `https://api.openai.com/v1`

| Mode | Endpoint | Body |
|---|---|---|
| Text-to-image (no refs) | `POST /images/generations` | JSON |
| Edit (>=1 ref) | `POST /images/edits` | `multipart/form-data` |

Routing: in `openaiProvider.generateImage`, `refs?.length > 0` -> edits, else generations.

### JSON body (generations)

```json
{
  "model": "gpt-image-2",
  "prompt": "<string>",
  "n": 1,
  "size": "<WxH or 'auto'>",
  "quality": "<low | medium | high | auto>"
}
```

### Multipart fields (edits)

| Field | Notes |
|---|---|
| `model` | `gpt-image-2` |
| `prompt` | string |
| `n` | `1` |
| `size` | computed (see below) |
| `quality` | computed (see below) |
| `image[]` | one entry per reference. **Always use `image[]`**, even for a single ref. Passing repeated `image` fields returns `Duplicate parameter: 'image'. ... use the array syntax instead`. |

## Size computation

Function: `computeSize(aspect, resolution)`.

Hard constraints (OpenAI docs, 2026-04-21):

- Both edges multiples of 16.
- Max edge <= 3840.
- Total pixels in `[655_360, 8_294_400]`.
- Aspect ratio <= 3:1 (else fall back to `auto`).

Resolution -> target MP bucket:

| Resolution | Target MP | Notes |
|---|---|---|
| `Draft` | 1.05 | low quality knob |
| `1K` | 1.05 | |
| `FHD` | 2.1 | `16:9` -> `1920x1088`, `9:16` -> `1088x1920` (1080 isn't multiple of 16) |
| `2K` | 2.4 | flagged experimental by OpenAI |
| `4K` | 8.0 | clamped by 3840 max-edge |

Algorithm:

```
w = round(sqrt(targetPx * ratio) / 16) * 16
h = round((w / ratio) / 16) * 16
clamp max edge to 3840
bump up if below 655_360 minimum
```

## Quality mapping

`resolutionToQuality(res)`:

| Resolution | OpenAI `quality` |
|---|---|
| `Draft` | `low` |
| `1K` | `medium` |
| `FHD` / `2K` / `4K` | `high` |
| (none) | `auto` |

## Response

```json
{
  "data": [{ "b64_json": "<base64 PNG>" }],
  "usage": {
    "input_tokens": <int>,
    "output_tokens": <int>,
    "input_tokens_details": {
      "text_tokens": <int>,
      "image_tokens": <int>
    }
  }
}
```

Provider extracts `data[0].b64_json` and maps usage to `UsageInfo`.

## Pricing (real, from usage object)

Token rates (OpenAI public, 2026-04-21):

- Text input: `$5 / M tokens`
- Image input (refs): `$8 / M tokens`
- Image output: `$30 / M tokens`

```
cost_usd = (text_in / 1e6) * 5
        + (img_in  / 1e6) * 8
        + (img_out / 1e6) * 30
```

Dropdown estimates (`frontend/src/utils/costEstimate.ts`, synced 2026-05-18):

| Resolution | Estimate |
|---|---|
| Draft | $0.006 |
| 1K | $0.053 |
| FHD | $0.18 |
| 2K | $0.30 |
| 4K | $0.41 |
| fallback | $0.211 |

Per-ref add-on for estimates: `$0.008` (1 ref @ 1K -> ~1000 img tokens).

## Error handling

Both endpoints: on non-2xx, parse `err.error.message`, fall back to `OpenAI error: <status>` / `OpenAI edit error: <status>`. Errors surface to the node UI; never swallowed.

## UI gating (`GenerateImageNode.tsx`)

- `FHD` option visible only when `provider === 'openai'`.
- `Draft` option visible only when `id === 'gpt-image-2'`.
- `2K`/`4K` show tooltip: "OpenAI flags >=2K experimental for gpt-image-2 (mixed results, test your case)".

## Known caveats

- 1080 is not a multiple of 16 -> FHD returns `1920x1088`. Crop the 8px if exact 1080 needed.
- AR > 3:1 (or < 1:3) silently falls back to `size=auto`.
- 2K/4K runs occasionally token-spike: actual cost can land $0.21-$0.30 even at 2K.
- Pre 2026-05-09 bug: 4K was billed high but generated ~1MP — fixed by per-bucket MP targets.
