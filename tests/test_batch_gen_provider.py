"""Tests for src/batch_gen/provider.py with mocked google.genai client."""
from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.batch_gen.models import BatchRequest, JobState
from src.batch_gen.provider import (
    GeminiBatchProvider,
    build_jsonl_lines,
    estimate_batch_cost,
    parse_result_line,
)


def _png_1x1() -> bytes:
    # 67-byte minimal PNG: signature + IHDR + IDAT + IEND
    import struct, zlib
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr = b"IHDR" + ihdr_data
    ihdr_chunk = struct.pack(">I", 13) + ihdr + struct.pack(">I", zlib.crc32(ihdr))
    idat_data = zlib.compress(b"\x00\xff\x00\x00")
    idat = b"IDAT" + idat_data
    idat_chunk = struct.pack(">I", len(idat_data)) + idat + struct.pack(">I", zlib.crc32(idat))
    iend_chunk = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    return sig + ihdr_chunk + idat_chunk + iend_chunk


def test_build_jsonl_lines_one_request():
    req = BatchRequest(
        key="r0",
        prompt="a cat",
        refs_b64=[base64.b64encode(_png_1x1()).decode()],
        refs_mime=["image/png"],
        aspect_ratio="16:9",
        resolution="2K",
    )
    lines = build_jsonl_lines([req])
    assert len(lines) == 1
    import json
    parsed = json.loads(lines[0])
    assert parsed["key"] == "r0"
    parts = parsed["request"]["contents"][0]["parts"]
    assert parts[-1]["text"] == "a cat"
    img_cfg = parsed["request"]["generation_config"]["imageConfig"]
    assert img_cfg["imageSize"] == "2K"
    assert img_cfg["aspectRatio"] == "16:9"


def test_build_jsonl_lines_thinking_omitted_on_high_res():
    """Memo feedback_gemini_thinking_imagesize: thinking + >=2K degrades."""
    req = BatchRequest(
        key="r0", prompt="x",
        aspect_ratio="16:9", resolution="2K",
        thinking=True,
    )
    import json
    parsed = json.loads(build_jsonl_lines([req])[0])
    assert "thinkingConfig" not in parsed["request"]["generation_config"]


def test_build_jsonl_lines_thinking_included_on_low_res():
    req = BatchRequest(
        key="r0", prompt="x",
        aspect_ratio="16:9", resolution="1K",
        thinking=True,
    )
    import json
    parsed = json.loads(build_jsonl_lines([req])[0])
    assert parsed["request"]["generation_config"]["thinkingConfig"] == {"thinkingLevel": "high"}


def test_estimate_batch_cost_uses_discount():
    """Estimated cost is 0.5 * model_cost * count for image gen."""
    cost = estimate_batch_cost("gemini-3-pro-image-preview", count=5)
    # gemini-3-pro-image-preview avg per-image ~= $0.134 -> batch 0.067 * 5 = 0.335
    assert 0.30 < cost < 0.40


def test_parse_result_line_success_writes_image(tmp_path: Path):
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    img_bytes = _png_1x1()
    line = {
        "key": "r0",
        "response": {
            "candidates": [{
                "content": {
                    "parts": [{
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": base64.b64encode(img_bytes).decode(),
                        }
                    }],
                },
                "finishReason": "STOP",
            }],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 1200},
        },
    }
    result = parse_result_line(
        line=line,
        model="gemini-3-pro-image-preview",
        media_dir=media_dir,
        prompt="a cat",
    )
    assert result.request_key == "r0"
    assert result.error is None
    assert result.media_path is not None
    assert (media_dir / Path(result.media_path).name).exists()
    assert 0 < result.cost < 0.10


def test_parse_result_line_failure_captures_error(tmp_path: Path):
    media_dir = tmp_path / "Media"
    media_dir.mkdir()
    line = {"key": "r0", "error": {"code": 400, "message": "bad prompt"}}
    result = parse_result_line(
        line=line,
        model="gemini-3-pro-image-preview",
        media_dir=media_dir,
        prompt="x",
    )
    assert result.error is not None
    assert "bad prompt" in result.error
    assert result.media_path is None


@pytest.mark.asyncio
async def test_submit_calls_google_create_with_uploaded_file(tmp_path, monkeypatch):
    """Provider.submit uploads JSONL via files.upload then creates batch."""
    fake_uploaded = SimpleNamespace(name="files/abc")
    fake_job = SimpleNamespace(name="batches/xyz")
    fake_client = MagicMock()
    fake_client.files.upload.return_value = fake_uploaded
    fake_client.batches.create.return_value = fake_job

    provider = GeminiBatchProvider(client=fake_client, scratch_dir=tmp_path)
    req = BatchRequest(key="r0", prompt="hi")
    job_name = await provider.submit(
        model="gemini-3-pro-image-preview",
        requests=[req],
        display_name="test",
    )
    assert job_name == "batches/xyz"
    fake_client.files.upload.assert_called_once()
    fake_client.batches.create.assert_called_once_with(
        model="gemini-3-pro-image-preview",
        src="files/abc",
        config={"display_name": "test"},
    )


@pytest.mark.asyncio
async def test_get_state_translates_google_states():
    fake_client = MagicMock()
    fake_client.batches.get.return_value = SimpleNamespace(
        state=SimpleNamespace(name="JOB_STATE_SUCCEEDED"),
        dest=SimpleNamespace(file_name="files/result"),
        error=None,
    )
    provider = GeminiBatchProvider(client=fake_client, scratch_dir=Path("/tmp"))
    info = await provider.get_state("batches/x")
    assert info.state == JobState.SUCCEEDED
    assert info.result_file == "files/result"
    assert info.error is None


@pytest.mark.asyncio
async def test_get_state_failed_captures_error():
    fake_client = MagicMock()
    fake_client.batches.get.return_value = SimpleNamespace(
        state=SimpleNamespace(name="JOB_STATE_FAILED"),
        dest=None,
        error=SimpleNamespace(message="quota"),
    )
    provider = GeminiBatchProvider(client=fake_client, scratch_dir=Path("/tmp"))
    info = await provider.get_state("batches/x")
    assert info.state == JobState.FAILED
    assert info.error == "quota"


@pytest.mark.asyncio
async def test_cancel_calls_google():
    fake_client = MagicMock()
    provider = GeminiBatchProvider(client=fake_client, scratch_dir=Path("/tmp"))
    await provider.cancel("batches/x")
    fake_client.batches.cancel.assert_called_once_with(name="batches/x")
