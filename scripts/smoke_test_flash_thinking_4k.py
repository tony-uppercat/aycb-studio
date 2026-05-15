"""Empirical smoke test: does `thinkingConfig HIGH` cause Flash 4K to degrade?

Tests gemini-3.1-flash-image-preview with `generationConfig.imageConfig.imageSize`
across three variants — all using the SAME REST shape, same prompt, same AR.

  A) imageSize=4K  +  thinkingConfig HIGH      ← current production state
  B) imageSize=4K  +  (no thinkingConfig)      ← Antonio's confirmed-working
  C) imageSize=2K  +  thinkingConfig HIGH      ← control: does thinking work at 2K?

Decision matrix on actual W x H of returned images:

    A=4K dims, B=4K dims, C=2K dims  → thinking innocent, look elsewhere
    A=1K dims, B=4K dims, C=2K dims  → thinking + 4K is the bug (specific combo)
    A=1K dims, B=4K dims, C=1K dims  → thinking + any-non-1K silently degrades
    A=1K dims, B=1K dims              → not a thinking issue, shape problem

Run:
    python scripts/smoke_test_flash_thinking_4k.py

Cost: ~$0.37 max (Flash: $0.151 @ 4K, $0.151 @ 4K, $0.101 @ 2K).
Less if any variant degrades to a smaller bucket.
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

# (label, image_size, include_thinking)
VARIANTS = [
    ("A: 4K + thinking HIGH", "4K", True),
    ("B: 4K no thinking    ", "4K", False),
    ("C: 2K + thinking HIGH", "2K", True),
]


def call(image_size: str, include_thinking: bool) -> dict:
    """Make one REST request using imageConfig shape, optionally with thinkingConfig."""
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {
                "imageSize": image_size,
                "aspectRatio": ASPECT,
            },
        },
    }
    if include_thinking:
        body["generationConfig"]["thinkingConfig"] = {
            "includeThoughts": True,
            "thinkingLevel": "HIGH",
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
    """Return (width_height_or_None, candidatesTokenCount, totalTokenCount)."""
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
    print(f"AR:       {ASPECT}")
    print(f"Shape:    generationConfig.imageConfig.{{imageSize,aspectRatio}}")
    print()
    print(f"{'variant':<22} | {'actual W x H':>14} | {'cand_tok':>8} | {'total_tok':>9}")
    print("-" * 64)

    for label, size, thinking in VARIANTS:
        resp = call(size, thinking)
        dims, cand_tok, total_tok = extract(resp)
        if dims is None and "_error" in resp:
            print(f"{label:<22} | ERROR: {resp['_error']}")
            if "_body" in resp:
                print(f"{'':22} | body: {resp['_body']}")
        else:
            dims_str = f"{dims[0]}x{dims[1]}" if dims else "no image"
            print(f"{label:<22} | {dims_str:>14} | {cand_tok:>8} | {total_tok:>9}")

    print()
    print("Reference dims (16:9):")
    print("  1K bucket: ~1376 x 768")
    print("  2K bucket: ~1936 x 1088 (or 2048 x 1152)")
    print("  4K bucket: ~3840 x 2160 (or larger)")
    print()
    print("Reference tokens (Google docs):")
    print("  1K -> ~1120 candidates tokens")
    print("  4K -> ~2000 candidates tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
