"""Smoke test: Gemini Batch API INLINE mode via raw REST.

Submits ONE cheap flash-lite image request inline, polls every 10s,
then prints the COMPLETE operation JSON (b64 truncated) so the exact
result nesting can be coded into frontend/src/providers/geminiBatchPath.ts.
Cost: ~$0.034 (flash @1K, batch -50%).

NOTE (empirical, 2026-06-11): flash-LITE-image does NOT support
batchGenerateContent (404). Supported image models: gemini-3-pro-image(-preview),
gemini-3.1-flash-image(-preview), gemini-2.5-flash-image.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import settings

BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "gemini-3.1-flash-image-preview"
TERMINAL = {"BATCH_STATE_SUCCEEDED", "BATCH_STATE_FAILED",
            "BATCH_STATE_CANCELLED", "BATCH_STATE_EXPIRED"}


def _call(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "x-goog-api-key": settings.gemini_api_key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _truncate_b64(obj):
    if isinstance(obj, dict):
        return {k: ("<b64 %d chars>" % len(v) if k == "data" and isinstance(v, str) and len(v) > 200
                    else _truncate_b64(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_truncate_b64(x) for x in obj]
    return obj


def main() -> int:
    submit_body = {
        "batch": {
            "display_name": "aycb-smoke-inline",
            "input_config": {"requests": {"requests": [{
                "request": {
                    "contents": [{"role": "user", "parts": [{"text": "A red cube on a white table, studio light"}]}],
                    "generationConfig": {
                        "responseModalities": ["IMAGE", "TEXT"],
                        "imageConfig": {"imageSize": "1K", "aspectRatio": "1:1"},
                    },
                },
                "metadata": {"key": "r0"},
            }]}},
        }
    }
    try:
        op = _call("POST", f"{BASE}/models/{MODEL}:batchGenerateContent", submit_body)
    except urllib.error.HTTPError as e:
        print(f"SUBMIT FAILED: HTTP {e.code}")
        print(e.read().decode())
        return 1
    print("=== SUBMIT RESPONSE ===")
    print(json.dumps(_truncate_b64(op), indent=2))
    name = op["name"]

    while True:
        time.sleep(10)
        op = _call("GET", f"{BASE}/{name}")
        state = (op.get("metadata") or {}).get("state", "?")
        print(f"poll: state={state} done={op.get('done')}")
        if state in TERMINAL or op.get("done"):
            break

    print("=== FINAL OPERATION ===")
    print(json.dumps(_truncate_b64(op), indent=2))
    out = Path(__file__).parent / "smoke_batch_inline_result.json"
    out.write_text(json.dumps(op, indent=2), encoding="utf-8", newline="\n")
    print(f"full JSON (with b64) -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
