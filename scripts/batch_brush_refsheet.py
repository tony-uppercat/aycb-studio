"""Batch generate brush reference sheets from product photos.

For each image in INPUT_DIR, call the configured Gemini image model
(MODEL_ID) at IMAGE_SIZE / ASPECT_RATIO using the source image as a single
visual reference, and save the generated reference sheet PNG to OUTPUT_DIR
with the same stem.

Refs are pre-downscaled to MAX_REF_LONG_EDGE and re-encoded as JPEG to keep
payloads small and avoid Google's server-side deadline (very large refs at
8K+ trigger 503 'Deadline expired').

Uses REST direct (urllib) instead of the google.genai SDK because the SDK
has historically dropped imageConfig.imageSize. No thinkingConfig is sent:
Pro Image auto-thinks and explicit values cause 503; on Flash, thinking
HIGH + size >=2K degrades quality.

Run:
    python scripts/batch_brush_refsheet.py

Uses settings.gemini_api_key from .env.
"""
from __future__ import annotations

import base64
import io
import json
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image as PILImage  # noqa: E402

from config.settings import settings  # noqa: E402
from src.shared import MODEL_PRICING  # noqa: E402

INPUT_DIR = Path(
    r"C:\Users\upper\Uppercat Dropbox\Antonio Cottone\2026\06_PAO"
    r"\00_incoming\Product Videos\01- Brushes\00_batch"
)
OUTPUT_DIR = INPUT_DIR / "00_outuput"

MODEL_ID = "gemini-3.1-flash-image-preview"
IMAGE_SIZE = "1K"
ASPECT_RATIO = "16:9"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:generateContent"
REQUEST_TIMEOUT_S = 300
MAX_ATTEMPTS = 3
RETRY_HTTP_CODES = {429, 500, 502, 503, 504}
RETRY_BACKOFF_S = (5, 15)

# Downscale references to keep payload small + avoid server-side deadline.
# The model only needs visual identity from the ref, not full-res pixels.
MAX_REF_LONG_EDGE = 1536
JPEG_QUALITY = 92

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def prepare_ref(path: Path) -> tuple[bytes, str, tuple[int, int]]:
    """Open ref, downscale if larger than MAX_REF_LONG_EDGE, encode as JPEG.

    Returns (bytes, mime, (width, height)).
    """
    img = PILImage.open(path).convert("RGB")
    w, h = img.size
    long_edge = max(w, h)
    if long_edge > MAX_REF_LONG_EDGE:
        scale = MAX_REF_LONG_EDGE / long_edge
        new_size = (round(w * scale), round(h * scale))
        img = img.resize(new_size, PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue(), "image/jpeg", img.size

PROMPT = """Change the entire scene to a clean studio reference sheet, 16:9 aspect ratio, uniform mid neutral gray seamless backdrop around #BFBFBF, no texture, no scratches, no reflections.

Layout: the left half of the frame is a square area divided into a 2x2 grid of four orthographic views of the same brush, each centered in its quadrant, all at identical scale:
- top-left quadrant: front view, bristles pointing right, handle horizontal, PAO logo facing camera
- top-right quadrant: back view, bristles pointing right, handle horizontal, opposite side of the handle (no logo visible)
- bottom-left quadrant: top-down view, looking straight down at the brush laying horizontal, bristles pointing right
- bottom-right quadrant: bottom view, looking straight up from below, bristles pointing right

Thin subtle separator lines between quadrants, same gray tone slightly darker. Each ortho view is flat, no perspective distortion, soft even light from above, minimal contact shadow directly underneath.

The right portion of the frame is a single 3/4 perspective hero shot of the same brush, laying on the same gray surface, slight diagonal tilt left-to-right, bristles pointing upper-right, PAO logo readable on the handle. Soft diffuse key light from upper-left, gentle falloff, soft elongated contact shadow under handle and bristles. Color temperature neutral around 5200K.

Keep the brush exactly as in the source — same handle silhouette, length, matte black finish, PAO logo position and size, ferrule shape, bristle silhouette, fiber gradient (white-to-black tips where present), density, and overall proportions. Studio product-reference style, high fidelity to source brush."""


def _single_call(api_key: str, ref_bytes: bytes, mime: str) -> dict:
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": mime,
                            "data": base64.b64encode(ref_bytes).decode("ascii"),
                        }
                    },
                    {"text": PROMPT},
                ],
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "imageSize": IMAGE_SIZE,
                "aspectRatio": ASPECT_RATIO,
            },
        },
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return {
            "_error": f"HTTP {exc.code}",
            "_code": exc.code,
            "_body": exc.read().decode("utf-8", "replace")[:500],
        }
    except Exception as exc:
        return {"_error": str(exc)[:300]}


def call_image_api(api_key: str, ref_bytes: bytes, mime: str) -> dict:
    """Call the image generation endpoint with retry on transient 5xx / 429."""
    last_resp: dict = {}
    for attempt in range(1, MAX_ATTEMPTS + 1):
        last_resp = _single_call(api_key, ref_bytes, mime)
        code = last_resp.get("_code")
        if code not in RETRY_HTTP_CODES:
            return last_resp
        if attempt == MAX_ATTEMPTS:
            return last_resp
        delay = RETRY_BACKOFF_S[min(attempt - 1, len(RETRY_BACKOFF_S) - 1)]
        print(f"  retry {attempt}/{MAX_ATTEMPTS - 1} after HTTP {code} (wait {delay}s)")
        time.sleep(delay)
    return last_resp


class _Tee:
    """Write to multiple text streams (stdout + log file)."""

    def __init__(self, *streams):
        self._streams = streams

    def write(self, s: str) -> int:
        for st in self._streams:
            st.write(s)
            st.flush()
        return len(s)

    def flush(self) -> None:
        for st in self._streams:
            st.flush()


