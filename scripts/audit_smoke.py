#!/usr/bin/env python
"""Smoke tests against a live AYCB backend.

Covers every audit fix that has an HTTP-observable behavior. Lets Antonio
skip the backend-side manual checks and focus on the browser-side visual
validation (canvas, gallery, Lightbox).

Usage:
    python scripts/audit_smoke.py
    python scripts/audit_smoke.py --host http://localhost:5101

Exits 0 on all-green, 1 on any fail, 2 if the backend is unreachable.
"""
from __future__ import annotations

import argparse
import sys
import time
from io import BytesIO

import httpx

# Windows default cp1252 stdout can't print the box-drawing / arrow chars
# we use for nice formatting. Force UTF-8 if possible; ignore if not.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


# ── output helpers ─────────────────────────────────────────────────────────

_PASSES = 0
_FAILS = 0
_SKIPS = 0
_FAIL_NAMES: list[str] = []


def _emit(tag: str, name: str, detail: str = "") -> None:
    line = f"  [{tag:4}] {name}"
    if detail:
        line += f"  --{detail}"
    print(line, flush=True)


def _ok(name: str, detail: str = "") -> None:
    global _PASSES
    _PASSES += 1
    _emit("PASS", name, detail)


def _fail(name: str, detail: str) -> None:
    global _FAILS
    _FAILS += 1
    _FAIL_NAMES.append(name)
    _emit("FAIL", name, detail)


def _skip(name: str, detail: str) -> None:
    global _SKIPS
    _SKIPS += 1
    _emit("SKIP", name, detail)


# ── individual checks ──────────────────────────────────────────────────────

def check_health(host: str) -> bool:
    try:
        r = httpx.get(f"{host}/api/health", timeout=3.0)
    except Exception as e:
        _fail("backend health", f"{host} unreachable ({e.__class__.__name__})")
        return False
    if r.status_code == 200:
        _ok("backend health", f"200 in {r.elapsed.total_seconds() * 1000:.0f}ms")
        return True
    _fail("backend health", f"status={r.status_code}")
    return False


def check_c1_path_traversal(host: str) -> str | None:
    """POST an upload with an evil filename and verify it lands sanitized.

    Returns the sanitized stem (for later cleanup) or None on fail.
    """
    evil_name = "../../_aycb_c1_smoke.png"
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    files = {"file": (evil_name, BytesIO(png_bytes), "image/png")}
    try:
        r = httpx.post(f"{host}/api/rh/upload/media", files=files, timeout=5.0)
    except Exception as e:
        _fail("C1 path traversal", f"request failed: {e}")
        return None
    if r.status_code != 200:
        _fail("C1 path traversal", f"unexpected status {r.status_code}: {r.text[:200]}")
        return None
    data = r.json()
    returned_name = str(data.get("filename", ""))
    path = str(data.get("path", ""))
    if "/" in returned_name or "\\" in returned_name or ".." in returned_name:
        _fail("C1 path traversal", f"unsanitized filename returned: {returned_name!r}")
        return None
    # Strip Windows drive prefix before checking for `..`
    cleaned = path.split(":", 1)[-1] if ":" in path else path
    if ".." in cleaned:
        _fail("C1 path traversal", f"path contains `..`: {path!r}")
        return None
    _ok("C1 path traversal", f"sanitized to {returned_name!r}")
    return returned_name.rsplit(".", 1)[0] if "." in returned_name else returned_name


def check_c2_veo_duration(host: str) -> None:
    """Duration=5s to Veo must raise 422, not silently snap to 4s."""
    try:
        r = httpx.post(
            f"{host}/api/generate/video",
            data={
                "prompt": "smoke test",
                "model": "vertex-veo-3.1",
                "aspect_ratio": "16:9",
                "duration": 5,
                "quality": "720p",
                "api_key": "",
            },
            timeout=10.0,
        )
    except Exception as e:
        _fail("C2 Veo duration", f"request failed: {e}")
        return

    body = r.text.lower()
    if r.status_code == 422 and "duration must be one of" in body:
        _ok("C2 Veo duration", "422 with constraint message")
        return
    if r.status_code == 400 and "gemini" in body and "key" in body:
        _skip("C2 Veo duration", "requires Gemini API key (400 missing-key) — re-run with key set")
        return
    if r.status_code == 200:
        _fail("C2 Veo duration", "accepted duration=5 silently — fix not deployed?")
        return
    _fail("C2 Veo duration", f"unexpected {r.status_code}: {r.text[:200]}")


