# Image Quality Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push Gemini image generation quality to the upstream maximum (thinking HIGH, 14 refs, 0.5K bucket) and stop losing metadata via PIL roundtrip in `_save_to_bridge`.

**Architecture:** Single PR on `dev`. Strict TDD — each task writes a failing test first, then the minimal code to pass it. Backend tasks come first (pure helpers + python code, easy to test in isolation); frontend tasks follow (TypeScript types → provider logic → hook → UI). Final task is the manual visual verification you (Antonio) run yourself.

**Tech Stack:** Python 3.11+, pytest, FastAPI, PIL/Pillow, `google-genai` SDK, React 19, TypeScript 5.9, vitest, `@xyflow/react`.

**Spec:** `docs/superpowers/specs/2026-05-14-image-quality-push-design.md`

---

## Task 1: PNG tEXt chunk injection helper (pure function, TDD)

**Files:**
- Modify: `src/shared.py` — add `_inject_png_text_chunks` near the existing `_save_to_bridge`
- Modify: `tests/test_save_to_bridge.py` — add the three tests below

- [ ] **Step 1: Write the failing test for IDAT preservation**

Add to `tests/test_save_to_bridge.py`:

```python
import io
import struct

from PIL import Image as PILImage

from src.shared import _inject_png_text_chunks


def _make_test_png() -> bytes:
    img = PILImage.new("RGB", (4, 4), "red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _extract_idat(png_bytes: bytes) -> bytes:
    """Concatenate all IDAT chunk payloads for byte-equality comparison."""
    out = b""
    pos = 8  # skip 8-byte PNG signature
    while pos + 12 <= len(png_bytes):
        (length,) = struct.unpack(">I", png_bytes[pos:pos + 4])
        chunk_type = png_bytes[pos + 4:pos + 8]
        if chunk_type == b"IDAT":
            out += png_bytes[pos + 8:pos + 8 + length]
        if chunk_type == b"IEND":
            break
        pos += 12 + length
    return out


def test_inject_png_text_preserves_idat():
    original = _make_test_png()
    enriched = _inject_png_text_chunks(original, {"prompt": "test", "cost_usd": "0.05"})
    assert _extract_idat(original) == _extract_idat(enriched)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_save_to_bridge.py::test_inject_png_text_preserves_idat -v`
Expected: FAIL with `ImportError: cannot import name '_inject_png_text_chunks' from 'src.shared'`

- [ ] **Step 3: Implement `_inject_png_text_chunks` in `src/shared.py`**

Add this function in `src/shared.py` immediately above `_save_to_bridge` (around line 263). Include `import zlib` at the top of the module if not already present (`struct` is already imported indirectly; add it explicitly):

```python
def _inject_png_text_chunks(png_bytes: bytes, meta: dict[str, str]) -> bytes:
    """Inject tEXt chunks before IEND without re-encoding pixels.

    PNG layout: 8-byte signature + N chunks + IEND.
    Each chunk: 4-byte length + 4-byte type + data + 4-byte CRC.
    tEXt chunks carry `keyword(1-79 Latin-1 bytes) + 0x00 + Latin-1 text`.

    Returns the input bytes unchanged on parse failure so the save path
    never breaks on a malformed PNG.
    """
    import struct
    import zlib

    PNG_SIG = b"\x89PNG\r\n\x1a\n"
    if not png_bytes.startswith(PNG_SIG):
        return png_bytes

    iend_marker = b"IEND"
    iend_pos = png_bytes.rfind(iend_marker)
    if iend_pos < 0:
        return png_bytes
    # tEXt chunks must go before the IEND chunk's length field (4 bytes before "IEND")
    insert_pos = iend_pos - 4
    if insert_pos < 8:
        return png_bytes

    extra = b""
    for key, value in meta.items():
        keyword = str(key).encode("latin-1", errors="replace")[:79]
        text = str(value).encode("latin-1", errors="replace")
        data = keyword + b"\x00" + text
        chunk_type = b"tEXt"
        length_bytes = struct.pack(">I", len(data))
        crc_bytes = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        extra += length_bytes + chunk_type + data + crc_bytes

    return png_bytes[:insert_pos] + extra + png_bytes[insert_pos:]
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `python -m pytest tests/test_save_to_bridge.py::test_inject_png_text_preserves_idat -v`
Expected: PASS

- [ ] **Step 5: Add round-trip + malformed tests**

Append to `tests/test_save_to_bridge.py`:

```python
def test_inject_png_text_round_trip_meta():
    original = _make_test_png()
    meta = {"prompt": "una vista alpina", "model": "gemini-3-pro-image-preview", "cost_usd": "0.134"}
    enriched = _inject_png_text_chunks(original, meta)
    reloaded = PILImage.open(io.BytesIO(enriched))
    info = dict(reloaded.info)
    reloaded.close()
    for k, v in meta.items():
        assert info.get(k) == v, f"meta key {k!r} did not round-trip"


def test_inject_png_text_malformed_returns_unchanged():
    junk = b"definitely not a PNG"
    assert _inject_png_text_chunks(junk, {"prompt": "x"}) == junk
