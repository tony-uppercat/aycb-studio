"""Tests for src/vertex_video_gen.py — Google Veo 3.1 via Gemini API."""
import pytest


class TestGetModelInfo:
    def test_veo_3_1(self):
        from src.vertex_video_gen import get_model_info
        info = get_model_info("vertex-veo-3.1")
        assert info["vertex_model"] == "veo-3.1-generate-preview"
        assert info["aspect_ratios"] == ["16:9", "9:16"]
        assert info["qualities"] == ["720p", "1080p"]
        assert info["min_duration"] == 4
        assert info["max_duration"] == 8
        assert info["cost_per_sec"]["720p"] == 0.40
        assert info["max_ref_images"] == 3

    def test_veo_3_1_fast(self):
        from src.vertex_video_gen import get_model_info
        info = get_model_info("vertex-veo-3.1-fast")
        assert info["vertex_model"] == "veo-3.1-fast-generate-preview"
        assert info["qualities"] == ["720p"]
        assert info["cost_per_sec"]["720p"] == 0.15

    def test_unknown_model(self):
        from src.vertex_video_gen import get_model_info, VertexVideoGenError
        with pytest.raises(VertexVideoGenError, match="Unknown Vertex model"):
            get_model_info("vertex-nope")

    def test_all_models_have_required_fields(self):
        from src.vertex_video_gen import MODELS
        required = {"name", "vertex_model", "aspect_ratios", "qualities",
                    "min_duration", "max_duration", "default_duration",
                    "cost_per_sec", "max_ref_images"}
        for model_id, info in MODELS.items():
            missing = required - set(info.keys())
            assert not missing, f"{model_id} missing: {missing}"


# ── Submit ──────────────────────────────────────────────────────────────────

import asyncio
from unittest.mock import MagicMock, patch


def _fake_operation(name="projects/p/locations/us/operations/abc"):
    op = MagicMock()
    op.name = name
    op.done = False
    return op


class TestSubmitTextToVideo:
    def test_builds_config_and_returns_request_id(self):
        from src.vertex_video_gen import submit_text_to_video

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            result = asyncio.run(submit_text_to_video(
                api_key="", model_id="vertex-veo-3.1",
                prompt="a cat", aspect_ratio="16:9", duration=8, quality="720p",
            ))

        assert result == {"request_id": op.name, "status": "pending"}

        kwargs = client.models.generate_videos.call_args.kwargs
        assert kwargs["model"] == "veo-3.1-generate-preview"
        assert kwargs["prompt"] == "a cat"
        cfg = kwargs["config"]
        assert cfg.aspect_ratio == "16:9"
        assert cfg.duration_seconds == 8
        assert cfg.resolution == "720p"
        assert cfg.number_of_videos == 1
        assert cfg.person_generation == "allow_adult"