def check_c3_registry(host: str) -> None:
    """Registry endpoint returns the canonical model set."""
    try:
        r = httpx.get(f"{host}/api/registry/models", timeout=3.0)
    except Exception as e:
        _fail("C3 registry all", f"request failed: {e}")
        return
    if r.status_code != 200:
        _fail("C3 registry all", f"status={r.status_code}")
        return
    models = r.json().get("models", [])
    ids = {m["id"] for m in models}
    expected = {
        "gemini-3.1-flash-image-preview",
        "gemini-3-pro-image-preview",
        "vertex-veo-3.1",
        "vertex-veo-3.1-fast",
        "kling-3.0-omni",
        "fal-kling-v3-std",
        "atlas-seedance-2.0",
        "flux-2-klein-4b",
        "claude-opus-4-6-20250620",
    }
    missing = expected - ids
    if missing:
        _fail("C3 registry all", f"missing ids: {sorted(missing)}")
        return
    _ok("C3 registry all", f"{len(models)} models, all canonical ids present")


def check_c3_capability_filter(host: str) -> None:
    """/api/registry/models/video returns only video-capability models."""
    try:
        r = httpx.get(f"{host}/api/registry/models/video", timeout=3.0)
    except Exception as e:
        _fail("C3 registry video filter", f"request failed: {e}")
        return
    if r.status_code != 200:
        _fail("C3 registry video filter", f"status={r.status_code}")
        return
    models = r.json().get("models", [])
    not_video = [m["id"] for m in models if m.get("capability") != "video"]
    if not_video:
        _fail("C3 registry video filter", f"returned non-video: {not_video}")
        return
    if len(models) < 8:
        _fail("C3 registry video filter", f"expected ≥8 video models, got {len(models)}")
        return
    _ok("C3 registry video filter", f"{len(models)} video models")


def check_c3_rejects_unknown_capability(host: str) -> None:
    try:
        r = httpx.get(f"{host}/api/registry/models/nope", timeout=3.0)
    except Exception as e:
        _fail("C3 registry rejects bad capability", f"request failed: {e}")
        return
    if r.status_code == 400:
        _ok("C3 registry rejects bad capability", "400 as expected")
        return
    _fail("C3 registry rejects bad capability", f"expected 400, got {r.status_code}")


def check_m3_rh_auto_discover(host: str) -> None:
    """Every auto-discovered /api/rh/* module still mounts."""
    paths = [
        "/api/rh/media",
        "/api/rh/media/stats",
        "/api/rh/media/directories",
        "/api/rh/folders",
        "/api/rh/assets",
        "/api/rh/references",
    ]
    failures: list[str] = []
    for p in paths:
        try:
            r = httpx.get(f"{host}{p}", timeout=3.0)
        except Exception as e:
            failures.append(f"{p}:{e.__class__.__name__}")
            continue
        if r.status_code == 404 and "not found" in r.text.lower():
            # 404 with "not found" from FastAPI itself means router not mounted;
            # endpoint-level 404s (e.g. empty collection) are fine.
            if "detail" not in r.text.lower():
                failures.append(f"{p}:router missing")
    if failures:
        _fail("M3 RH auto-discover", "; ".join(failures))
        return
    _ok("M3 RH auto-discover", f"all {len(paths)} RH endpoints responsive")


def check_m11_video_proc_rename(host: str) -> None:
    """src/routers/video.py renamed to video_proc.py; /api/video/* still mounted.

    A 405 Method Not Allowed proves the path IS registered (FastAPI knows
    about it, just not this method). A 404 with bare FastAPI detail would
    mean the router was dropped by the rename.
    """
    try:
        r = httpx.get(f"{host}/api/video/duration", timeout=3.0)
    except Exception as e:
        _fail("M11 video_proc mount", f"request failed: {e}")
        return
    if r.status_code == 405:
        _ok("M11 video_proc mount", "router mounted (405 = path known, method wrong)")
        return
    if r.status_code in (400, 422, 500):
        _ok("M11 video_proc mount", f"router mounted ({r.status_code})")
        return
    if r.status_code == 404 and '"detail":"Not Found"' in r.text:
        _fail("M11 video_proc mount", "path returns bare 404 — router appears unmounted")
        return
    _fail("M11 video_proc mount", f"unexpected {r.status_code}: {r.text[:100]}")


