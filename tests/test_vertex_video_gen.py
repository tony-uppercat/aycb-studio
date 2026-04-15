"""Tests for src/vertex_video_gen.py — Google Veo 3.1 via Vertex AI."""
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