class TestSubmitWithRefs:
    def test_single_image_sets_image_only(self):
        """1 image -> I2V first frame, no last_frame, no reference_images."""
        from src.vertex_video_gen import submit_with_refs

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            asyncio.run(submit_with_refs(
                api_key="", model_id="vertex-veo-3.1-fast", prompt="go",
                ref_image_bytes=[("a.png", b"\x89PNG\r\n")],
                aspect_ratio="16:9", duration=4, quality="720p",
            ))

        kwargs = client.models.generate_videos.call_args.kwargs
        assert kwargs["image"] is not None
        assert kwargs["image"].image_bytes == b"\x89PNG\r\n"
        cfg = kwargs["config"]
        assert cfg.last_frame is None
        assert not cfg.reference_images

    def test_two_images_sets_image_and_last_frame(self):
        from src.vertex_video_gen import submit_with_refs

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            asyncio.run(submit_with_refs(
                api_key="", model_id="vertex-veo-3.1", prompt="morph",
                ref_image_bytes=[("a.png", b"A"), ("b.png", b"B")],
                aspect_ratio="9:16", duration=6, quality="720p",
            ))

        kwargs = client.models.generate_videos.call_args.kwargs
        assert kwargs["image"].image_bytes == b"A"
        cfg = kwargs["config"]
        assert cfg.last_frame is not None
        assert cfg.last_frame.image_bytes == b"B"
        assert not cfg.reference_images

    def test_three_images_uses_reference_images(self):
        """3+ images -> first image as frame, all three as reference_images."""
        from src.vertex_video_gen import submit_with_refs

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            asyncio.run(submit_with_refs(
                api_key="", model_id="vertex-veo-3.1", prompt="scene",
                ref_image_bytes=[("a.png", b"A"), ("b.png", b"B"), ("c.png", b"C")],
                aspect_ratio="16:9", duration=8, quality="1080p",
            ))

        cfg = client.models.generate_videos.call_args.kwargs["config"]
        assert cfg.last_frame is None
        assert len(cfg.reference_images) == 3

    def test_more_than_three_images_truncated(self):
        from src.vertex_video_gen import submit_with_refs

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            asyncio.run(submit_with_refs(
                api_key="", model_id="vertex-veo-3.1", prompt="scene",
                ref_image_bytes=[("a.png", b"A"), ("b.png", b"B"),
                                 ("c.png", b"C"), ("d.png", b"D")],
                aspect_ratio="16:9", duration=8, quality="720p",
            ))

        cfg = client.models.generate_videos.call_args.kwargs["config"]
        assert len(cfg.reference_images) == 3

    def test_video_ref_and_audio_ignored_with_warning(self, caplog):
        """ref_video_bytes and audio_url are logged as ignored."""
        import logging
        from src.vertex_video_gen import submit_with_refs

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        caplog.set_level(logging.WARNING, logger="src.vertex_video_gen")
        with patch("src.vertex_video_gen._get_client", return_value=client):
            asyncio.run(submit_with_refs(
                api_key="", model_id="vertex-veo-3.1", prompt="x",
                ref_image_bytes=None,
                ref_video_bytes=("r.mp4", b"V"),
                audio_url="https://a.mp3",
                aspect_ratio="16:9", duration=5, quality="720p",
            ))

        text = " ".join(r.message for r in caplog.records)
        assert "video reference" in text.lower()
        assert "audio" in text.lower()

    def test_no_refs_delegates_to_text_to_video(self):
        from src.vertex_video_gen import submit_with_refs

        op = _fake_operation()
        client = MagicMock()
        client.models.generate_videos.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            asyncio.run(submit_with_refs(
                api_key="", model_id="vertex-veo-3.1", prompt="x",
                ref_image_bytes=None,
                aspect_ratio="16:9", duration=5, quality="720p",
            ))

        kwargs = client.models.generate_videos.call_args.kwargs
        assert "image" not in kwargs or kwargs["image"] is None


# ── Poll / Save ─────────────────────────────────────────────────────────────

from pathlib import Path


class TestGetResult:
    def test_still_running(self):
        from src.vertex_video_gen import get_result

        op = MagicMock()
        op.done = False
        op.error = None
        client = MagicMock()
        client.operations.get.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            result = asyncio.run(get_result(
                api_key="", request_id="projects/p/locations/us/operations/abc",
            ))

        assert result == {
            "request_id": "projects/p/locations/us/operations/abc",
            "status": "processing",
            "url": "",
            "error": "",
        }

    def test_done_with_error(self):
        from src.vertex_video_gen import get_result

        op = MagicMock()
        op.done = True
        op.error = "RESOURCE_EXHAUSTED: quota"
        client = MagicMock()
        client.operations.get.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            result = asyncio.run(get_result(api_key="", request_id="rid"))

        assert result["status"] == "failed"
        assert "quota" in result["error"]
        assert result["url"] == ""

    def test_done_saves_bytes_and_returns_url(self, tmp_path, monkeypatch):
        from src import vertex_video_gen
        from config.settings import settings

        monkeypatch.setattr(settings, "shared_root", tmp_path)

        saved: dict = {}

        def fake_save(path):
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_bytes(b"mp4data")
            saved["path"] = Path(path)

        video = MagicMock()
        video.save.side_effect = fake_save
        generated = MagicMock()
        generated.video = video
        response = MagicMock()
        response.generated_videos = [generated]
        op = MagicMock()
        op.done = True
        op.error = None
        op.response = response

        client = MagicMock()
        client.operations.get.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            result = asyncio.run(vertex_video_gen.get_result(
                api_key="",
                request_id="projects/p/locations/us/operations/ABC-XYZ",
            ))

        assert result["status"] == "completed"
        assert result["url"] == "/media/veo_projects_p_locations_us_operations_ABC-XYZ.mp4"
        assert result["error"] == ""
        assert saved["path"].name == "veo_projects_p_locations_us_operations_ABC-XYZ.mp4"
        assert saved["path"].read_bytes() == b"mp4data"
        client.files.download.assert_called_once_with(file=video)

    def test_done_without_generated_videos(self):
        from src.vertex_video_gen import get_result, VertexVideoGenError

        response = MagicMock()
        response.generated_videos = []
        op = MagicMock()
        op.done = True
        op.error = None
        op.response = response

        client = MagicMock()
        client.operations.get.return_value = op

        with patch("src.vertex_video_gen._get_client", return_value=client):
            with pytest.raises(VertexVideoGenError, match="no video"):
                asyncio.run(get_result(api_key="", request_id="rid"))