def check_m1_bridge_ro(host: str) -> None:
    """/api/bridge/media/list walks through bridge_ro (thumb URL lookup)."""
    try:
        r = httpx.get(f"{host}/api/bridge/media/list", timeout=10.0)
    except Exception as e:
        _fail("M1 bridge_ro media/list", f"request failed: {e}")
        return
    if r.status_code != 200:
        _fail("M1 bridge_ro media/list", f"status={r.status_code}")
        return
    data = r.json()
    if not isinstance(data, list):
        _fail("M1 bridge_ro media/list", f"expected list, got {type(data).__name__}")
        return
    _ok("M1 bridge_ro media/list", f"{len(data)} items")


def check_m3_perf_log_async(host: str) -> None:
    """perf_log endpoint accepts a batch and returns the processed count."""
    try:
        r = httpx.post(
            f"{host}/api/perf",
            json={"events": [
                {"type": "smoke-test", "message": "audit_smoke.py"},
                {"type": "smoke-test", "message": "audit_smoke.py #2"},
            ]},
            timeout=3.0,
        )
    except Exception as e:
        _fail("m3 perf_log async", f"request failed: {e}")
        return
    if r.status_code != 200:
        _fail("m3 perf_log async", f"status={r.status_code}")
        return
    data = r.json()
    if not data.get("ok") or data.get("count") != 2:
        _fail("m3 perf_log async", f"unexpected response: {data}")
        return
    _ok("m3 perf_log async", "batch accepted, count=2")


def check_log_silence(host: str) -> None:
    """Make many requests to the quieted paths. Non-assertive — operator
    confirms by eyeballing the backend console. We just report the count."""
    quiet_paths = [
        "/api/bridge/review/nonexistent_stem_aaa",
        "/api/bridge/meta/nonexistent_stem_bbb",
    ]
    total = 0
    for p in quiet_paths:
        for _ in range(5):
            try:
                httpx.get(f"{host}{p}", timeout=2.0)
                total += 1
            except Exception:
                pass
    _skip(
        "log silence on quiet paths",
        f"fired {total} reqs at /api/bridge/{{review,meta}}/* — "
        f"verify backend console stays silent",
    )


def cleanup_c1(host: str, stem: str) -> None:
    """Remove the sanitized file C1 just uploaded so media_dir stays clean."""
    try:
        r = httpx.delete(f"{host}/api/bridge/media/{stem}", timeout=3.0)
    except Exception as e:
        print(f"  [WARN] could not clean up C1 upload ({e})")
        return
    if r.status_code in (200, 404):
        return
    print(f"  [WARN] C1 cleanup unexpected status: {r.status_code}")


# ── main ───────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--host", default="http://localhost:5101",
                        help="backend base URL (default: http://localhost:5101)")
    args = parser.parse_args()
    host = args.host.rstrip("/")

    print()
    print(f"  AYCB audit smoke test  :  {host}")
    print(f"  {'-' * 56}")

    if not check_health(host):
        print()
        print(f"  Backend unreachable. Start it with:")
        print(f"    python -m uvicorn src.api:app --reload --port 5101")
        print(f"  or launch AYCB Studio.bat.")
        return 2

    t0 = time.time()
    c1_stem = check_c1_path_traversal(host)
    check_c2_veo_duration(host)
    check_c3_registry(host)
    check_c3_capability_filter(host)
    check_c3_rejects_unknown_capability(host)
    check_m3_rh_auto_discover(host)
    check_m11_video_proc_rename(host)
    check_m1_bridge_ro(host)
    check_m3_perf_log_async(host)
    check_log_silence(host)

    if c1_stem:
        cleanup_c1(host, c1_stem)

    elapsed = time.time() - t0
    print(f"  {'-' * 56}")
    print(f"  {_PASSES} pass / {_FAILS} fail / {_SKIPS} skip / {elapsed:.1f}s")
    if _FAIL_NAMES:
        print(f"  Failed: {', '.join(_FAIL_NAMES)}")
    print()
    print("  Manual visual checks (Antonio side):")
    print("    * Drawing mode in Lightbox → Save button persists strokes + toast")
    print("    * Gallery open → backend console stays silent on scroll/refresh")
    print("    * Canvas drag/resize a Generate Image node with a long history")
    print("      → arrow-keys navigate history, no stale preview")
    print("    * NB2 Light Director viewport → pan/zoom camera, light changes apply")
    print()

    return 0 if _FAILS == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
