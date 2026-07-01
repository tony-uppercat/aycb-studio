"""Empirical smoke test: does Gemini Omni Flash video actually render via the
Interactions REST endpoint?

The 2026-07-01 refresh added `src/gemini_omni_gen.py`, which drives Omni Flash
through a raw POST to `/v1beta/interactions`. That request/response shape is
taken from Google's docs and was NOT live-verified when written (no key in the
build env). This script settles it: it sends the EXACT body the provider builds
and reports what came back — inline base64, a file `uri`, or an error.

If the field names differ from what the docs implied, fix `_build_body` /
`_extract_video` in `src/gemini_omni_gen.py` + `gemini_omni_helpers.py` to match
the real shape, then re-run.

Run:
    python scripts/smoke_test_omni_flash_video.py

Cost: ~$0.30 (one ~3s 720p clip at $0.10/s). Writes the clip to
scripts/_omni_smoke.mp4 if bytes come back inline.
"""
from __future__ import annotations

import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import settings  # noqa: E402

API_KEY = settings.gemini_api_key
URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
PROVIDER_MODEL_ID = "gemini-omni-flash-preview"
PROMPT = "A marble rolling fast on a smooth wooden track, continuous shot"
ASPECT_RATIO = "16:9"
DURATION = 3


def build_body() -> dict:
    # Mirrors src/gemini_omni_gen.py:_build_body (text-to-video path).
    return {
        "model": PROVIDER_MODEL_ID,
        "input": PROMPT,
        "response_format": {"type": "video", "aspect_ratio": ASPECT_RATIO, "delivery": "uri"},
        "generation_config": {"video_config": {"task": "text_to_video", "duration_seconds": DURATION}},
    }


def call(body: dict) -> dict:
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-goog-api-key": API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return {"_error": f"HTTP {exc.code}", "_body": exc.read().decode("utf-8", "replace")[:600]}
    except Exception as exc:  # noqa: BLE001
        return {"_error": str(exc)[:400]}


def find_video(resp: dict) -> tuple[bytes | None, str | None]:
    # Same defensive walk as gemini_omni_helpers._extract_video.
    ov = resp.get("output_video") or resp.get("outputVideo")
    if isinstance(ov, dict) and ov.get("data"):
        return base64.b64decode(ov["data"]), None
    for step in resp.get("steps", []) or []:
        for content in step.get("content", []) or []:
            if content.get("data"):
                return base64.b64decode(content["data"]), None
            if content.get("uri"):
                return None, content["uri"]
    return None, None


def main() -> int:
    if not API_KEY:
        print("ERROR: settings.gemini_api_key is empty (check .env AYCB_GEMINI_API_KEY)")
        return 2

    print(f"Endpoint: {URL}")
    print(f"Model:    {PROVIDER_MODEL_ID}")
    print(f"Body:     {json.dumps(build_body())}")
    print("\nSubmitting (blocks until the clip renders — tens of seconds)...\n")

    resp = call(build_body())
    if "_error" in resp:
        print(f"FAIL — {resp['_error']}")
        if "_body" in resp:
            print(f"body: {resp['_body']}")
        print("\nIf HTTP 400/404: the endpoint/body shape is wrong — inspect the error and")
        print("adjust _build_body in src/gemini_omni_gen.py to match the real Interactions schema.")
        return 1

    print("Top-level response keys:", list(resp.keys()))
    video, uri = find_video(resp)
    if video:
        out = Path(__file__).resolve().parent / "_omni_smoke.mp4"
        out.write_bytes(video)
        print(f"PASS — inline video, {len(video) // 1024} KB -> {out}")
        return 0
    if uri:
        print(f"PASS (uri delivery) — file uri returned: {uri}")
        print("Provider fetches this via _fetch_file_uri (poll state ACTIVE -> download).")
        return 0
    print("PARTIAL — request succeeded but no video data/uri found in the response.")
    print("Dump (first 800 chars) so you can map the real field names:")
    print(json.dumps(resp)[:800])
    return 1


if __name__ == "__main__":
    sys.exit(main())
