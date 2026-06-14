"""Live smoke gate: N>1 Gemini Batch bundling routes results by metadata.key.

This is the MANUAL / CI gate for the async batch-bundling feature. The app's
batch path (frontend/src/providers/geminiBatchPath.ts) bundles N image requests
into a SINGLE batchGenerateContent operation and reassembles the per-request
results by `metadata.key`. That round-trip was only verified live for N=1
(scripts/smoke_test_gemini_batch_inline.py). This script verifies it for N>1.

It makes THREE real, PAID image-generation calls (one batch of 3 requests,
flash-image @ batch -50%) and asserts that:
  - the finished operation has exactly 3 inlined responses,
  - the set of returned metadata.key values equals {n0, n1, n2}, and
  - every entry carries non-empty inline image bytes.

It is NOT wired into the app — run it by hand (or in CI) when the bundling
codepath changes.

Run:
    GEMINI_API_KEY=...  python scripts/smoke_test_gemini_batch_bundle.py
    # or GOOGLE_API_KEY=...  (either env var works)

Exit code 0 = full pass, 1 = any failure (or timeout).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "gemini-3.1-flash-image-preview"
TERMINAL = {"BATCH_STATE_SUCCEEDED", "BATCH_STATE_FAILED",
            "BATCH_STATE_CANCELLED", "BATCH_STATE_EXPIRED"}
SUCCESS_STATE = "BATCH_STATE_SUCCEEDED"

POLL_INTERVAL_S = 10
MAX_WAIT_S = 15 * 60  # 15 minutes, then FAIL with a timeout message

# metadata.key -> prompt. Distinct prompts so a routing bug (wrong key on the
# wrong image) is at least plausibly catchable by a human eyeballing outputs.
REQUESTS = {
    "n0": "a red circle",
    "n1": "a blue square",
    "n2": "a green triangle",
}
EXPECTED_KEYS = set(REQUESTS)


def _resolve_api_key() -> str:
    """GEMINI_API_KEY / GOOGLE_API_KEY env first; fall back to settings.

    Never printed. Raises if nothing is configured.
    """
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        try:
            from config.settings import settings
            key = settings.gemini_api_key
        except Exception as exc:  # config import is best-effort only
            print(f"WARN: could not load config.settings ({exc})")
            key = ""
    if not key:
        raise SystemExit(
            "ERROR: no API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY), "
            "e.g. GEMINI_API_KEY=... python scripts/smoke_test_gemini_batch_bundle.py"
        )
    return key


def _call(method: str, url: str, api_key: str, body: dict | None = None) -> dict:
    """One REST call. On HTTPError, surface the Google error message."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        try:
            detail = json.loads(detail).get("error", {}).get("message", detail)
        except Exception:
            pass
        raise SystemExit(f"ERROR: HTTP {e.code} on {method} {url}\n{detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"ERROR: network failure on {method} {url}: {e.reason}")


def _build_submit_body() -> dict:
    """One batch, three requests, each tagged with its metadata.key."""
    reqs = []
    for key, prompt in REQUESTS.items():
        reqs.append({
            "request": {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
            },
            "metadata": {"key": key},
        })
    return {
        "batch": {
            "display_name": "aycb-smoke-bundle-n3",
            "input_config": {"requests": {"requests": reqs}},
        }
    }


def _inlined_responses(op: dict) -> list:
    """All inlined entries from a finished op (tolerates both REST nestings)."""
    inlined = (op.get("response") or {}).get("inlinedResponses")
    if isinstance(inlined, dict):
        inlined = inlined.get("inlinedResponses")
    return inlined if isinstance(inlined, list) else []


def _image_bytes_len(entry: dict) -> int:
    """Length of the first non-empty inline image `data` field in an entry.

    Tolerates camelCase `inlineData` and snake_case `inline_data`.
    """
    resp = entry.get("response") or {}
    for cand in (resp.get("candidates") or []):
        parts = ((cand.get("content") or {}).get("parts")) or []
        for part in parts:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline:
                data = inline.get("data")
                if isinstance(data, str) and data:
                    return len(data)
    return 0


def main() -> int:
    api_key = _resolve_api_key()

    print(f"=== Gemini batch bundle smoke (N={len(REQUESTS)}) ===")
    print(f"model={MODEL}  keys={sorted(EXPECTED_KEYS)}")
    print("submitting one batch with three requests (3 paid image-gen calls)...")

    op = _call("POST", f"{BASE}/models/{MODEL}:batchGenerateContent",
               api_key, _build_submit_body())
    name = op.get("name")
    if not name:
        print("RESULT: FAIL")
        print("submit returned no operation name")
        return 1
    print(f"operation: {name}")

    deadline = time.monotonic() + MAX_WAIT_S
    state = "?"
    while True:
        if time.monotonic() >= deadline:
            print(f"RESULT: FAIL")
            print(f"timeout: batch did not reach a terminal state within "
                  f"{MAX_WAIT_S // 60} min (last state={state})")
            return 1
        time.sleep(POLL_INTERVAL_S)
        op = _call("GET", f"{BASE}/{name}", api_key)
        state = (op.get("metadata") or {}).get("state", "?")
        done = bool(op.get("done"))
        print(f"poll: state={state} done={done}")
        if state in TERMINAL or done:
            break

    if state != SUCCESS_STATE:
        msg = (op.get("error") or {}).get("message", state)
        print("RESULT: FAIL")
        print(f"batch terminal state not success: {msg}")
        return 1

    entries = _inlined_responses(op)
    by_key: dict[str, dict] = {}
    for i, entry in enumerate(entries):
        k = ((entry.get("metadata") or {}).get("key")) or f"<missing-{i}>"
        by_key[str(k)] = entry

    ok = True

    # Count check.
    if len(entries) != len(EXPECTED_KEYS):
        print(f"FAIL <count> expected {len(EXPECTED_KEYS)} inlined responses, "
              f"got {len(entries)}")
        ok = False

    # Key-set check.
    returned_keys = set(by_key)
    if returned_keys != EXPECTED_KEYS:
        missing = EXPECTED_KEYS - returned_keys
        extra = returned_keys - EXPECTED_KEYS
        print(f"FAIL <keys> key set mismatch — missing={sorted(missing)} "
              f"extra={sorted(extra)}")
        ok = False

    # Per-key image-bytes check.
    for key in sorted(EXPECTED_KEYS):
        entry = by_key.get(key)
        if entry is None:
            print(f"FAIL {key} no inlined response for this key")
            ok = False
            continue
        if entry.get("error"):
            err = entry["error"].get("message", json.dumps(entry["error"])[:200])
            print(f"FAIL {key} request error: {err}")
            ok = False
            continue
        n = _image_bytes_len(entry)
        if n <= 0:
            print(f"FAIL {key} no non-empty inline image data")
            ok = False
        else:
            print(f"PASS {key} ({n} b64 chars of image data)")

    print(f"RESULT: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
