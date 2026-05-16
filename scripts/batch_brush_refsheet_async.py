"""Batch generate brush reference sheets via Gemini Batch API (50% discount).

Uses gemini-3-pro-image-preview at 2K / 16:9 via the async Batch API. Submits
all input images in a single JSONL job, persists job.name to disk for crash
recovery, polls every 10s, downloads the result JSONL, saves images named
per input stem.

Cost: 50% of standard interactive rates. SLA: 24h target, often faster. A
PENDING/RUNNING job expires after 48h with no result.

Resume behavior: if `00_outuput/.batch_job.json` exists from a previous
incomplete run, the script polls that job instead of submitting a new one.
Delete the file manually to force a fresh submission.

Run:
    python scripts/batch_brush_refsheet_async.py

Uses settings.gemini_api_key from .env.
"""
from __future__ import annotations

import base64
import json
import sys
import time
from datetime import datetime
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))   # project root → src.*, config.*
sys.path.insert(0, str(_HERE))          # scripts/      → batch_brush_refsheet

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

from config.settings import settings  # noqa: E402
from src.shared import MODEL_PRICING  # noqa: E402
from batch_brush_refsheet import (  # noqa: E402
    ASPECT_RATIO,
    IMAGE_EXTS,
    INPUT_DIR,
    OUTPUT_DIR,
    PROMPT,
    cost_for_response,
    prepare_ref,
    tee_stdout,
)

MODEL_ID = "gemini-3-pro-image-preview"
IMAGE_SIZE = "2K"
BATCH_DISCOUNT = 0.5
POLL_INTERVAL_S = 10
JOB_STATE_FILE = OUTPUT_DIR / ".batch_job.json"

COMPLETED_STATES = {
    "JOB_STATE_SUCCEEDED",
    "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED",
    "JOB_STATE_EXPIRED",
}


def build_request(key: str, ref_bytes: bytes, mime: str) -> dict:
    """Build one JSONL request entry (matches Gemini Batch schema)."""
    return {
        "key": key,
        "request": {
            "contents": [{
                "parts": [
                    {"inlineData": {
                        "mimeType": mime,
                        "data": base64.b64encode(ref_bytes).decode("ascii"),
                    }},
                    {"text": PROMPT},
                ],
            }],
            "generation_config": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {
                    "imageSize": IMAGE_SIZE,
                    "aspectRatio": ASPECT_RATIO,
                },
            },
        },
    }


