"""Empirical smoke test: does Gemini 3 Pro Image (NB2) honor imageSize via REST?

Same shape as smoke_test_flash_imagesize.py but targets NB2. The user reports
that NB2 always returns ~768×1376 (1K bucket at 9:16) regardless of the
imageSize dropdown selection. This script settles whether the API ignores
imageSize for NB2, or whether something else in the AYCB pipeline is at fault.

Configuration matches geminiProvider.ts:
  - direct REST POST to generativelanguage.googleapis.com
  - generationConfig.imageConfig.{imageSize, aspectRatio}
  - NO thinkingConfig (NB2 has built-in auto-thinking; explicit kills with 503)
  - text-only prompt, no reference images

Run:
    python scripts/smoke_test_nb2_imagesize.py

Cost: ~$0.51 (1K + 2K + 4K = $0.134 + $0.134 + $0.240).
"""
from __future__ import annotations

import base64
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image as PILImage  # noqa: E402

from config.settings import settings  # noqa: E402

API_KEY = settings.gemini_api_key
MODEL = "gemini-3-pro-image-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

PROMPT = "A single red circle on a plain white background, simple flat illustration"
ASPECT_RATIO = "9:16"  # matches the user's reported AR


def call(image_size: str) -> dict:
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {
                "imageSize": image_size,
                "aspectRatio": ASPECT_RATIO,
            },
        },
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": API_KEY,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return {"_error": f"HTTP {exc.code}", "_body": exc.read().decode("utf-8", "replace")[:300]}
    except Exception as exc:
        return {"_error": str(exc)[:300]}


def extract(resp: dict) -> tuple[tuple[int, int] | None, int, int]:
    if "_error" in resp:
        return None, -1, -1
    um = resp.get("usageMetadata", {})
    cand = resp.get("candidates") or []
    if not cand:
        return None, um.get("candidatesTokenCount", 0), um.get("totalTokenCount", 0)
    parts = cand[0].get("content", {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            img_bytes = base64.b64decode(inline["data"])
            img = PILImage.open(io.BytesIO(img_bytes))
            return (img.width, img.height), um.get("candidatesTokenCount", 0), um.get("totalTokenCount", 0)
    return None, um.get("candidatesTokenCount", 0), um.get("totalTokenCount", 0)


def main() -> int:
    if not API_KEY:
        print("ERROR: settings.gemini_api_key is empty (check .env AYCB_GEMINI_API_KEY)")
        return 2

    print(f"Model:    {MODEL}")
    print(f"Endpoint: {URL}")
    print(f"Prompt:   {PROMPT!r}")
    print(f"AR:       {ASPECT_RATIO}")
    print(f"Shape:    generationConfig.imageConfig (same as geminiProvider.ts)")
    print()
    print(f"{'imageSize':>10} | {'actual W×H':>14} | {'MP':>5} | {'cand_tok':>8} | {'total_tok':>9}")
    print("-" * 62)
    for size in ("1K", "2K", "4K"):
        resp = call(size)
        dims, cand_tok, total_tok = extract(resp)
        if dims is None and "_error" in resp:
            print(f"{size:>10} | ERROR: {resp['_error']}")
            if "_body" in resp:
                print(f"           | body: {resp['_body']}")
        else:
            dims_str = f"{dims[0]}×{dims[1]}" if dims else "no image"
            mp = (dims[0] * dims[1] / 1_000_000) if dims else 0
            print(f"{size:>10} | {dims_str:>14} | {mp:>5.2f} | {cand_tok:>8} | {total_tok:>9}")
    print()
    print("Expected NB2 buckets at 9:16:")
    print("  1K (~1 MP)  → ~768×1376")
    print("  2K (~4 MP)  → ~1536×2752")
    print("  4K (~16 MP) → ~3072×5504")
    print()
    print("Interpretation:")
    print("  - W×H stays at ~768×1376 across 1K/2K/4K → API ignores imageSize for NB2.")
    print("    Frontend dropdown is misleading; need a UI fix (lock to 1K, or warn).")
    print("  - W×H scales with imageSize → API honors it. The bug is somewhere in")
    print("    the AYCB pipeline (frontend, provider, or transport). Re-investigate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
