"""Empirical smoke test: which OpenAI image models actually accept our key?

Background. registry.py and openaiProvider.ts use model id "gpt-image-2", but
the public OpenAI Image API docs (snapshot 2026-05-20) list ImageModel as
  gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini / chatgpt-image-latest /
  dall-e-2 / dall-e-3
"gpt-image-2" appears only in the `size` parameter description (as a model
that supports arbitrary WxH dimensions). The dashboard shows 0 calls to the
Images API — so either the AYCB dropdown is never picked, or every call 400s
on the model id and never reaches OpenAI's metering.

This script hits POST /images/generations with each candidate id at the
cheapest setting (1024x1024, quality=low, n=1, no refs) and reports:
  - HTTP status + error message
  - actual returned size
  - usage tokens + real cost (computed from response.usage)
  - PNG saved to reports/openai_smoke/{model}.png

Run (PowerShell):
    $env:OPENAI_API_KEY = "sk-..."
    python scripts/smoke_openai_image.py

Cost estimate: ~$0.04 total across 5 models (low quality, 1024x1024).
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image as PILImage  # noqa: E402

URL = "https://api.openai.com/v1/images/generations"
OUT_DIR = Path(__file__).resolve().parent.parent / "reports" / "_openai_smoke"

# Per-token rates assumed (USD per 1M tokens) — same shape as
# openaiProvider.ts computeCost(). Probed empirically; if rates differ per
# model, we'll learn from the printed cost figures.
RATE_TEXT_IN = 5.0
RATE_IMG_IN = 8.0
RATE_IMG_OUT = 30.0

MODELS = [
    "gpt-image-2",            # currently in registry — verify it exists
    "gpt-image-1.5",          # public enum says this is the current model
    "gpt-image-1",            # legacy
    "gpt-image-1-mini",       # cheapest
    "chatgpt-image-latest",   # auto-latest alias
]

PROMPT = "A single red circle on a plain white background, simple flat illustration"


def call(model: str, key: str) -> dict:
    body = {
        "model": model,
        "prompt": PROMPT,
        "n": 1,
        "size": "1024x1024",
        "quality": "low",
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read())
            payload["_status"] = resp.status
            return payload
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(body_text)
            msg = parsed.get("error", {}).get("message", body_text[:300])
        except Exception:
            msg = body_text[:300]
        return {"_status": exc.code, "_error": msg}
    except Exception as exc:
        return {"_status": -1, "_error": str(exc)[:300]}


def extract(resp: dict) -> tuple[tuple[int, int, bytes] | None, dict]:
    data = resp.get("data") or []
    if not data or not data[0].get("b64_json"):
        return None, resp.get("usage") or {}
    img_bytes = base64.b64decode(data[0]["b64_json"])
    img = PILImage.open(io.BytesIO(img_bytes))
    return (img.width, img.height, img_bytes), resp.get("usage") or {}


def cost_from_usage(usage: dict) -> float:
    details = usage.get("input_tokens_details") or {}
    text_in = details.get("text_tokens", usage.get("input_tokens", 0)) or 0
    img_in = details.get("image_tokens", 0) or 0
    img_out = usage.get("output_tokens", 0) or 0
    return (
        (text_in / 1e6) * RATE_TEXT_IN
        + (img_in / 1e6) * RATE_IMG_IN
        + (img_out / 1e6) * RATE_IMG_OUT
    )


def main() -> int:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        print("ERROR: set OPENAI_API_KEY env var first")
        print('  PowerShell:  $env:OPENAI_API_KEY = "sk-..."')
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Endpoint: {URL}")
    print(f"Prompt:   {PROMPT!r}")
    print(f"Body:     size=1024x1024  quality=low  n=1")
    print(f"Key tail: ...{key[-6:]}")
    print()
    header = (
        f"{'model':<24} | {'status':>6} | {'size':>11} | "
        f"{'cost':>8} | {'in/out tok':>14} | notes"
    )
    print(header)
    print("-" * len(header))
    for model in MODELS:
        resp = call(model, key)
        status = resp.get("_status", "?")
        if "_error" in resp:
            print(
                f"{model:<24} | {status:>6} | {'':>11} | {'':>8} | "
                f"{'':>14} | {resp['_error'][:60]}"
            )
            continue
        result, usage = extract(resp)
        if result is None:
            print(
                f"{model:<24} | {status:>6} | {'no img':>11} | {'':>8} | "
                f"{'':>14} | empty response"
            )
            continue
        w, h, img_bytes = result
        cost = cost_from_usage(usage)
        in_tok = usage.get("input_tokens", 0)
        out_tok = usage.get("output_tokens", 0)
        out_path = OUT_DIR / f"{model}.png"
        out_path.write_bytes(img_bytes)
        size_str = f"{w}x{h}"
        tok_str = f"{in_tok}/{out_tok}"
        print(
            f"{model:<24} | {status:>6} | {size_str:>11} | "
            f"${cost:>6.4f} | {tok_str:>14} | saved {out_path.name}"
        )
    print()
    print(f"Images saved to: {OUT_DIR}")
    print()
    print("Interpretation:")
    print("  - 200 + image  → model id exists, capture cost for registry")
    print("  - 400/404      → model not available with this key (read error msg)")
    print("  - 401          → key invalid")
    print("  - 429          → rate limit (retry)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
