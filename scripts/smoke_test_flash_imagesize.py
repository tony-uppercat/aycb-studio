"""Empirical smoke test: which payload shape does Gemini 3.1 Flash actually honor?

The Google docs reference TWO field paths for imageSize:
  A) generationConfig.imageConfig.{imageSize,aspectRatio}    (model-page style)
  B) generationConfig.responseFormat.image.{imageSize,aspectRatio}  (image-gen guide style)

This test calls the direct REST API with both shapes at 1K, 2K, 4K and
reports actual pixel dimensions plus candidatesTokenCount. The winning shape
is whichever produces dimensions that scale with the requested imageSize.

Run:
    python scripts/smoke_test_flash_imagesize.py

Cost: ~$0.64 (6 generations × Flash 1K-4K rates × 2 shapes). Uses
settings.gemini_api_key loaded from .env.
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


def call(image_size: str, shape: str) -> dict:
    """Make one REST request with the requested payload shape."""
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
        },
    }
    if shape == "imageConfig":
        body["generationConfig"]["imageConfig"] = {
            "imageSize": image_size,
            "aspectRatio": "1:1",
        }
    elif shape == "responseFormat":
        body["generationConfig"]["responseFormat"] = {
            "image": {
                "imageSize": image_size,
                "aspectRatio": "1:1",
            }
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

    print(f"Model: {MODEL}")
    print(f"Endpoint: {URL}")
    print(f"Prompt: {PROMPT!r}")
    print(f"AR: 1:1 (square — easier to verify scaling)")
    print()

    for shape in ("imageConfig", "responseFormat"):
        print(f"=== Shape: generationConfig.{shape}{'.image' if shape == 'responseFormat' else ''} ===")
        print(f"{'imageSize':>10} | {'actual W×H':>14} | {'cand_tok':>8} | {'total_tok':>9}")
        print("-" * 52)
        for size in ("1K", "2K", "4K"):
            resp = call(size, shape)
            dims, cand_tok, total_tok = extract(resp)
            if dims is None and "_error" in resp:
                print(f"{size:>10} | ERROR: {resp['_error']}")
                if "_body" in resp:
                    print(f"           | body: {resp['_body']}")
            else:
                dims_str = f"{dims[0]}×{dims[1]}" if dims else "no image"
                print(f"{size:>10} | {dims_str:>14} | {cand_tok:>8} | {total_tok:>9}")
        print()

    print("Reference (Google pricing docs):")
    print("  1K → ~1120 candidates tokens, ~$0.067/img")
    print("  2K → intermediate token count, ~$0.101/img")
    print("  4K → ~2000 candidates tokens, ~$0.151/img")
    print()
    print("Interpretation:")
    print("  - If actual W×H stays the same for 1K/2K/4K within a shape → that shape is ignored.")
    print("  - If W×H scales with imageSize → that shape is honored. Use that one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
