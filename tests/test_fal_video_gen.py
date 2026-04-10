"""Tests for src/fal_video_gen.py — fal.ai video generation client."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from src.fal_video_gen import (
    FalVideoGenError, get_model_info, MODELS,
    _image_to_data_uri, _headers,
    submit_text_to_video, submit_with_refs, get_result,
)


# ── Model registry ──────────────────────────────────────────────────────────

class TestGetModelInfo:
    def test_valid_std(self):
        info = get_model_info("fal-kling-v3-std")
        assert "endpoint_t2v" in info
        assert "fal-ai/kling-video/v3/standard" in info["endpoint_t2v"]

    def test_valid_pro(self):
        info = get_model_info("fal-kling-v3-pro")
        assert "pro" in info["endpoint_t2v"]

    def test_unknown(self):
        with pytest.raises(FalVideoGenError, match="Unknown fal model"):
            get_model_info("nonexistent")

    def test_all_models_have_required_fields(self):
        required = {"name", "endpoint_t2v", "endpoint_i2v", "aspect_ratios",
                     "qualities", "min_duration", "max_duration", "cost_per_sec"}
        for model_id, info in MODELS.items():
            missing = required - set(info.keys())
            assert not missing, f"{model_id} missing: {missing}"


# ── Helpers ─────────────────────────────────────────────────────────────────

class TestHelpers:
    def test_headers(self):
        h = _headers("my-key-123")
        assert h["Authorization"] == "Key my-key-123"

    def test_image_to_data_uri_png(self):
        uri = _image_to_data_uri(b"\x89PNG", ".png")
        assert uri.startswith("data:image/png;base64,")

    def test_image_to_data_uri_jpeg(self):
        uri = _image_to_data_uri(b"\xff\xd8", ".jpg")
        assert uri.startswith("data:image/jpeg;base64,")

    def test_image_to_data_uri_webp(self):
        uri = _image_to_data_uri(b"RIFF", ".webp")
        assert uri.startswith("data:image/webp;base64,")


# ── Submit ──────────────────────────────────────────────────────────────────

def _mock_client(status_code=200, json_data=None):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data or {}
    mock_resp.text = str(json_data)
    client = AsyncMock()
    client.post.return_value = mock_resp
    client.get.return_value = mock_resp
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


class TestSubmitT2V:
    @pytest.mark.asyncio
    async def test_success(self):
        client = _mock_client(200, {
            "request_id": "req-abc",
            "status_url": "https://queue.fal.run/.../status",
            "response_url": "https://queue.fal.run/.../response",
        })
        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            result = await submit_text_to_video("key", "fal-kling-v3-std", "a cat", "16:9", 5)
        assert result["request_id"] == "req-abc"
        assert result["status"] == "pending"
        assert result["_fal_endpoint"] == "fal-ai/kling-video/v3/standard/text-to-video"

    @pytest.mark.asyncio
    async def test_api_error(self):
        client = _mock_client(401, {"message": "Invalid key"})
        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            with pytest.raises(FalVideoGenError, match="Submit failed"):
                await submit_text_to_video("bad-key", "fal-kling-v3-std", "test")


class TestSubmitWithRefs:
    @pytest.mark.asyncio
    async def test_i2v_with_image(self):
        client = _mock_client(200, {"request_id": "req-i2v", "status_url": "", "response_url": ""})
        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            result = await submit_with_refs(
                "key", "fal-kling-v3-pro", "animate this",
                ref_image_bytes=[("ref.png", b"fake_png_data")],
            )
        assert result["request_id"] == "req-i2v"
        # Should use i2v endpoint
        assert result["_fal_endpoint"] == "fal-ai/kling-video/v3/pro/image-to-video"
        # Check start_image_url was sent as data URI
        call_json = client.post.call_args[1]["json"]
        assert call_json["start_image_url"].startswith("data:image/png;base64,")

    @pytest.mark.asyncio
    async def test_fallback_to_t2v_without_refs(self):
        client = _mock_client(200, {"request_id": "req-t2v", "status_url": "", "response_url": ""})
        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            result = await submit_with_refs("key", "fal-kling-v3-std", "just text")
        # No refs → T2V endpoint
        assert result["_fal_endpoint"] == "fal-ai/kling-video/v3/standard/text-to-video"


# ── Get result ──────────────────────────────────────────────────────────────

class TestGetResult:
    @pytest.mark.asyncio
    async def test_completed(self):
        client = AsyncMock()
        status_resp = MagicMock(status_code=200)
        status_resp.json.return_value = {"status": "COMPLETED", "request_id": "r1"}
        result_resp = MagicMock(status_code=200)
        result_resp.json.return_value = {"video": {"url": "https://v3.fal.media/video.mp4"}}
        client.get.side_effect = [status_resp, result_resp]
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            result = await get_result("key", "r1", "fal-ai/kling-video/v3/standard/text-to-video")
        assert result["status"] == "completed"
        assert result["url"] == "https://v3.fal.media/video.mp4"

    @pytest.mark.asyncio
    async def test_in_progress(self):
        client = _mock_client(200, {"status": "IN_PROGRESS", "request_id": "r2"})
        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            result = await get_result("key", "r2", "fal-ai/kling-video/v3/standard/text-to-video")
        assert result["status"] == "processing"

    @pytest.mark.asyncio
    async def test_in_queue(self):
        client = _mock_client(200, {"status": "IN_QUEUE", "request_id": "r3", "queue_position": 2})
        with patch("src.fal_video_gen.httpx.AsyncClient", return_value=client):
            result = await get_result("key", "r3", "fal-ai/kling-video/v3/standard/text-to-video")
        assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_missing_endpoint(self):
        with pytest.raises(FalVideoGenError, match="requires endpoint"):
            await get_result("key", "r4", "")
