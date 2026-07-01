"""Empirical smoke test: do the GA image ids resolve, and do the old preview ids still work?

The 2026-07-01 model refresh migrated the canonical image ids to GA
(`gemini-3.1-flash-image`, `gemini-3-pro-image`) and added Nano Banana 2 Lite
(`gemini-3.1-flash-lite-image`). The app keeps `-preview -> GA` reverse aliases
so pre-migration saved canvases still resolve. This settles empirically:

  1. Do the new GA ids return an image? (they MUST — the app now sends them)
  2. Do the old `-preview` ids still return an image at Google's API? (the
     reverse-alias resolves ids before the call, so a straggler is harmless
     ONLY if the preview id also still works OR is never sent raw — this tells
     you which.)
  3. Does the new Lite id work, and at which resolutions (2K/4K unconfirmed)?

Run:
    python scripts/smoke_test_ga_image_ids.py

Cost: ~$0.30 (one 1K image per id: flash 0.067, pro 0.134, lite 0.034, ×2 for
preview twins on flash/pro = ~$0.47). Delete/skip lines you don't want billed.
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
PROMPT = "A single red circle on a plain white background, simple flat illustration"

# (id, note). GA ids first (must work), then preview twins (reverse-alias check),
# then Lite at each tier (2K/4K unconfirmed by Google).
CASES: list[tuple[str, str, str]] = [
    ("gemini-3.1-flash-image", "1K", "GA — Nano Banana 2 (must work)"),
    ("gemini-3-pro-image", "1K", "GA — Nano Banana Pro (must work)"),
    ("gemini-3.1-flash-lite-image", "1K", "GA — Nano Banana 2 Lite (new)"),
    ("gemini-3.1-flash-lite-image", "2K", "Lite @2K — unconfirmed max-res"),
    ("gemini-3.1-flash-lite-image", "4K", "Lite @4K — unconfirmed max-res"),
    ("gemini-3.1-flash-image-preview", "1K", "legacy preview twin — still resolve?"),
    ("gemini-3-pro-image-preview", "1K", "legacy preview twin — still resolve?"),
]


def call(model_id: str, image_size: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
    body = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {"imageSize": image_size, "aspectRatio": "1:1"},
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-goog-api-key": API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return {"_error": f"HTTP {exc.code}", "_body": exc.read().decode("utf-8", "replace")[:200]}
    except Exception as exc:  # noqa: BLE001
        return {"_error": str(exc)[:200]}


def dims(resp: dict) -> tuple[int, int] | None:
    for part in (resp.get("candidates") or [{}])[0].get("content", {}).get("parts", []) or []:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            img = PILImage.open(io.BytesIO(base64.b64decode(inline["data"])))
            return img.width, img.height
    return None


def main() -> int:
    if not API_KEY:
        print("ERROR: settings.gemini_api_key is empty (check .env AYCB_GEMINI_API_KEY)")
        return 2

    print(f"{'model id':>32} | {'size':>4} | {'result':>13} | note")
    print("-" * 90)
    ok = True
    for model_id, size, note in CASES:
        resp = call(model_id, size)
        if "_error" in resp:
            result = resp["_error"]
            if not model_id.endswith("-preview"):
                ok = False  # a GA/Lite id failing is a real problem
        else:
            d = dims(resp)
            result = f"{d[0]}x{d[1]}" if d else "no-image"
            if d is None and not model_id.endswith("-preview"):
                ok = False
        print(f"{model_id:>32} | {size:>4} | {result:>13} | {note}")
        if "_body" in resp:
            print(f"{'':>32} |      | body: {resp['_body']}")

    print()
    print("PASS if every GA/Lite row returned an image (WxH).")
    print("Preview twins: if they ERROR, the reverse-alias must resolve them before any")
    print("raw send — confirmed already for generate/batch; edit-node still sends preview raw.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
