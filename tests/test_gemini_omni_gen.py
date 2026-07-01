"""Tests for src/gemini_omni_gen.py — Gemini Omni Flash video via REST.

The registry entry for ``gemini-omni-flash`` is owned by another module,
so these tests inject a fake ``MODELS`` entry and mock the module-internal
HTTP send functions (no live httpx call).
"""
import asyncio
import base64
import logging
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src import gemini_omni_gen, gemini_omni_helpers


_FAKE_MODELS = {
    "gemini-omni-flash": {
        "name": "Gemini Omni Flash",
        "provider_model_id": "gemini-omni-flash-preview",
        "aspect_ratios": ["16:9", "9:16"],
        "qualities": ["720p"],
        "min_duration": 3,
        "max_duration": 10,
        "default_duration": 8,
        "cost_per_sec": {"720p": 0.10},
        "max_ref_images": 1,
    }
}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Inject the fake model and reset the in-memory job table per test."""
    monkeypatch.setattr(gemini_omni_gen, "MODELS", dict(_FAKE_MODELS))
    gemini_omni_gen._JOBS.clear()
    yield
    gemini_omni_gen._JOBS.clear()


# ── Submit ────────────────────────────────────────────────────────────────────

class TestSubmit:
    def test_t2v_returns_pending_and_registers_job(self):
        with patch.object(gemini_omni_gen, "_run", new=AsyncMock()) as run:
            result = asyncio.run(gemini_omni_gen.submit_text_to_video(
                api_key="k", model_id="gemini-omni-flash", prompt="a cat",
                aspect_ratio="16:9", duration=8,
            ))
        rid = result["request_id"]
        assert result["status"] == "pending"
        assert rid and gemini_omni_gen._JOBS[rid]["status"] == "processing"
        body = run.call_args.args[2]
        assert body["model"] == "gemini-omni-flash-preview"
        assert body["input"] == "a cat"
        assert body["response_format"]["aspect_ratio"] == "16:9"
        assert body["response_format"]["delivery"] == "uri"
        vc = body["generation_config"]["video_config"]
        assert vc["task"] == "text_to_video"
        assert vc["duration_seconds"] == 8

    def test_i2v_builds_multimodal_input(self):
        with patch.object(gemini_omni_gen, "_run", new=AsyncMock()) as run:
            result = asyncio.run(gemini_omni_gen.submit_with_refs(
                api_key="k", model_id="gemini-omni-flash", prompt="go",
                ref_image_bytes=[("a.png", b"\x89PNG")],
                aspect_ratio="9:16", duration=5,
            ))
        assert result["status"] == "pending"
        body = run.call_args.args[2]
        assert body["generation_config"]["video_config"]["task"] == "image_to_video"
        assert isinstance(body["input"], list)
        img = body["input"][0]
        assert img["type"] == "image"
        assert img["mime_type"] == "image/png"
        assert base64.b64decode(img["data"]) == b"\x89PNG"
        assert body["input"][1] == {"type": "text", "text": "go"}

    def test_no_refs_delegates_to_t2v(self):
        with patch.object(gemini_omni_gen, "_run", new=AsyncMock()) as run:
            asyncio.run(gemini_omni_gen.submit_with_refs(
                api_key="k", model_id="gemini-omni-flash", prompt="x",
                ref_image_bytes=None, aspect_ratio="16:9", duration=8,
            ))
        body = run.call_args.args[2]
        assert body["generation_config"]["video_config"]["task"] == "text_to_video"

    def test_extra_refs_warn_and_use_first(self, caplog):
        caplog.set_level(logging.WARNING, logger="src.gemini_omni_gen")
        with patch.object(gemini_omni_gen, "_run", new=AsyncMock()) as run:
            asyncio.run(gemini_omni_gen.submit_with_refs(
                api_key="k", model_id="gemini-omni-flash", prompt="x",
                ref_image_bytes=[("a.png", b"A"), ("b.png", b"B")],
                aspect_ratio="16:9", duration=8,
            ))
        assert "1 reference image" in " ".join(r.message for r in caplog.records)
        body = run.call_args.args[2]
        assert base64.b64decode(body["input"][0]["data"]) == b"A"


# ── Validation (failure paths) ────────────────────────────────────────────────

class TestValidation:
    def test_duration_too_long_raises_t2v(self):
        with pytest.raises(gemini_omni_gen.GeminiOmniGenError, match="duration must be"):
            asyncio.run(gemini_omni_gen.submit_text_to_video(
                api_key="k", model_id="gemini-omni-flash", prompt="x",
                aspect_ratio="16:9", duration=12,
            ))

    def test_duration_too_short_raises_t2v(self):
        with pytest.raises(gemini_omni_gen.GeminiOmniGenError, match="duration must be"):
            asyncio.run(gemini_omni_gen.submit_text_to_video(
                api_key="k", model_id="gemini-omni-flash", prompt="x",
                aspect_ratio="16:9", duration=2,
            ))

    def test_bad_aspect_raises(self):
        with pytest.raises(gemini_omni_gen.GeminiOmniGenError, match="aspect_ratio"):
            asyncio.run(gemini_omni_gen.submit_text_to_video(
                api_key="k", model_id="gemini-omni-flash", prompt="x",
                aspect_ratio="1:1", duration=8,
            ))

    def test_unknown_model_raises(self):
        with pytest.raises(gemini_omni_gen.GeminiOmniGenError, match="Unknown Gemini Omni model"):
            asyncio.run(gemini_omni_gen.submit_text_to_video(
                api_key="k", model_id="nope", prompt="x",
                aspect_ratio="16:9", duration=8,
            ))


# ── Response parsing ──────────────────────────────────────────────────────────

class TestExtractVideo:
    def test_inline_output_video(self):
        b64 = base64.b64encode(b"X").decode()
        vb, uri = gemini_omni_helpers._extract_video({"output_video": {"data": b64}})
        assert vb == b"X" and uri is None

    def test_inline_step_content(self):
        b64 = base64.b64encode(b"Y").decode()
        vb, uri = gemini_omni_helpers._extract_video(
            {"steps": [{"content": [{"data": b64}]}]}
        )
        assert vb == b"Y" and uri is None

    def test_uri_step_content(self):
        vb, uri = gemini_omni_helpers._extract_video(
            {"steps": [{"content": [{"uri": "files/z"}]}]}
        )
        assert vb is None and uri == "files/z"

    def test_nothing(self):
        vb, uri = gemini_omni_helpers._extract_video({})
        assert vb is None and uri is None


# ── Render worker (_run) ──────────────────────────────────────────────────────

class TestRun:
    def test_inline_base64_completes(self, tmp_path, monkeypatch):
        monkeypatch.setattr(gemini_omni_helpers.settings, "shared_root", tmp_path)
        payload = {"output_video": {"data": base64.b64encode(b"MP4BYTES").decode()}}
        rid = "job1"
        gemini_omni_gen._JOBS[rid] = {"status": "processing", "url": "", "error": ""}
        with patch.object(gemini_omni_gen, "_post_interaction",
                          new=AsyncMock(return_value=payload)):
            asyncio.run(gemini_omni_gen._run("k", rid, {"body": 1}))
        job = gemini_omni_gen._JOBS[rid]
        assert job["status"] == "completed"
        assert job["url"] == f"/media/omni_{rid}.mp4"
        assert (tmp_path / "Media" / f"omni_{rid}.mp4").read_bytes() == b"MP4BYTES"

    def test_uri_delivery_completes(self, tmp_path, monkeypatch):
        monkeypatch.setattr(gemini_omni_helpers.settings, "shared_root", tmp_path)
        payload = {"steps": [{"content": [{"uri": "files/abc"}]}]}
        rid = "job2"
        gemini_omni_gen._JOBS[rid] = {"status": "processing", "url": "", "error": ""}
        with patch.object(gemini_omni_gen, "_post_interaction",
                          new=AsyncMock(return_value=payload)), \
             patch.object(gemini_omni_gen, "_fetch_file_uri",
                          new=AsyncMock(return_value=b"URIBYTES")) as fetch:
            asyncio.run(gemini_omni_gen._run("k", rid, {}))
        fetch.assert_awaited_once()
        assert fetch.call_args.args[1] == "files/abc"
        assert gemini_omni_gen._JOBS[rid]["status"] == "completed"
        assert (tmp_path / "Media" / f"omni_{rid}.mp4").read_bytes() == b"URIBYTES"

    def test_no_video_data_fails(self, tmp_path, monkeypatch):
        monkeypatch.setattr(gemini_omni_helpers.settings, "shared_root", tmp_path)
        rid = "job3"
        gemini_omni_gen._JOBS[rid] = {"status": "processing", "url": "", "error": ""}
        with patch.object(gemini_omni_gen, "_post_interaction",
                          new=AsyncMock(return_value={})):
            asyncio.run(gemini_omni_gen._run("k", rid, {}))
        job = gemini_omni_gen._JOBS[rid]
        assert job["status"] == "failed"
        assert "no video" in job["error"].lower()

    def test_http_error_fails(self, tmp_path, monkeypatch):
        monkeypatch.setattr(gemini_omni_helpers.settings, "shared_root", tmp_path)
        rid = "job4"
        gemini_omni_gen._JOBS[rid] = {"status": "processing", "url": "", "error": ""}
        boom = AsyncMock(side_effect=gemini_omni_gen.GeminiOmniGenError(
            "Omni interactions HTTP 500: boom"))
        with patch.object(gemini_omni_gen, "_post_interaction", new=boom):
            asyncio.run(gemini_omni_gen._run("k", rid, {}))
        job = gemini_omni_gen._JOBS[rid]
        assert job["status"] == "failed"
        assert "500" in job["error"]


# ── File-uri fetch (poll ACTIVE + download) ───────────────────────────────────

class TestFetchFileUri:
    def test_polls_until_active_then_downloads(self, monkeypatch):
        monkeypatch.setattr(gemini_omni_helpers, "_FILE_STATE_INTERVAL", 0)
        calls = {"n": 0}

        def handler(request):
            if "alt" in request.url.params:
                return httpx.Response(200, content=b"FINALMP4")
            calls["n"] += 1
            state = "PROCESSING" if calls["n"] < 2 else "ACTIVE"
            return httpx.Response(200, json={"state": state, "uri": str(request.url)})

        transport = httpx.MockTransport(handler)
        orig = httpx.AsyncClient
        monkeypatch.setattr(
            gemini_omni_helpers.httpx, "AsyncClient",
            lambda **kw: orig(transport=transport,
                              **{k: v for k, v in kw.items() if k != "transport"}),
        )
        result = asyncio.run(
            gemini_omni_helpers._fetch_file_uri("k", "https://gen.example/files/abc")
        )
        assert result == b"FINALMP4"
        assert calls["n"] == 2

    def test_download_http_error_raises(self, monkeypatch):
        monkeypatch.setattr(gemini_omni_helpers, "_FILE_STATE_INTERVAL", 0)

        def handler(request):
            if "alt" in request.url.params:
                return httpx.Response(500, text="boom")
            return httpx.Response(200, json={"state": "ACTIVE", "uri": str(request.url)})

        transport = httpx.MockTransport(handler)
        orig = httpx.AsyncClient
        monkeypatch.setattr(
            gemini_omni_helpers.httpx, "AsyncClient",
            lambda **kw: orig(transport=transport,
                              **{k: v for k, v in kw.items() if k != "transport"}),
        )
        with pytest.raises(gemini_omni_helpers.GeminiOmniGenError, match="download HTTP 500"):
            asyncio.run(
                gemini_omni_helpers._fetch_file_uri("k", "https://gen.example/files/abc")
            )


# ── get_result ────────────────────────────────────────────────────────────────

class TestGetResult:
    def test_unknown_is_processing(self):
        result = asyncio.run(gemini_omni_gen.get_result("k", "missing"))
        assert result == {"request_id": "missing", "status": "processing",
                          "url": "", "error": ""}

    def test_completed(self):
        gemini_omni_gen._JOBS["r"] = {"status": "completed",
                                      "url": "/media/omni_r.mp4", "error": ""}
        result = asyncio.run(gemini_omni_gen.get_result("k", "r"))
        assert result["status"] == "completed"
        assert result["url"] == "/media/omni_r.mp4"

    def test_failed(self):
        gemini_omni_gen._JOBS["r"] = {"status": "failed", "url": "", "error": "boom"}
        result = asyncio.run(gemini_omni_gen.get_result("k", "r"))
        assert result["status"] == "failed"
        assert result["error"] == "boom"
