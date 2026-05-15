"""Empirical re-test: is `2K + thinkingConfig HIGH` consistently broken on Flash?

The previous smoke test (smoke_test_flash_thinking_4k.py) showed:
  - 4K + thinking HIGH  -> 1376x768 (degraded to 1K)
  - 4K no thinking      -> 5504x3072 (correct 4K)
  - 2K + thinking HIGH  -> no image (1 sample only — could be flaky)

This script repeats the 2K + thinking variant 3 times, plus 1 control of
2K no thinking, to determine whether 2K + thinking is:
  (a) consistently broken (need to disable THK at 2K too)
  (b) sometimes broken (flaky API — keep THK at 2K with caveats)
  (c) the previous result was a one-off (THK at 2K is fine)

Run:
    python scripts/smoke_test_flash_2k_thinking_repeat.py

Cost: ~$0.40 max (Flash @ 2K = $0.101/img x 4 calls).
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

# (label, include_thinking)
VARIANTS = [
    ("2K + thinking HIGH #1", True),
    ("2K + thinking HIGH #2", True),
    ("2K + thinking HIGH #3", True),
    ("2K no thinking (ctrl)", False),
]


def call(include_thinking: bool) -> dict:
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {
                "imageSize": "2K",
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


def extract(resp: dict) -> tuple[tuple[int, int] | None, int, int, str]:
    """Return (W x H or None, candidatesTokenCount, totalTokenCount, finishReason)."""
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

    print(f"Model:    {MODEL}")
    print(f"Prompt:   {PROMPT!r}")
    print(f"AR:       {ASPECT}, imageSize=2K, shape=generationConfig.imageConfig")
    print()
    print(f"{'variant':<25} | {'actual W x H':>14} | {'cand_tok':>8} | {'total_tok':>9} | finish")
    print("-" * 80)

    success_count = 0
    fail_count = 0
    for label, thinking in VARIANTS:
        resp = call(thinking)
        dims, cand_tok, total_tok, finish = extract(resp)
        if dims is None and "_error" in resp:
            print(f"{label:<25} | ERROR: {resp['_error']}")
            if "_body" in resp:
                print(f"{'':25} | body: {resp['_body']}")
            fail_count += 1
        elif dims is None:
            print(f"{label:<25} | {'no image':>14} | {cand_tok:>8} | {total_tok:>9} | {finish}")
            fail_count += 1
        else:
            dims_str = f"{dims[0]}x{dims[1]}"
            print(f"{label:<25} | {dims_str:>14} | {cand_tok:>8} | {total_tok:>9} | {finish}")
            success_count += 1

    print()
    print(f"Total: {success_count} ok, {fail_count} no-image / error")
    print()
    print("Reference dims (16:9) for 2K bucket: ~1936 x 1088 (or 2048 x 1152)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
