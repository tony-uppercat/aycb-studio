"""Tests for _save_to_bridge — image saving with PNG tEXt metadata."""
import pytest
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