```

- [ ] **Step 6: Run all three tests**

Run: `python -m pytest tests/test_save_to_bridge.py -v -k inject_png_text`
Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add src/shared.py tests/test_save_to_bridge.py
git commit -m "[feat] shared — _inject_png_text_chunks helper for byte-perfect PNG meta"
```

---

## Task 2: `_save_to_bridge` byte-perfect refactor

**Files:**
- Modify: `src/shared.py:264-311` (`_save_to_bridge`)
- Modify: `tests/test_save_to_bridge.py` — add sidecar + byte-perfect tests

- [ ] **Step 1: Write the failing test for sidecar + byte-perfect save**

Append to `tests/test_save_to_bridge.py`:

```python
import json
from pathlib import Path

import pytest

from src.shared import _save_to_bridge
from config.settings import settings


def test_save_to_bridge_writes_sidecar_and_preserves_idat(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "media_dir", tmp_path)
    original = _make_test_png()
    result = _save_to_bridge(
        img_bytes=original,
        prompt="vista alpina",
        model="gemini-3-pro-image-preview",
        model_name="Nano Banana Pro",
        aspect_ratio="16:9",
        image_size="2K",
        cost_usd=0.134,
        project_name="testproj",
    )
    assert result is not None
    assert result["status"] == "ok"
    png_path = tmp_path / "testproj" / result["path"]
    json_path = png_path.with_suffix("").with_suffix(".meta.json")
    # JSON sidecar exists with full meta
    assert json_path.exists(), f"sidecar not written at {json_path}"
    sidecar = json.loads(json_path.read_text(encoding="utf-8"))
    assert sidecar["prompt"] == "vista alpina"
    assert sidecar["model"] == "gemini-3-pro-image-preview"
    assert sidecar["cost_usd"] == 0.134
    # PNG IDAT bytes are unchanged from the original Gemini output
    saved_bytes = png_path.read_bytes()
    assert _extract_idat(saved_bytes) == _extract_idat(original)
    # tEXt chunks are present (backward-compat reader path)
    reloaded = PILImage.open(png_path)
    info = dict(reloaded.info)
    reloaded.close()
    assert info.get("prompt") == "vista alpina"
    assert info.get("source") == "aycb"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_save_to_bridge.py::test_save_to_bridge_writes_sidecar_and_preserves_idat -v`
Expected: FAIL (no sidecar written, or IDAT mismatch because PIL re-encodes)

- [ ] **Step 3: Refactor `_save_to_bridge`**

Open `src/shared.py` and replace the existing `_save_to_bridge` body (lines 264-311) with:

```python
def _save_to_bridge(
    img_bytes: bytes | None = None,
    prompt: str = "",
    model: str = "",
    model_name: str = "",
    aspect_ratio: str = "",
    image_size: str = "",
    cost_usd: float = 0.0,
    project_name: str = "",
    pil_image: PILImage.Image | None = None,
) -> dict | None:
    """Save image with embedded PNG tEXt metadata + sidecar .meta.json to shared/Media/.

    img_bytes path: byte-perfect — inject tEXt chunks into the raw Gemini bytes,
    write a sidecar JSON, never decode the pixels.
    pil_image path (legacy fallback, hit only when /api/generate/image runs
    server-side via gemini.py PIL flow): re-encode through PIL + sidecar JSON.
    """
    try:
        target_dir, stem, generated_at = _resolve_bridge_target(project_name, "generated")
        folder = target_dir.name
        img_path = target_dir / f"{stem}.png"

        meta = {
            "source": "aycb",
            "project": project_name.strip() or None,
            "prompt": prompt,
            "model": model,
            "model_name": model_name,
            "aspect_ratio": aspect_ratio,
            "image_size": image_size,
            "cost_usd": cost_usd,
            "generated_at": generated_at,
        }

        # Always write the JSON sidecar — single forward-compatible reader path.
        sidecar_path = target_dir / f"{stem}.meta.json"
        sidecar_path.write_text(
            json.dumps(meta, indent=2),
            encoding="utf-8",
            newline="\n",
        )

        if img_bytes is not None:
            # Byte-perfect path: inject tEXt chunks without re-encoding pixels.
            text_meta = {k: str(v) for k, v in meta.items() if v is not None}
            enriched = _inject_png_text_chunks(img_bytes, text_meta)
            img_path.write_bytes(enriched)
            _log(f"Review Hub bridge — saved {folder}/{img_path.name} byte-perfect + sidecar")
            return {"status": "ok", "path": str(img_path.name), "stem": stem, "folder": folder}

        if pil_image is not None:
            # Legacy PIL path (server-side generation): pixel-lossless but re-encoded.
            png_info = PngInfo()
            for k, v in meta.items():
                if v is not None:
                    png_info.add_text(k, str(v))
            pil_image.save(str(img_path), format="PNG", pnginfo=png_info)
            _log(f"Review Hub bridge — saved {folder}/{img_path.name} via PIL + sidecar")
            return {"status": "ok", "path": str(img_path.name), "stem": stem, "folder": folder}

        _log("Review Hub bridge — error: no image data provided")
        return None
    except Exception as e:
        _log(f"Review Hub bridge — error: {e}")
        return None
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_save_to_bridge.py::test_save_to_bridge_writes_sidecar_and_preserves_idat -v`
Expected: PASS

