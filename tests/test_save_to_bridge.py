"""Tests for _save_to_bridge — image saving with PNG tEXt metadata."""
import io
import pytest
import struct
import time
from pathlib import Path
from PIL import Image


@pytest.fixture
def media_root(tmp_path, monkeypatch):
    """Point settings.shared_root at tmp_path so media_dir = tmp_path/Media."""
    from config.settings import settings
    monkeypatch.setattr(settings, "shared_root", tmp_path)
    return tmp_path / "Media"


def test_save_to_bridge_with_bytes(media_root):
    from src.shared import _save_to_bridge
    from io import BytesIO
    buf = BytesIO()
    Image.new("RGB", (100, 100), "red").save(buf, format="PNG")
    img_bytes = buf.getvalue()

    result = _save_to_bridge(
        img_bytes=img_bytes,
        prompt="test prompt",
        model="test-model",
        model_name="Test Model",
        cost_usd=0.05,
        project_name="UnitTest",
    )
    assert result is not None
    assert result["status"] == "ok"
    assert result["folder"] == "UnitTest"

    saved = media_root / "UnitTest" / f"{result['stem']}.png"
    assert saved.exists()

    img = Image.open(saved)
    assert img.info.get("source") == "aycb"
    assert img.info.get("prompt") == "test prompt"
    assert img.info.get("model") == "test-model"
    img.close()


def test_save_to_bridge_with_pil_image(media_root):
    from src.shared import _save_to_bridge
    pil = Image.new("RGB", (50, 50), "blue")

    result = _save_to_bridge(pil_image=pil, prompt="pil test")
    assert result is not None
    assert result["status"] == "ok"


def test_save_to_bridge_no_image(media_root):
    from src.shared import _save_to_bridge
    result = _save_to_bridge()
    assert result is None


def test_save_to_bridge_default_folder(media_root):
    from src.shared import _save_to_bridge
    pil = Image.new("RGB", (10, 10))
    result = _save_to_bridge(pil_image=pil)
    assert result is not None
    assert result["folder"] == time.strftime("%Y-%m-%d")


def test_save_to_bridge_sanitizes_project_name(media_root):
    from src.shared import _save_to_bridge
    pil = Image.new("RGB", (10, 10))
    result = _save_to_bridge(pil_image=pil, project_name='Bad/Name:With"Chars')
    assert result is not None
    assert "/" not in result["folder"]
    assert ":" not in result["folder"]


# ── PNG tEXt chunk injection tests ───────────────────────────────────────
def _make_test_png() -> bytes:
    img = Image.new("RGB", (4, 4), "red")
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
    from src.shared import _inject_png_text_chunks
    original = _make_test_png()
    enriched = _inject_png_text_chunks(original, {"prompt": "test", "cost_usd": "0.05"})
    assert _extract_idat(original) == _extract_idat(enriched)


def test_inject_png_text_round_trip_meta():
    from src.shared import _inject_png_text_chunks
    original = _make_test_png()
    meta = {"prompt": "una vista alpina", "model": "gemini-3-pro-image-preview", "cost_usd": "0.134"}
    enriched = _inject_png_text_chunks(original, meta)
    reloaded = Image.open(io.BytesIO(enriched))
    info = dict(reloaded.info)
    reloaded.close()
    for k, v in meta.items():
        assert info.get(k) == v, f"meta key {k!r} did not round-trip"


def test_inject_png_text_malformed_returns_unchanged():
    from src.shared import _inject_png_text_chunks
    junk = b"definitely not a PNG"
    assert _inject_png_text_chunks(junk, {"prompt": "x"}) == junk


def test_inject_png_text_iend_before_idat_returns_unchanged():
    """PNG that has IEND before any IDAT must be returned unchanged."""
    import zlib
    from src.shared import _inject_png_text_chunks
    sig = b"\x89PNG\r\n\x1a\n"
    # Minimal IHDR (13-byte payload, all zeros)
    ihdr_data = b"\x00" * 13
    ihdr_crc = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + ihdr_crc
    # IEND with no IDAT in between
    iend_crc = struct.pack(">I", zlib.crc32(b"IEND") & 0xFFFFFFFF)
    iend = struct.pack(">I", 0) + b"IEND" + iend_crc
    truncated = sig + ihdr + iend  # valid header, no IDAT
    assert _inject_png_text_chunks(truncated, {"k": "v"}) == truncated


def test_inject_png_text_truncated_stream_returns_unchanged():
    """A stream that ends mid-chunk (no IDAT found) must be returned unchanged."""
    from src.shared import _inject_png_text_chunks
    sig = b"\x89PNG\r\n\x1a\n"
    # Claim a chunk of 1 MB, provide only 8 bytes after sig → loop exits without finding IDAT
    truncated = sig + b"\x00\x0F\x42\x40" + b"tEXt"  # length=1M, type=tEXt, no data
    assert _inject_png_text_chunks(truncated, {"k": "v"}) == truncated
