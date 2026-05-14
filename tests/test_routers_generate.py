"""Verify /api/generate/image forwards thinking + lifts ref cap to 14."""
from unittest.mock import patch

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
        # The 2nd positional arg of generate_image is reference_images (the pil_refs list).
        refs_passed = mock_gen.call_args.args[1] if len(mock_gen.call_args.args) > 1 else mock_gen.call_args.kwargs.get("reference_images")
        assert len(refs_passed) == 14