- [ ] **Step 5: Run the full existing `test_save_to_bridge.py` suite**

Run: `python -m pytest tests/test_save_to_bridge.py -v`
Expected: all tests pass (existing tests should still cover the PIL path; new tests cover img_bytes path)

- [ ] **Step 6: Commit**

```bash
git add src/shared.py tests/test_save_to_bridge.py
git commit -m "[feat] shared — _save_to_bridge byte-perfect + sidecar JSON"
```

---

## Task 3: `generate_image()` accepts thinking + 0.5K + 14 refs

**Files:**
- Modify: `src/gemini.py:289-359` (`generate_image`)
- Create: `tests/test_gemini_image.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_gemini_image.py`:

```python
"""Verify generate_image() passes thinkingConfig + 0.5K mapping + 14-ref cap."""
from unittest.mock import MagicMock, patch

import pytest

from src import gemini


def _fake_inline_response(b64_png: bytes = b"\x89PNG\r\n\x1a\n"):
    part = MagicMock()
    part.inline_data = MagicMock()
    part.inline_data.data = b64_png
    candidate = MagicMock()
    candidate.content.parts = [part]
    candidate.finish_reason = None
    response = MagicMock()
    response.candidates = [candidate]
    response.usage_metadata = None
    return response


def test_generate_image_passes_thinking_config_by_default():
    captured = {}

    def fake_call(call, operation):
        captured["call_kwargs"] = call.__closure__[2].cell_contents if call.__closure__ else None
        return _fake_inline_response(), None

    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        mock_client.return_value = MagicMock()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        # Make the inner SDK call introspectable
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()

        gemini.generate_image(prompt="hello", api_key="fake-key")

        kwargs = sdk.models.generate_content.call_args.kwargs
        config = kwargs["config"]
        thinking = getattr(config, "thinking_config", None)
        assert thinking is not None, "thinking_config should be set by default"
        assert thinking.thinking_level == "HIGH"
        assert thinking.include_thoughts is True


def test_generate_image_thinking_false_skips_config():
    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", api_key="fake-key", thinking=False)

        config = sdk.models.generate_content.call_args.kwargs["config"]
        assert getattr(config, "thinking_config", None) is None


def test_generate_image_maps_0_5k_to_512():
    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", api_key="fake-key", image_size="0.5K")

        config = sdk.models.generate_content.call_args.kwargs["config"]
        assert config.image_config.image_size == "512"


def test_generate_image_accepts_14_refs():
    from PIL import Image as PILImage
    refs = [PILImage.new("RGB", (2, 2), "red") for _ in range(14)]

    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", reference_images=refs, api_key="fake-key")

        contents = sdk.models.generate_content.call_args.kwargs["contents"]
        # contents = refs (14 PIL images) + 1 prompt string
        assert len(contents) == 15
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_gemini_image.py -v`
Expected: 4 tests FAIL (thinking not passed, 0.5K not mapped, only 8 refs accepted)

- [ ] **Step 3: Modify `generate_image()` in `src/gemini.py`**

Replace the signature and body of `generate_image` (lines 292-359) with:

```python
def generate_image(
    prompt: str,
    reference_images: list[Image.Image] | None = None,
    model_id: str | None = None,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    api_key: str | None = None,
    use_grounding: bool = False,
    thinking: bool = True,
) -> Image.Image | None:
    """Generate an image using Gemini generateContent with IMAGE modality."""
    from google.genai import types

    client = _get_client(api_key)
    use_model = model_id or NANO_BANANA_MODEL

    contents: list = []
    if reference_images:
        contents.extend(reference_images[:14])
    contents.append(prompt)

    # Map 0.5K → 512 (SDK expects literal "512"); other buckets pass through.
    mapped_size = "512" if image_size == "0.5K" else image_size

    image_cfg: dict = {}
    if aspect_ratio:
        image_cfg["aspect_ratio"] = aspect_ratio
    if mapped_size:
        image_cfg["image_size"] = mapped_size
    image_config = types.ImageConfig(**image_cfg) if image_cfg else None

    modalities = ["TEXT", "IMAGE"] if use_grounding else ["IMAGE"]

    config_kwargs: dict = {}
    if image_config:
        config_kwargs["image_config"] = image_config
    if use_grounding:
        config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
    if thinking:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            include_thoughts=True, thinking_level="HIGH",
        )

    response, _usage = _call_with_gemini_retries(
        lambda: client.models.generate_content(
            model=use_model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=modalities,
                **config_kwargs,
            ),
        ),
        operation="generate_image",
    )

    if not response.candidates:
        reason = getattr(response, "prompt_feedback", None)
        raise RuntimeError(f"Image generation blocked by API. Feedback: {reason}")

    candidate = response.candidates[0]
    finish = getattr(candidate, "finish_reason", None)
    parts = getattr(candidate.content, "parts", None) or []

    for part in parts:
        if part.inline_data is not None:
            return Image.open(io.BytesIO(part.inline_data.data))

    text_parts = [p.text for p in parts if hasattr(p, "text") and p.text]
    diag = f"finish_reason={finish}"
    if text_parts:
        diag += f", model replied: {text_parts[0][:200]}"
    raise RuntimeError(f"No image generated ({diag}). Try a shorter, descriptive prompt instead of raw JSON.")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_gemini_image.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/gemini.py tests/test_gemini_image.py
git commit -m "[feat] gemini — thinkingConfig HIGH, 0.5K→512, ref cap 14"
```

