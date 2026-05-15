"""Empirical H3 test: does `thinkingLevel` capitalization matter on Flash?

Per docs/nano_banana_api_reference.md (riga 188-216), the canonical value
for thinking_level is lowercase: "minimal" / "high". Our production code
(geminiProvider.ts, src/gemini.py) uses "HIGH" (all caps).

The previous smoke tests showed Flash + thinkingLevel="HIGH" + imageSize >= 2K
degrades silently to 1K or returns IMAGE_RECITATION. Hypothesis: the value
"HIGH" is non-canonical and either gets misinterpreted or triggers a fallback
path that breaks at higher resolutions.

This test sends `thinkingLevel="high"` (lowercase canonical) at 4K, 2K, 1K.

Decision matrix on actual W x H:

  4K=4K, 2K=2K, 1K=1K  -> H3 confirmed. Fix is "HIGH" -> "high"; revert UI changes.
  4K=1K, 2K=2K, 1K=1K  -> 4K still broken with canonical case. Different cause.
  4K=1K, 2K=1K, 1K=1K  -> thinking + (anything > 1K) still broken regardless of case.
  any IMAGE_RECITATION -> safety filter triggered, retry once before drawing conclusion.

Run:
    python scripts/smoke_test_flash_thinking_case.py

Cost: ~$0.32 max (Flash: 0.151 + 0.101 + 0.067).
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
MODEL = "gemini-3.1-flash-image-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

PROMPT = "A single red circle on a plain white background, simple flat illustration"
ASPECT = "16:9"

# (label, image_size, thinking_level_value)
VARIANTS = [
    ("4K + thinking 'high'  ", "4K", "high"),
    ("2K + thinking 'high'  ", "2K", "high"),
    ("1K + thinking 'high'  ", "1K", "high"),
]


def call(image_size: str, thinking_level: str) -> dict:
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {
                "imageSize": image_size,
                "aspectRatio": ASPECT,
            },
            "thinkingConfig": {
                "includeThoughts": True,
                "thinkingLevel": thinking_level,
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
        return {"_error": f"HTTP {exc.code}", "_body": exc.read().decode("utf-8", "replace")[:500]}
    except Exception as exc:
        return {"_error": str(exc)[:500]}


def extract(resp: dict) -> tuple[tuple[int, int] | None, int, int, str]:
    if "_error" in resp:
        return None, -1, -1, resp.get("_error", "")
    um = resp.get("usageMetadata", {})
    cand = resp.get("candidates") or []
    finish = (cand[0].get("finishReason") or "") if cand else ""
    if not cand:
        return None, um.get("candidatesTokenCount", 0), um.get("totalTokenCount", 0), finish
    parts = cand[0].get("content", {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            img_bytes = base64.b64decode(inline["data"])
            img = PILImage.open(io.BytesIO(img_bytes))
            return (img.width, img.height), um.get("candidatesTokenCount", 0), um.get("totalTokenCount", 0), finish
    return None, um.get("candidatesTokenCount", 0), um.get("totalTokenCount", 0), finish


def main() -> int:
    if not API_KEY:
        print("ERROR: settings.gemini_api_key is empty (check .env AYCB_GEMINI_API_KEY)")
        return 2

    print(f"Model:        {MODEL}")
    print(f"Prompt:       {PROMPT!r}")
    print(f"AR:           {ASPECT}")
    print(f"thinkingLevel value being tested: 'high' (canonical lowercase per doc)")
    print()
    print(f"{'variant':<24} | {'actual W x H':>14} | {'cand_tok':>8} | {'total_tok':>9} | finish")
    print("-" * 84)

    for label, size, level in VARIANTS:
        resp = call(size, level)
        dims, cand_tok, total_tok, finish = extract(resp)
        if dims is None and "_error" in resp:
            print(f"{label:<24} | ERROR: {resp['_error']}")
            if "_body" in resp:
                print(f"{'':24} | body: {resp['_body']}")
        elif dims is None:
            print(f"{label:<24} | {'no image':>14} | {cand_tok:>8} | {total_tok:>9} | {finish}")
        else:
            dims_str = f"{dims[0]}x{dims[1]}"
            print(f"{label:<24} | {dims_str:>14} | {cand_tok:>8} | {total_tok:>9} | {finish}")

    print()
    print("Expected for 'high' working (16:9):")
    print("  1K -> 1376 x  768")
    print("  2K -> 2752 x 1536")
    print("  4K -> 5504 x 3072")
    return 0


if __name__ == "__main__":
    sys.exit(main())
