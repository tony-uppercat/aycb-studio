"""Tests for src/video_gen.py — PiAPI.ai video generation client."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from src.video_gen import (
    VideoGenError, get_model_info, upload_ephemeral,
    submit_text_to_video, submit_with_refs, get_result,
    _build_kling_input, _build_seedance_input,
    MODELS,
)


# ── Model registry ──────────────────────────────────────────────────────────

class TestGetModelInfo:
    def test_valid_kling(self):
        info = get_model_info("kling-3.0-omni")
        assert info["piapi_model"] == "kling"
        assert info["task_type"] == "omni_video_generation"
        assert info["version"] == "3.0"

    def test_valid_seedance(self):
        info = get_model_info("seedance-2.0")
        assert info["piapi_model"] == "seedance"
        assert info["task_type"] == "seedance-2"

    def test_valid_seedance_fast(self):
        info = get_model_info("seedance-2.0-fast")
        assert info["task_type"] == "seedance-2-fast"

    def test_unknown_model(self):
        with pytest.raises(VideoGenError, match="Unknown model"):
            get_model_info("nonexistent")

    def test_all_models_have_required_fields(self):
        required = {"name", "piapi_model", "task_type", "aspect_ratios",
                     "qualities", "min_duration", "max_duration", "cost_per_sec"}
        for model_id, info in MODELS.items():
            missing = required - set(info.keys())
            assert not missing, f"{model_id} missing: {missing}"


# ── Input builders ──────────────────────────────────────────────────────────

class TestBuildKlingInput:
    def test_t2v(self):
        inp = _build_kling_input("a cat walking", "720p", 5, "16:9")
        assert inp["prompt"] == "a cat walking"
        assert inp["version"] == "3.0"
        assert inp["resolution"] == "720p"
        assert inp["duration"] == 5
        assert inp["aspect_ratio"] == "16:9"
        assert inp["enable_audio"] is False
        assert "images" not in inp

    def test_first_frame_1_image(self):
        inp = _build_kling_input("animate this", "1080p", 10, "9:16",
                                  image_urls=["https://a.png"])
        assert inp["images"] == ["https://a.png"]
        assert "@image_1 as first frame" in inp["prompt"]
        assert "@image_2" not in inp["prompt"]

    def test_first_last_frame_2_images(self):
        inp = _build_kling_input("animate this", "1080p", 10, "9:16",
                                  image_urls=["https://a.png", "https://b.png"])
        assert inp["images"] == ["https://a.png", "https://b.png"]
        assert "@image_1 as first frame" in inp["prompt"]
        assert "@image_2 as end frame" in inp["prompt"]

    def test_3_images_no_directive(self):
        urls = ["https://a.png", "https://b.png", "https://c.png"]
        inp = _build_kling_input("scene", "720p", 5, "16:9", image_urls=urls)
        assert inp["images"] == urls
        assert "@image_1" not in inp["prompt"]

    def test_invalid_quality_defaults_720p(self):
        inp = _build_kling_input("test", "invalid", 5, "16:9")
        assert inp["resolution"] == "720p"


class TestBuildSeedanceInput:
    def test_t2v_no_refs(self):
        inp = _build_seedance_input("sunset scene", 5, "16:9")
        assert inp["mode"] == "text_to_video"
        assert inp["aspect_ratio"] == "16:9"
        assert "image_urls" not in inp

    def test_first_last_frames_1_image(self):
        inp = _build_seedance_input("animate", 5, "16:9",
                                     image_urls=["https://start.png"])
        assert inp["mode"] == "first_last_frames"
        assert inp["image_urls"] == ["https://start.png"]
        assert inp["aspect_ratio"] == "auto"

    def test_first_last_frames_2_images(self):
        inp = _build_seedance_input("morph", 5, "16:9",
                                     image_urls=["https://a.png", "https://b.png"])
        assert inp["mode"] == "first_last_frames"
        assert inp["image_urls"] == ["https://a.png", "https://b.png"]
        assert inp["aspect_ratio"] == "auto"

    def test_omni_reference_3_images(self):
        urls = ["https://a.png", "https://b.png", "https://c.png"]
        inp = _build_seedance_input("scene", 5, "16:9", image_urls=urls)
        assert inp["mode"] == "omni_reference"
        assert inp["aspect_ratio"] == "16:9"

    def test_omni_reference_with_video(self):
        inp = _build_seedance_input("animate", 5, "16:9",
                                     video_urls=["https://v.mp4"])
        assert inp["mode"] == "omni_reference"
        assert inp["video_urls"] == ["https://v.mp4"]

    def test_omni_reference_with_audio(self):
        inp = _build_seedance_input("sing", 5, "16:9",
                                     audio_urls=["https://a.mp3"])
        assert inp["mode"] == "omni_reference"
        assert inp["audio_urls"] == ["https://a.mp3"]

    def test_omni_reference_all_refs(self):
        inp = _build_seedance_input(
            "full scene", 10, "16:9",
            image_urls=["https://img.png"],
            video_urls=["https://vid.mp4"],
            audio_urls=["https://aud.mp3"],
        )
        assert inp["mode"] == "omni_reference"
        assert inp["image_urls"] == ["https://img.png"]
        assert inp["video_urls"] == ["https://vid.mp4"]
        assert inp["audio_urls"] == ["https://aud.mp3"]


# ── Upload ephemeral ────────────────────────────────────────────────────────

class TestUploadEphemeral:
    @pytest.mark.asyncio
    async def test_success(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"code": 200, "data": {"url": "https://cdn.piapi.ai/test.png"}}

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            url = await upload_ephemeral("key123", "test.png", b"fake_image_data")

        assert url == "https://cdn.piapi.ai/test.png"
        call_args = mock_client.post.call_args
        assert call_args[1]["json"]["file_name"] == "test.png"

    @pytest.mark.asyncio
    async def test_api_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.text = "Bad request"

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(VideoGenError, match="File upload failed"):
                await upload_ephemeral("key123", "test.png", b"data")

    @pytest.mark.asyncio
    async def test_missing_url_in_response(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"code": 200, "data": {}}

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(VideoGenError, match="No URL"):
                await upload_ephemeral("key123", "test.png", b"data")


# ── Get result (poll) ───────────────────────────────────────────────────────

class TestGetResult:
    @pytest.mark.asyncio
    async def test_completed(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "code": 200,
            "data": {
                "task_id": "abc-123",
                "status": "Completed",
                "output": {"video": "https://cdn.piapi.ai/result.mp4"},
                "error": {"code": 0, "message": ""},
            },
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            result = await get_result("key123", "abc-123")

        assert result["request_id"] == "abc-123"
        assert result["status"] == "completed"
        assert result["url"] == "https://cdn.piapi.ai/result.mp4"
        assert result["error"] == ""

    @pytest.mark.asyncio
    async def test_failed(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "code": 200,
            "data": {
                "task_id": "abc-456",
                "status": "Failed",
                "output": {},
                "error": {"code": 1001, "message": "Content policy violation"},
            },
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            result = await get_result("key123", "abc-456")

        assert result["status"] == "failed"
        assert result["error"] == "Content policy violation"

    @pytest.mark.asyncio
    async def test_processing(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "code": 200,
            "data": {
                "task_id": "abc-789",
                "status": "Processing",
                "output": {},
                "error": {},
            },
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            result = await get_result("key123", "abc-789")

        assert result["status"] == "processing"
        assert result["url"] == ""

    @pytest.mark.asyncio
    async def test_api_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal server error"

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.video_gen.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(VideoGenError, match="Status check failed"):
                await get_result("key123", "abc-000")