---

## Task 4: `/api/generate/image` router accepts `thinking`, lifts ref cap to 14

**Files:**
- Modify: `src/routers/generate.py:28-89` (`generate_image_endpoint`)
- Create: `tests/test_routers_generate.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_routers_generate.py`:

```python
"""Verify /api/generate/image forwards thinking + lifts ref cap to 14."""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from PIL import Image as PILImage
import io

from src.api import app


client = TestClient(app)


def _fake_pil():
    return PILImage.new("RGB", (4, 4), "red")


def test_generate_image_default_thinking_true():
    with patch("src.gemini.generate_image", return_value=_fake_pil()) as mock_gen, \
         patch("src.gemini.get_last_usage", return_value=None), \
         patch("src.shared._save_to_bridge", return_value={"stem": "generated_1"}):
        resp = client.post(
            "/api/generate/image",
            data={"prompt": "test", "api_key": "fake", "model": "gemini-3-pro-image-preview"},
        )
        assert resp.status_code == 200
        assert mock_gen.call_args.kwargs["thinking"] is True


def test_generate_image_thinking_false_when_param_false():
    with patch("src.gemini.generate_image", return_value=_fake_pil()) as mock_gen, \
         patch("src.gemini.get_last_usage", return_value=None), \
         patch("src.shared._save_to_bridge", return_value={"stem": "generated_1"}):
        resp = client.post(
            "/api/generate/image",
            data={
                "prompt": "test", "api_key": "fake",
                "model": "gemini-3-pro-image-preview", "thinking": "false",
            },
        )
        assert resp.status_code == 200
        assert mock_gen.call_args.kwargs["thinking"] is False


def test_generate_image_accepts_up_to_14_refs():
    """Backend should slice ref_images to 14, not 8."""
    files = []
    for i in range(20):  # send more than 14 to verify cap
        buf = io.BytesIO()
        PILImage.new("RGB", (2, 2), "red").save(buf, format="PNG")
        files.append(("ref_images", (f"ref{i}.png", buf.getvalue(), "image/png")))
    with patch("src.gemini.generate_image", return_value=_fake_pil()) as mock_gen, \
         patch("src.gemini.get_last_usage", return_value=None), \
         patch("src.shared._save_to_bridge", return_value={"stem": "generated_1"}):
        resp = client.post(
            "/api/generate/image",
            data={"prompt": "test", "api_key": "fake", "model": "gemini-3-pro-image-preview"},
            files=files,
        )
        assert resp.status_code == 200
        refs_passed = mock_gen.call_args.kwargs["reference_images"] or mock_gen.call_args.args[1]
        assert len(refs_passed) == 14
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_routers_generate.py -v`
Expected: 3 tests FAIL (no `thinking` param forwarded, ref cap is 8)

- [ ] **Step 3: Modify `generate_image_endpoint` in `src/routers/generate.py`**

Replace lines 28-89 with:

```python
@router.post("/image")
async def generate_image_endpoint(
    prompt: str = Form(...),
    api_key: str = Form(""),
    model: str = Form("Gemini 3.1 Flash Image"),
    aspect_ratio: str = Form(""),
    image_size: str = Form(""),
    project_name: str = Form(""),
    use_grounding: str = Form(""),
    thinking: str = Form("true"),
    ref_images: list[UploadFile] | None = File(default=None),
):
    from src.gemini import generate_image, get_last_usage

    clean_prompt = _require_prompt(prompt)
    effective_key = _require_key(api_key, "gemini")

    pil_refs: list[PILImage.Image] = []
    if ref_images:
        for f in ref_images[:14]:
            _validate_image_upload(f)
            raw = await _read_upload(f, MAX_IMAGE_BYTES, "Reference image")
            pil_refs.append(PILImage.open(io.BytesIO(raw)).convert("RGB"))

    grounding = use_grounding.lower() in ("true", "1", "yes")
    thinking_bool = thinking.lower() in ("true", "1", "yes")
    model_id = IMAGE_MODELS.get(model, model)
    _log(
        f"Generate image — model={model} ({model_id}), {len(pil_refs)} refs, "
        f"grounding={grounding}, thinking={thinking_bool}, prompt={clean_prompt[:80]}..."
    )
    t0 = time.time()
    try:
        result = await asyncio.to_thread(
            generate_image, clean_prompt, pil_refs if pil_refs else None, model_id,
            aspect_ratio=aspect_ratio or None, image_size=image_size or None,
            api_key=effective_key, use_grounding=grounding,
            thinking=thinking_bool,
        )
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Image generation FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)

    usage = get_last_usage()
    cost = _estimate_cost(model_id, usage)

    dt = time.time() - t0
    if result is None:
        _log(f"Image generation — no image returned, model={model} ({dt:.1f}s)")
        return {"image_b64": None, "status": "No image generated", "usage": cost}

    bridge_result = _save_to_bridge(
        pil_image=result,
        prompt=clean_prompt,
        model=model_id,
        model_name=model,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
        cost_usd=cost.get("cost_usd", 0.0) if cost else 0.0,
        project_name=project_name,
    )
    bridge_stem = bridge_result.get("stem") if bridge_result else None

    _log(f"Image generated — model={model} ({dt:.1f}s)")
    return {"image_b64": _pil_to_b64(result), "status": "OK", "usage": cost, "bridge_stem": bridge_stem}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_routers_generate.py -v`