@contextmanager
def tee_stdout(log_path: Path):
    """Mirror sys.stdout into log_path for the duration of the block."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    original = sys.stdout
    with log_path.open("w", encoding="utf-8", newline="\n") as logf:
        sys.stdout = _Tee(original, logf)
        try:
            yield
        finally:
            sys.stdout = original


def cost_for_response(model_id: str, resp: dict) -> tuple[int, int, float]:
    """Return (input_tokens, output_tokens, cost_usd) from REST usageMetadata."""
    um = resp.get("usageMetadata") or {}
    input_tok = int(um.get("promptTokenCount", 0))
    output_tok = int(um.get("candidatesTokenCount", 0))
    rates = MODEL_PRICING.get(model_id, (0.0, 0.0))
    cost = (input_tok / 1_000_000) * rates[0] + (output_tok / 1_000_000) * rates[1]
    return input_tok, output_tok, round(cost, 6)


def print_cost_table(model_id: str, costs: list[tuple[str, int, int, float]]) -> None:
    if not costs:
        return
    rates = MODEL_PRICING.get(model_id, (0.0, 0.0))
    total_in = sum(c[1] for c in costs)
    total_out = sum(c[2] for c in costs)
    total_cost = sum(c[3] for c in costs)
    print()
    print(f"Cost summary ({model_id} @ ${rates[0]:.2f}/1M in, ${rates[1]:.2f}/1M out):")
    print(f"  {'File':<28}  {'Input tok':>10}  {'Output tok':>11}  {'Cost USD':>10}")
    print(f"  {'-' * 28}  {'-' * 10}  {'-' * 11}  {'-' * 10}")
    for name, inp, out, cost in costs:
        print(f"  {name:<28}  {inp:>10}  {out:>11}  {cost:>10.4f}")
    print(f"  {'-' * 28}  {'-' * 10}  {'-' * 11}  {'-' * 10}")
    print(f"  {'TOTAL':<28}  {total_in:>10}  {total_out:>11}  {total_cost:>10.4f}")


def extract_image_bytes(resp: dict) -> bytes | None:
    cand = resp.get("candidates") or []
    if not cand:
        return None
    parts = cand[0].get("content", {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    return None


def main() -> int:
    api_key = settings.gemini_api_key
    if not api_key:
        print("ERROR: settings.gemini_api_key empty (check .env AYCB_GEMINI_API_KEY)")
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
    log_path = OUTPUT_DIR / f"batch_{started:%Y%m%d_%H%M%S}.log"

    with tee_stdout(log_path):
        print(f"=== Batch run started {started:%Y-%m-%d %H:%M:%S} ===")
        print(f"Model:       {MODEL_ID}")
        print(f"Resolution:  {IMAGE_SIZE} @ {ASPECT_RATIO}")
        print(f"Input dir:   {INPUT_DIR}")
        print(f"Output dir:  {OUTPUT_DIR}")
        print(f"Log file:    {log_path}")
        print(f"Found:       {len(inputs)} image(s)")
        print()
        return _process(inputs, started)


def _process(inputs: list[Path], started: datetime) -> int:
    api_key = settings.gemini_api_key
    successes = 0
    failures: list[tuple[str, str]] = []
    skipped = 0
    costs: list[tuple[str, int, int, float]] = []
    for i, src in enumerate(inputs, 1):
        out_path = OUTPUT_DIR / f"{src.stem}.png"
        print(f"[{i}/{len(inputs)}] {src.name} -> {out_path.name}")

        if out_path.exists():
            print(f"  SKIP — output already exists ({out_path.stat().st_size // 1024} KB)")
            skipped += 1
            continue

        try:
            ref_bytes, mime, ref_size = prepare_ref(src)
        except Exception as exc:
            msg = f"prepare: {exc}"
            print(f"  SKIP — {msg}")
            failures.append((src.name, msg))
            continue

        print(f"  ref: {ref_size[0]}x{ref_size[1]} ({len(ref_bytes)//1024} KB)")
        t0 = time.time()
        resp = call_image_api(api_key, ref_bytes, mime)
        dt = time.time() - t0

        if "_error" in resp:
            err = resp["_error"]
            body = resp.get("_body", "")
            msg = f"{err} {body}".strip()
            print(f"  FAIL — {msg} ({dt:.1f}s)")
            failures.append((src.name, msg))
            continue

        img_bytes = extract_image_bytes(resp)
        if img_bytes is None:
            finish = (resp.get("candidates") or [{}])[0].get("finishReason", "?")
            msg = f"no image returned (finish={finish})"
            print(f"  FAIL — {msg} ({dt:.1f}s)")
            failures.append((src.name, msg))
            continue

        out_path.write_bytes(img_bytes)
        size_kb = len(img_bytes) // 1024
        in_tok, out_tok, cost = cost_for_response(MODEL_ID, resp)
        costs.append((src.name, in_tok, out_tok, cost))
        print(f"  OK   — {size_kb} KB, {in_tok}+{out_tok} tok, ${cost:.4f} ({dt:.1f}s)")
        successes += 1

    ended = datetime.now()
    total_s = (ended - started).total_seconds()
    print()
    print(f"Done: {successes} generated, {skipped} skipped, {len(failures)} failed (of {len(inputs)})")
    if failures:
        print("Failures:")
        for name, err in failures:
            print(f"  - {name}: {err}")
    print_cost_table(MODEL_ID, costs)
    print(f"=== Batch run ended {ended:%Y-%m-%d %H:%M:%S} (total {total_s:.1f}s) ===")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