def write_jsonl(path: Path, requests: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for req in requests:
            f.write(json.dumps(req) + "\n")


def save_job_state(job_name: str, jsonl_path: Path) -> None:
    state = {
        "job_name": job_name,
        "jsonl_path": str(jsonl_path),
        "submitted_at": datetime.now().isoformat(timespec="seconds"),
    }
    JOB_STATE_FILE.write_text(
        json.dumps(state, indent=2), encoding="utf-8", newline="\n",
    )


def load_job_state() -> dict | None:
    if not JOB_STATE_FILE.exists():
        return None
    try:
        return json.loads(JOB_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARN: could not read {JOB_STATE_FILE.name}: {exc}")
        return None


def clear_job_state() -> None:
    if JOB_STATE_FILE.exists():
        JOB_STATE_FILE.unlink()


def submit_new_job(client: genai.Client, inputs: list[Path]) -> str:
    """Build JSONL, upload via Files API, create batch job. Returns job.name."""
    print(f"Preparing {len(inputs)} request(s)...")
    requests: list[dict] = []
    for src in inputs:
        ref_bytes, mime, ref_size = prepare_ref(src)
        print(f"  {src.name}: ref {ref_size[0]}x{ref_size[1]} ({len(ref_bytes)//1024} KB)")
        requests.append(build_request(src.stem, ref_bytes, mime))

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    jsonl_path = OUTPUT_DIR / f"batch_requests_{ts}.jsonl"
    write_jsonl(jsonl_path, requests)
    size_mb = jsonl_path.stat().st_size / (1024 * 1024)
    print(f"JSONL written: {jsonl_path.name} ({size_mb:.2f} MB)")

    print("Uploading JSONL via Files API...")
    uploaded = client.files.upload(
        file=jsonl_path,
        config=types.UploadFileConfig(
            display_name=jsonl_path.stem,
            mime_type="jsonl",
        ),
    )
    print(f"Uploaded file resource: {uploaded.name}")

    print(f"Creating batch job (model={MODEL_ID})...")
    job = client.batches.create(
        model=MODEL_ID,
        src=uploaded.name,
        config={"display_name": f"brush-refsheet-{ts}"},
    )
    print(f"Job created: {job.name}")
    save_job_state(job.name, jsonl_path)
    return job.name


def poll_until_done(client: genai.Client, job_name: str) -> object:
    """Poll job every POLL_INTERVAL_S until it reaches a completed state."""
    job = client.batches.get(name=job_name)
    last_state = None
    while job.state.name not in COMPLETED_STATES:
        if job.state.name != last_state:
            print(f"  state: {job.state.name} (since {datetime.now():%H:%M:%S})")
            last_state = job.state.name
        time.sleep(POLL_INTERVAL_S)
        job = client.batches.get(name=job_name)
    print(f"  state: {job.state.name} ({datetime.now():%H:%M:%S})")
    return job


def _extract_image_from_response(resp: dict) -> bytes | None:
    candidates = resp.get("candidates") or []
    if not candidates:
        return None
    parts = candidates[0].get("content", {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    return None


def parse_and_save_results(
    client: genai.Client, job: object,
) -> tuple[int, list[tuple[str, int, int, float]], list[tuple[str, str]]]:
    """Download result JSONL, save images per key. Returns (n_success, costs, failures)."""
    dest = getattr(job, "dest", None)
    result_file = getattr(dest, "file_name", None) if dest else None
    if not result_file:
        raise RuntimeError(f"Job succeeded but has no dest.file_name (dest={dest!r})")
    print(f"Downloading results from {result_file}...")
    content = client.files.download(file=result_file).decode("utf-8")

    successes = 0
    costs: list[tuple[str, int, int, float]] = []
    failures: list[tuple[str, str]] = []

    for line in content.splitlines():
        if not line.strip():
            continue
        parsed = json.loads(line)
        key = parsed.get("key") or "?"
        out_path = OUTPUT_DIR / f"{key}.png"

        if parsed.get("error"):
            err = json.dumps(parsed["error"])[:300]
            print(f"  {key}: ERROR — {err}")
            failures.append((key, err))
            continue

        resp = parsed.get("response")
        if not resp:
            failures.append((key, "no response in result line"))
            print(f"  {key}: FAIL — no response in result line")
            continue

        img_bytes = _extract_image_from_response(resp)
        if img_bytes is None:
            finish = (resp.get("candidates") or [{}])[0].get("finishReason", "?")
            failures.append((key, f"no inline image (finish={finish})"))
            print(f"  {key}: FAIL — no inline image (finish={finish})")
            continue

        out_path.write_bytes(img_bytes)
        in_tok, out_tok, full_cost = cost_for_response(MODEL_ID, resp)
        cost = round(full_cost * BATCH_DISCOUNT, 6)
        costs.append((f"{key}.png", in_tok, out_tok, cost))
        size_kb = len(img_bytes) // 1024
        print(f"  {key}.png: OK — {size_kb} KB, {in_tok}+{out_tok} tok, ${cost:.4f}")
        successes += 1

    return successes, costs, failures


def print_batch_cost_table(costs: list[tuple[str, int, int, float]]) -> None:
    if not costs:
        return
    rates = MODEL_PRICING.get(MODEL_ID, (0.0, 0.0))
    eff_in = rates[0] * BATCH_DISCOUNT
    eff_out = rates[1] * BATCH_DISCOUNT
    total_in = sum(c[1] for c in costs)
    total_out = sum(c[2] for c in costs)
    total_cost = sum(c[3] for c in costs)
    full_cost = total_cost / BATCH_DISCOUNT if BATCH_DISCOUNT else total_cost
    saved = full_cost - total_cost
    pct = int((1 - BATCH_DISCOUNT) * 100)
    print()
    print(f"Cost summary ({MODEL_ID} @ ${eff_in:.2f}/1M in, ${eff_out:.2f}/1M out — batch -{pct}%):")
    print(f"  {'File':<28}  {'Input tok':>10}  {'Output tok':>11}  {'Cost USD':>10}")
    print(f"  {'-' * 28}  {'-' * 10}  {'-' * 11}  {'-' * 10}")
    for name, inp, out, cost in costs:
        print(f"  {name:<28}  {inp:>10}  {out:>11}  {cost:>10.4f}")
    print(f"  {'-' * 28}  {'-' * 10}  {'-' * 11}  {'-' * 10}")
    print(f"  {'TOTAL':<28}  {total_in:>10}  {total_out:>11}  {total_cost:>10.4f}")
    print(f"  Saved vs sync at standard rate: ${saved:.4f}")


def main() -> int:
    if not settings.gemini_api_key:
        print("ERROR: AYCB_GEMINI_API_KEY missing in .env")
        return 2
    if not INPUT_DIR.exists():
        print(f"ERROR: input folder not found: {INPUT_DIR}")
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    inputs = sorted(p for p in INPUT_DIR.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS)
    if not inputs:
        print(f"ERROR: no images found in {INPUT_DIR}")
        return 2

    started = datetime.now()
    log_path = OUTPUT_DIR / f"batch_async_{started:%Y%m%d_%H%M%S}.log"

    with tee_stdout(log_path):
        print(f"=== Batch async run started {started:%Y-%m-%d %H:%M:%S} ===")
        print(f"Model:       {MODEL_ID}")
        print(f"Resolution:  {IMAGE_SIZE} @ {ASPECT_RATIO}")
        print(f"Input dir:   {INPUT_DIR}")
        print(f"Output dir:  {OUTPUT_DIR}")
        print(f"Log file:    {log_path}")
        print(f"Found:       {len(inputs)} image(s)")
        print(f"Discount:    {int((1 - BATCH_DISCOUNT) * 100)}% (batch API)")
        print()

        client = genai.Client(api_key=settings.gemini_api_key)

        state = load_job_state()
        if state:
            job_name = state["job_name"]
            print(f"Found pending job state: {job_name}")
            print(f"  submitted at: {state.get('submitted_at', '?')}")
            print(f"  resuming polling (delete {JOB_STATE_FILE.name} to force fresh submit)")
        else:
            try:
                job_name = submit_new_job(client, inputs)
            except Exception as exc:
                print(f"ERROR creating batch job: {exc}")
                return 3

        print()
        print(f"Polling every {POLL_INTERVAL_S}s...")
        try:
            job = poll_until_done(client, job_name)
        except Exception as exc:
            print(f"ERROR polling: {exc}")
            return 4

        print()
        if job.state.name != "JOB_STATE_SUCCEEDED":
            err = getattr(job, "error", None)
            print(f"Job ended in {job.state.name}.")
            if err:
                print(f"  error: {err}")
            return 5

        try:
            successes, costs, failures = parse_and_save_results(client, job)
        except Exception as exc:
            print(f"ERROR parsing results: {exc}")
            return 6

        clear_job_state()

        ended = datetime.now()
        total_s = (ended - started).total_seconds()
        print()
        print(f"Done: {successes} generated, {len(failures)} failed (of {len(inputs)})")
        if failures:
            print("Failures:")
            for name, err in failures:
                print(f"  - {name}: {err}")
        print_batch_cost_table(costs)
        print(f"=== Batch async run ended {ended:%Y-%m-%d %H:%M:%S} (total {total_s:.1f}s) ===")
        return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