Expected: 3 passed

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `python -m pytest`
Expected: all tests pass (~98 + 4 new gemini_image + 3 new routers_generate + 3 new inject_png + 1 new save_to_bridge ≈ 109)

- [ ] **Step 6: Commit**

```bash
git add src/routers/generate.py tests/test_routers_generate.py
git commit -m "[feat] routers/generate — thinking param + ref cap 14"
```

---

## Task 5: `ImageGenerationOptions.thinking` type

**Files:**
- Modify: `frontend/src/providers/index.ts`

- [ ] **Step 1: Locate the interface**

Run: `Grep "interface ImageGenerationOptions" frontend/src/providers/index.ts`
Expected: one match. Confirm the file path and line.

- [ ] **Step 2: Add the field**

Open `frontend/src/providers/index.ts` and add `thinking?: boolean` to the `ImageGenerationOptions` interface. Keep the existing fields and order; add the new field at the end with a one-line comment:

```ts
export interface ImageGenerationOptions {
  aspectRatio?: string
  imageSize?: string
  useGrounding?: boolean
  /** When undefined or true, the provider passes thinkingConfig HIGH (Gemini only). */
  thinking?: boolean
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors (existing providers don't reference the new field yet, optional)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/providers/index.ts
git commit -m "[feat] providers — ImageGenerationOptions.thinking field"
```

---

## Task 6: `geminiProvider.ts` adds thinkingConfig + 0.5K mapping

**Files:**
- Modify: `frontend/src/providers/geminiProvider.ts:76-142`
- Create: `frontend/src/providers/geminiProvider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/providers/geminiProvider.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const generateContent = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent },
  })),
}))

// Re-import after mocks are set
async function getProvider() {
  await import('./geminiProvider')
  const { getImageProvider } = await import('./index')
  const provider = getImageProvider('gemini')
  if (!provider) throw new Error('gemini provider not registered')
  return provider
}

afterEach(() => {
  generateContent.mockReset()
})

function fakeImageResponse() {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: 'AAA=', mimeType: 'image/png' } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100 },
  }
}

describe('geminiImageProvider', () => {
  it('includes thinkingConfig HIGH by default', async () => {
    generateContent.mockResolvedValue(fakeImageResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key')
    const config = generateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'HIGH',
    })
  })

  it('omits thinkingConfig when options.thinking === false', async () => {
    generateContent.mockResolvedValue(fakeImageResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key', undefined, { thinking: false })
    const config = generateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toBeUndefined()
  })

  it('maps imageSize "0.5K" to "512" in the SDK config', async () => {
    generateContent.mockResolvedValue(fakeImageResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { imageSize: '0.5K' })
    const config = generateContent.mock.calls[0][0].config
    expect(config.imageConfig.imageSize).toBe('512')
  })

  it('passes imageSize "4K" through unchanged', async () => {
    generateContent.mockResolvedValue(fakeImageResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key', undefined, { imageSize: '4K' })
    const config = generateContent.mock.calls[0][0].config
    expect(config.imageConfig.imageSize).toBe('4K')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/providers/geminiProvider.test.ts`
Expected: 4 tests FAIL (no thinkingConfig, no 0.5K mapping)

- [ ] **Step 3: Modify `geminiImageProvider` in `frontend/src/providers/geminiProvider.ts`**

Replace lines 76-142 (the `geminiImageProvider` block) with:

