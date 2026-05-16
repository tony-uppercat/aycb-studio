---
name: aycb-cli-generation
description: >
  Use when creating or modifying Python CLI scripts under `scripts/` that call
  generative AI APIs (Gemini image/video sync, Gemini Batch API async, smoke
  tests). Covers reference image prep, REST-vs-SDK choice, retry/skip, log
  files, cost tracking via MODEL_PRICING, and Batch API crash recovery.
---

# AYCB CLI Generation Scripts

## Overview
Conventions for one-shot Python scripts in `scripts/` that generate images via Gemini and similar providers. Codifies real failures from this codebase: HTTP 503 on giant refs, SDK image-size bug, thinking-config gotchas, and the Batch API 50%-discount async flow.

## When to use / NOT
- USE: new/modified script in `scripts/` that hits a generative API, batch loops, async Batch API jobs, smoke tests
- NOT: backend endpoints (`src/routers/*.py`), frontend nodes, interactive REPL tools

## Boilerplate

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import settings           # API keys, paths
from src.shared import MODEL_PRICING            # cost rates
```

API key: `settings.gemini_api_key`. Never hardcode, never read from prompt.

## Reference image prep — ALWAYS for image gen

Phone photos are 8K+ / 30-50MB. Pro Image @2K returns HTTP 503 "Deadline expired" with refs that large. Downscale + JPEG before sending:

```python
def prepare_ref(path: Path) -> tuple[bytes, str, tuple[int, int]]:
    img = PILImage.open(path).convert("RGB")
    w, h = img.size
    if max(w, h) > 1536:                       # MAX_REF_LONG_EDGE
        scale = 1536 / max(w, h)
        img = img.resize((round(w*scale), round(h*scale)), PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue(), "image/jpeg", img.size
```

Canonical impl: `scripts/batch_brush_refsheet.py:prepare_ref`.

## REST direct vs SDK

| Scenario | Use |
|---|---|
| Image gen with `imageSize` / `aspectRatio` | REST direct (`urllib`) — SDK historically drops `imageConfig.imageSize` |
| Batch API operations (`batches.*`, `files.*`) | SDK (`google.genai`) |
| LLM completions, embeddings | SDK |

REST direct pattern: see any `scripts/smoke_test_flash_*.py`.

## Model gotchas (Gemini image)

- **Pro Image (`gemini-3-pro-image-preview`)** — OMIT `thinkingConfig`. Auto-thinks; explicit values → HTTP 503.
- **Flash Image (`gemini-3.1-flash-image-preview`)** — at `imageSize` ≥2K, OMIT `thinkingConfig`. Explicit `thinking_level=high` degrades to 1K + `IMAGE_RECITATION` blocks. At 1K only, high thinking is OK.
- **Modalities** — sync REST works with `["IMAGE"]`. Batch JSONL: doc examples use `["TEXT", "IMAGE"]` — match doc exactly.

## Retry transient errors

```python
RETRY_HTTP_CODES = {429, 500, 502, 503, 504}
RETRY_BACKOFF_S  = (5, 15)                     # max 3 attempts
```

## Log file (every batch script)

Mirror stdout to `OUTPUT_DIR/batch_YYYYMMDD_HHMMSS.log` via a `tee_stdout` context manager. Always `encoding="utf-8", newline="\n"` (Windows + LF — see [[feedback_lf_not_crlf]]). Header line `=== Batch run started <ts> ===` with config, footer with total duration. Canonical impl: `scripts/batch_brush_refsheet.py:tee_stdout`.

## Cost table

```python
def cost_for_response(model_id, resp, discount=1.0):
    um = resp.get("usageMetadata") or {}
    in_tok  = int(um.get("promptTokenCount", 0))
    out_tok = int(um.get("candidatesTokenCount", 0))
    rates   = MODEL_PRICING.get(model_id, (0.0, 0.0))
    cost    = ((in_tok/1e6)*rates[0] + (out_tok/1e6)*rates[1]) * discount
    return in_tok, out_tok, round(cost, 6)
```

For **Batch API**, pass `discount=0.5` (50% off). Print a per-file table + TOTAL row at end of run, with effective rates in the header.

## Skip-if-exists guard

```python
out_path = OUTPUT_DIR / f"{src.stem}.png"
if out_path.exists():
    print(f"  SKIP — output already exists ({out_path.stat().st_size // 1024} KB)")
    skipped += 1
    continue
```

Prevents accidental re-billing on re-runs. To force regen: delete the file or move it elsewhere first.

## Gemini Batch API (async, 50% off)

For non-urgent batches (24h SLA, 48h expiry). Doc recommends **JSONL file upload** for image generation, not inline (avoids 20MB cap).

```python
client = genai.Client(api_key=settings.gemini_api_key)

# 1. Build JSONL: one line per input
{"key": "<stem>", "request": {
    "contents": [{"parts": [{"inlineData": {...}}, {"text": PROMPT}]}],
    "generation_config": {                     # snake_case at this level
        "responseModalities": ["TEXT", "IMAGE"],
        "imageConfig": {                       # camelCase nested
            "imageSize": "2K", "aspectRatio": "16:9"
        }
    }
}}

# 2. Upload + create + persist + poll
uploaded = client.files.upload(file=jsonl_path,
    config=types.UploadFileConfig(mime_type="jsonl", display_name=...))
job = client.batches.create(model=MODEL_ID, src=uploaded.name,
    config={"display_name": ...})
# PERSIST job.name TO DISK IMMEDIATELY (see below)
while job.state.name not in COMPLETED_STATES:  # SUCCEEDED|FAILED|CANCELLED|EXPIRED
    time.sleep(10)
    job = client.batches.get(name=job.name)

# 3. Download + parse
content = client.files.download(file=job.dest.file_name).decode("utf-8")
for line in content.splitlines():
    parsed = json.loads(line)
    key = parsed["key"]              # matches input stem → output filename
    resp = parsed["response"]        # full GenerateContentResponse
```

### Crash recovery — MANDATORY

Submit is NOT idempotent. If the script crashes mid-poll, the job continues server-side and you've paid for it. Persist immediately:

```python
JOB_STATE_FILE = OUTPUT_DIR / ".batch_job.json"

# After create():
JOB_STATE_FILE.write_text(json.dumps({
    "job_name": job.name, "submitted_at": datetime.now().isoformat(),
}), encoding="utf-8", newline="\n")

# On startup, BEFORE submitting:
if JOB_STATE_FILE.exists():
    job_name = json.loads(JOB_STATE_FILE.read_text())["job_name"]
    # → resume polling, do NOT resubmit

# After successful download:
JOB_STATE_FILE.unlink()
```

Canonical impl: `scripts/batch_brush_refsheet_async.py`.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| 8K+ refs to Pro Image 2K | HTTP 503 every call | Downscale to 1536px JPEG q=92 |
| `thinkingConfig` on Pro Image | HTTP 503 | Omit — Pro auto-thinks |
| `thinking_level=high` + Flash ≥2K | Degrades to 1K, RECITATION blocks | Omit at ≥2K |
| No retry on 5xx/429 | Sporadic failures | 5s+15s backoff, 3 attempts |
| No skip-if-exists | Re-bill on re-run | Check `out_path.exists()` |
| No `.batch_job.json` persist | Crash = paid for nothing | Write state immediately after `create()` |
| `write_text()` no `newline="\n"` on Windows | CRLF in JSONL/logs trips parsers | Always pass `newline="\n"` |
| Sync API for 100+ images @ 2K | 2x cost vs batch, may hit deadline | Use Batch API |

## Reference files

- `scripts/batch_brush_refsheet.py` — sync Flash 1K (retry, log, skip, cost table)
- `scripts/batch_brush_refsheet_async.py` — async Pro 2K via Batch API (JSONL, polling, state file)
- `scripts/smoke_test_flash_*.py` — REST direct urllib pattern
- `src/shared.py` — `MODEL_PRICING`, `_estimate_cost`
- `src/gemini.py` — SDK-based image gen (backend codepath)

## Related memory

[[feedback_downscale_large_refs]] · [[feedback_gemini_sdk_imagesize_bug]] · [[feedback_pro_image_auto_thinking]] · [[feedback_gemini_thinking_imagesize]] · [[feedback_lf_not_crlf]] · [[feedback_verify_provider_pricing]]
