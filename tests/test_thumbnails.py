"""Tests for Review Hub thumbnail generation."""
import pytest
from pathlib import Path
from PIL import Image


def test_generate_thumbnail(tmp_path, monkeypatch):
    import src.review_hub.thumbnails as thumb_mod
    monkeypatch.setattr(thumb_mod, "THUMB_DIR", tmp_path / "thumbs")

    # Create a source image (800x600)
    source = tmp_path / "source.png"
    img = Image.new("RGB", (800, 600), "red")
    img.save(str(source))

    result = thumb_mod.generate_thumbnail(source, media_id=42)
    thumb = Path(result)
    assert thumb.exists()
    assert thumb.name == "42.jpg"

    # Verify dimensions (300px wide, proportional height)
    with Image.open(thumb) as t:
        assert t.width == 300
        assert t.height == 225  # 600 * (300/800)


def test_generate_thumbnail_tall_image(tmp_path, monkeypatch):
    import src.review_hub.thumbnails as thumb_mod
    monkeypatch.setattr(thumb_mod, "THUMB_DIR", tmp_path / "thumbs")

    source = tmp_path / "tall.png"
    img = Image.new("RGB", (200, 1000), "blue")
    img.save(str(source))

    result = thumb_mod.generate_thumbnail(source, media_id=99)
    with Image.open(result) as t:
        # thumbnail() preserves aspect ratio and won't upscale
        # 200px wide < 300px target, so PIL keeps original width
        assert t.width <= 300


def test_get_image_dimensions(tmp_path):
    from src.review_hub.thumbnails import get_image_dimensions
    source = tmp_path / "dim_test.png"
    img = Image.new("RGB", (1920, 1080))
    img.save(str(source))

    w, h = get_image_dimensions(source)
    assert w == 1920
    assert h == 1080