```ts
const geminiImageProvider: ImageProvider = {
  id: 'gemini',
  async generateImage(prompt: string, modelNameOrId: string, apiKey: string, refs?: File[], options?: ImageGenerationOptions): Promise<GenerateImageResult> {
    const ai = new GoogleGenAI({ apiKey })
    const modelId = resolveModel(modelNameOrId)

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ]

    if (refs) {
      for (const ref of refs) {
        const b64 = await fileToBase64(ref)
        parts.push({ inlineData: { mimeType: ref.type || 'image/png', data: b64 } })
      }
    }

    // Map 0.5K → 512 (SDK literal); other buckets pass through.
    const mappedSize = options?.imageSize === '0.5K' ? '512' : options?.imageSize

    const imageConfig: Record<string, string> = {}
    if (options?.aspectRatio) imageConfig.aspectRatio = options.aspectRatio
    if (mappedSize) imageConfig.imageSize = mappedSize

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {
      responseModalities: ['IMAGE', 'TEXT'],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    }
    if (options?.useGrounding) {
      config.tools = [{
        googleSearch: {
          searchTypes: {
            webSearch: {},
            imageSearch: {},
          },
        },
      }]
    }
    if (options?.thinking !== false) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: 'HIGH',
      }
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts }],
      config,
    })

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
    const costUsd = computeGeminiCost(modelId, inputTokens, outputTokens)
    const usage: UsageInfo | undefined = response.usageMetadata
      ? { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd }
      : undefined

    const candidate = response.candidates?.[0]
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          return { image_b64: part.inlineData.data, status: 'OK', usage }
        }
      }
    }
    return { image_b64: null, status: 'No image generated', usage }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/providers/geminiProvider.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/providers/geminiProvider.ts frontend/src/providers/geminiProvider.test.ts
git commit -m "[feat] geminiProvider — thinkingConfig HIGH default, 0.5K→512 mapping"
```

---

## Task 7: `costEstimate.ts` adds 0.5K + thinking ×1.3 multiplier

**Files:**
- Modify: `frontend/src/utils/costEstimate.ts:108-142`
- Create: `frontend/src/utils/costEstimate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/utils/costEstimate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { estimateCost } from './costEstimate'

describe('estimateCost — Gemini image quality push additions', () => {
  it('returns 0.045 for Flash 0.5K', () => {
    const result = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'short', 0, 0, 1, '0.5K')
    expect(result.costUsd).toBeCloseTo(0.045, 3)
  })

  it('preserves existing 1K Flash cost (0.067) when thinking=false', () => {
    const result = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'short', 0, 0, 1, '1K', false)
    expect(result.costUsd).toBeCloseTo(0.067, 3)
  })

  it('applies thinking ×1.3 multiplier on Pro 4K', () => {
    const base = estimateCost('gemini-3-pro-image-preview', 'generate_image', 'short', 0, 0, 1, '4K', false)
    const withThinking = estimateCost('gemini-3-pro-image-preview', 'generate_image', 'short', 0, 0, 1, '4K', true)
    expect(base.costUsd).toBeCloseTo(0.240, 3)
    expect(withThinking.costUsd).toBeCloseTo(0.240 * 1.3, 3)
  })

  it('applies thinking ×1.3 on Flash 0.5K too', () => {
    const withThinking = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'short', 0, 0, 1, '0.5K', true)
    expect(withThinking.costUsd).toBeCloseTo(0.045 * 1.3, 3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/utils/costEstimate.test.ts`
Expected: 4 tests FAIL (no 0.5K mapping, no thinking parameter)

- [ ] **Step 3: Add 0.5K to the Flash bucket**

Open `frontend/src/utils/costEstimate.ts`. Find line 110 (Flash entry inside `FIXED_IMAGE_COST`) and add `'0.5K': 0.045`:

```ts
'gemini-3.1-flash-image-preview': { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151, '': 0.067 },
```

- [ ] **Step 4: Add the `thinking` parameter and ×1.3 multiplier**

In the same file, change the `estimateCost` signature (line 86-94) to add an 8th parameter and apply the multiplier inside the `generate_image` branch.

Replace the signature block:

```ts
export function estimateCost(
  modelId: string,
  operation: string,
  promptText: string = '',
  imageCount: number = 0,
  videoDurationSec: number = 0,
  nFrames: number = 1,
  resolution: string = '',
  thinking: boolean = false,
): CostEstimate {
```

And replace the final `return` of the `generate_image` branch (line 140) with:

```ts
      const rawCost = imgCost + inputRefCost
      const thinkingFactor = thinking ? 1.3 : 1
      return { inputTokens: imageCount * 560, outputTokens: 0, costUsd: rawCost * thinkingFactor, model: modelId }
```

The multiplier only affects the **pre-flight estimate** shown on the node. The real cost arrives back from Gemini in `usage_metadata` and overrides the estimate via `setLastCost(actualUsage?.cost_usd ?? fallback.costUsd)` (see `useGenerateImage.ts:524`). No double-counting.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/utils/costEstimate.test.ts`
Expected: 4 passed

- [ ] **Step 6: Verify no other call-sites break from the new param**

Run: `cd frontend && npx tsc --noEmit`
Expected: zero errors (the 8th param is optional with default `false`, so existing call-sites are unaffected)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/costEstimate.ts frontend/src/utils/costEstimate.test.ts
git commit -m "[feat] costEstimate — 0.5K Flash bucket + thinking ×1.3 pre-flight multiplier"
```

---

