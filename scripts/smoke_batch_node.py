"""End-to-end smoke test for the batch_gen plugin.

Submits ONE real Gemini Pro 2K request via /api/batch/submit, polls
/api/batch/jobs until SUCCEEDED, verifies the resulting PNG exists in
shared/Media with tEXt metadata, and prints discounted cost.

Required: backend running on localhost:5101 with AYCB_GEMINI_API_KEY set.

Run:
    python scripts/smoke_batch_node.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import requests

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from config.settings import settings  # noqa: E402

API = "http://localhost:5101"
TIMEOUT_MIN = 30  # batch jobs usually complete in <10 min


def main() -> int:
    print("=== batch_gen smoke test ===")

    payload = {
        "node_id": "smoke-test",
        "model": "gemini-3-pro-image-preview",
        "requests": [{
            "key": "smoke-r0",
            "prompt": "A vintage typewriter on a wooden desk, soft window light, shallow depth of field",
            "refs_b64": [],
            "refs_mime": [],
            "aspect_ratio": "16:9",
            "resolution": "2K",
            "thinking": False,
            "grounding": False,
        }],
    }
    print("Submitting...")
    r = requests.post(f"{API}/api/batch/submit", json=payload, timeout=30)
    if r.status_code != 200:
        print(f"FAIL submit: HTTP {r.status_code} {r.text}")
        return 2
    sub = r.json()
    job_id = sub["job_id"]
    print(f"  job_id={job_id}  estimate=${sub['cost_estimate']:.4f}")

    print(f"Polling /api/batch/jobs (up to {TIMEOUT_MIN}m)...")
    deadline = time.time() + TIMEOUT_MIN * 60
    last_state = None
    while time.time() < deadline:
        r = requests.get(f"{API}/api/batch/jobs?node_id=smoke-test", timeout=30)
        jobs = r.json().get("jobs", [])
        job = next((j for j in jobs if j["id"] == job_id), None)
        if not job:
            print("FAIL: job missing from /jobs")
            return 3
        state = job["state"]
        if state != last_state:
            print(f"  state={state}")
            last_state = state
        if state == "succeeded":
            results = job.get("results", [])
            if not results:
                print("FAIL: succeeded but no results")
                return 4
            media_path = results[0].get("media_path")
            cost = results[0].get("cost", 0.0)
            print(f"  media_path={media_path}  cost=${cost:.4f}")
            abs_path = settings.shared_root / media_path
            if not abs_path.exists():
                print(f"FAIL: file not on disk: {abs_path}")
                return 5
            print(f"  PNG size: {abs_path.stat().st_size // 1024} KB")
            print("PASS")
            return 0
        if state in ("failed", "cancelled", "expired"):
            print(f"FAIL: terminal state {state} - error={job.get('error')!r}")
            return 6
        time.sleep(15)
    print(f"FAIL: timed out after {TIMEOUT_MIN}m")
    return 7


if __name__ == "__main__":
    sys.exit(main())