## Task 8: `useGenerateImage.ts` MAX_REFS=14, thinking state, 0.5K resolution

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts`

- [ ] **Step 1: Update `MAX_REFS`**

Open `frontend/src/nodes/generate-image/useGenerateImage.ts`. Find `const MAX_REFS = 8` (line 117) and change to:

```ts
const MAX_REFS = 14
```

- [ ] **Step 2: Add `0.5K` to `RESOLUTIONS`**

Find the `RESOLUTIONS` constant (lines 109-115) and insert `0.5K` after `Auto`:

```ts
export const RESOLUTIONS = [
  { value: '', label: 'Auto' },
  { value: '0.5K', label: '0.5K' },
  { value: '1K', label: '1K' },
  { value: 'FHD', label: 'FHD' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]
```

- [ ] **Step 3: Add the `thinking` state via `useStateRef`**

Find the `editMode` `useStateRef` declaration (around line 157-159) and add directly after it:

```ts
const [thinking, setThinking, thinkingRef] = useStateRef(
  typeof (data as Record<string, unknown>).thinking === 'boolean'
    ? (data as Record<string, unknown>).thinking as boolean
    : true,
)
```

- [ ] **Step 4: Add the reset effect for 0.5K when leaving Flash**

Add a new `useEffect` immediately after the existing FHD reset effect (around line 310-315):

```ts
// 0.5K is Flash-only (gemini-3.1-flash-image-preview). Reset to Auto if
// the model changes off Flash while 0.5K was selected.
useEffect(() => {
  if (resolution !== '0.5K') return
  if (modelInfo.id === 'gemini-3.1-flash-image-preview') return
  setResolution('')
  updateNodeData(id, { resolution: '' })
}, [selectedModel, modelInfo.id]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Pass `thinking` through `imageOptions` in `runSingle`**

Find the `imageOptions` construction (around line 458-462) and extend it:

```ts
const imageOptions = {
  ...(currentAspectRatio ? { aspectRatio: currentAspectRatio } : {}),
  ...(currentResolution ? { imageSize: currentResolution } : {}),
  ...(groundingRef.current ? { useGrounding: true } : {}),
  ...(thinkingRef.current === false ? { thinking: false } : {}),
}
```

(Default-true behaviour: only send `thinking: false` when the user explicitly turned it off; the provider treats `undefined` as ON.)

- [ ] **Step 6: Export `thinking` and `setThinking` from the hook**

Find the return statement (around line 585-626) and add to the state-export block:

```ts
    // existing fields…
    thinking, setThinking,
```

(insert immediately after `editMode, setEditMode,`)

- [ ] **Step 7: Pass `thinking` into `estimateCost`**

Find the `estimateCost` call (around line 404):

```ts
const estimate = estimateCost(selectedModel, 'generate_image', promptForEstimate, connectedImageCount + editRefCount, 0, 1, resolution)
```

Change to:

```ts
const estimate = estimateCost(selectedModel, 'generate_image', promptForEstimate, connectedImageCount + editRefCount, 0, 1, resolution, thinking)
```

Also find the fallback estimate call inside `runSingle` (around line 523):

```ts
const fallback = estimateCost(selectedModel, 'generate_image', rawPrompt, refs.length, 0, 1, currentResolution)
```

Change to:

```ts
const fallback = estimateCost(selectedModel, 'generate_image', rawPrompt, refs.length, 0, 1, currentResolution, thinkingRef.current)
```

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 9: Run the existing hook tests**

Run: `cd frontend && npx vitest run src/nodes/generate-image`
Expected: all existing tests still pass

- [ ] **Step 10: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts
git commit -m "[feat] useGenerateImage — MAX_REFS=14, thinking state, 0.5K resolution"
```

---

## Task 9: `GenerateImageNode.tsx` THK button + 0.5K dropdown filter

**Files:**
- Modify: `frontend/src/nodes/generate-image/GenerateImageNode.tsx`
- Modify: `frontend/src/nodes/generate-image/generate-image.test.ts`

- [ ] **Step 1: Add THK button next to GND**

Open `frontend/src/nodes/generate-image/GenerateImageNode.tsx`. Find the GND button block (lines 88-94) and add a sibling THK button immediately after it:

```tsx
{h.modelInfo.provider === 'gemini' && (
  <button
    className={`${styles.batchBtn} ${h.thinking ? styles.batchBtnActive : ''}`}
    onClick={() => { h.setThinking(!h.thinking); h.updateNodeData(id, { thinking: !h.thinking }) }}
    title="Thinking HIGH — composition refinement on, costo +"
  >THK</button>
)}
```

- [ ] **Step 2: Filter 0.5K for Flash only**

Find the resolution dropdown block (lines 71-78) and extend the `filter`:

```tsx
<select className={styles.selectSmall} value={h.resolution}
  onChange={e => { h.markManualOverride(); h.setResolution(e.target.value); h.updateNodeData(id, { resolution: e.target.value }) }}
  title="Resolution">
  {RESOLUTIONS
    .filter(r => r.value !== 'FHD' || h.modelInfo.provider === 'openai')
    .filter(r => r.value !== '0.5K' || h.modelInfo.id === 'gemini-3.1-flash-image-preview')
    .map(r => <option key={r.value} value={r.value}>{r.label}</option>)
  }
</select>
```

- [ ] **Step 3: Add the manifest test**

Open `frontend/src/nodes/generate-image/generate-image.test.ts`. Append:

```ts
describe('generate-image node integration', () => {
  it('exposes thinking and setThinking from the hook', async () => {
    // Sanity check that the useGenerateImage return shape contains the new fields.
    const mod = await import('./useGenerateImage')
    const hookFnSource = mod.useGenerateImage.toString()
    expect(hookFnSource).toContain('thinking')
    expect(hookFnSource).toContain('setThinking')
  })

  it('RESOLUTIONS includes 0.5K', async () => {
    const { RESOLUTIONS } = await import('./useGenerateImage')
    expect(RESOLUTIONS.some(r => r.value === '0.5K')).toBe(true)
  })
})
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/nodes/generate-image/generate-image.test.ts`
Expected: all existing tests pass + 2 new tests pass

- [ ] **Step 5: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (~350 + new tests ≈ 360)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/nodes/generate-image/GenerateImageNode.tsx frontend/src/nodes/generate-image/generate-image.test.ts
git commit -m "[feat] GenerateImageNode — THK button + 0.5K dropdown filter"
```

---

## Task 10: Full-suite verification + manual visual check

**Files:** none — runs only

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest`
Expected: all tests pass, no skipped or failed cases related to this work

- [ ] **Step 2: Full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass

- [ ] **Step 3: TypeScript clean**

Run: `cd frontend && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Manual visual check — Pro Image with THK ON vs OFF**

1. Start backend (`python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload`) and frontend (`cd frontend && npm run dev`).
2. Open `http://localhost:5100`.
3. Drop a Generate Image node, select `Nano Banana Pro`, AR `16:9`, Res `4K`, THK active (default).
4. Prompt: `"Cinematic close-up of a vintage Maserati grille, golden hour light, sharp chrome, depth of field"`. Run.
5. Save the output.
6. Click THK to turn it OFF. Re-run the same prompt (use Edit-off, fresh generation).
7. Compare both 4K images side-by-side: detail on the grille chrome, light gradient on the body, text/logo crispness if visible.
8. **Expected:** THK ON shows visibly more detail in fine textures and material specularity. If both look identical, the thinkingConfig isn't being passed — re-check Tasks 3/6 in the Network panel (request to Google should carry `thinkingConfig` in the JSON body).

- [ ] **Step 5: Manual visual check — Flash 0.5K bucket**

1. Switch model to `Nano Banana 2`. Change Res dropdown — it should now offer `0.5K` (it should be hidden when you switch back to Pro).
2. Generate the same prompt at `0.5K`.
3. Expected: image is ~512px on the long edge, cost shows ~`$0.045`.

- [ ] **Step 6: Manual visual check — byte-perfect save**

1. After Step 4, locate the bridge file on disk: `C:\Users\upper\Documents\shared\Media\<project>\generated_<ts>.png`.
2. Run in PowerShell:
   ```powershell
   Get-FileHash "C:\Users\upper\Documents\shared\Media\<project>\generated_<ts>.png" -Algorithm SHA256
   ```
3. Verify a `generated_<ts>.meta.json` sidecar exists in the same folder with the prompt/model/cost.
4. Open the PNG with `python -c "from PIL import Image; img = Image.open('<path>'); print(img.info)"` — expect tEXt chunks with `prompt`, `model`, `source=aycb`.

- [ ] **Step 7: Final commit (only if any of Steps 4-6 prompted a fix)**

If no fixes were needed, skip. Otherwise commit individually per affected file with `[fix]` prefix and a description.

- [ ] **Step 8: Summary report**

Run `git log dev ^origin/dev --oneline` and confirm 9 commits ahead (one per Tasks 1-9) plus the spec commit from earlier. Report green status.

---

## Implementation Notes for the Engineer

- **`useStateRef`** is the project's custom helper at `frontend/src/hooks/useStateRef.ts` — fused useState/useRef. Pattern: `const [val, setVal, valRef] = useStateRef(initial)`. Use `valRef.current` in callbacks that outlive a single render (like `runSingle`).
- **`updateNodeData(id, { thinking: ... })`** persists the value to the React Flow node data, so it survives reload from disk.
- The Gemini SDK accepts `thinkingConfig` as a plain object in the frontend call (matches the REST schema) but expects `types.ThinkingConfig` on the backend (Python SDK).
- When mocking `GoogleGenAI` in vitest, the mock must be hoisted via `vi.mock(...)` at the top of the file; the `import('./geminiProvider')` must come **after** the mock is set.
- For PIL-roundtrip tests, build a fresh 4×4 PNG with `PILImage.new("RGB", (4, 4), "red")` — small enough to compare byte-for-byte cheaply.
- Always rebase before committing if more than 30 min has passed (project velocity is high; merge conflicts on `dev` are rare but real).
