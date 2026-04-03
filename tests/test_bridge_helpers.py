"""Tests for bridge router helper functions."""
import pytest
from pathlib import Path
from PIL import Image
from PIL.PngImagePlugin import PngInfo


def test_ext_to_mime():
    from src.routers.bridge import _ext_to_mime
    assert _ext_to_mime(".png") == "image/png"
    assert _ext_to_mime(".jpg") == "image/jpeg"
    assert _ext_to_mime(".jpeg") == "image/jpeg"
    assert _ext_to_mime(".webp") == "image/webp"
    assert _ext_to_mime(".gif") == "image/gif"
    assert _ext_to_mime(".mp4") == "video/mp4"
    assert _ext_to_mime(".mov") == "video/quicktime"
    assert _ext_to_mime(".webm") == "video/webm"
    assert _ext_to_mime(".xyz") == "application/octet-stream"


@pytest.fixture
def media_root(tmp_path, monkeypatch):
    """Point settings.shared_root at tmp_path so media_dir = tmp_path/Media."""
    from config.settings import settings
    monkeypatch.setattr(settings, "shared_root", tmp_path)
    media = tmp_path / "Media"
    media.mkdir()
    return media


def test_scan_media_list_empty(tmp_path, monkeypatch):
    from config.settings import settings
    monkeypatch.setattr(settings, "shared_root", tmp_path / "empty_root")
    from src.routers.bridge import _scan_media_list
    assert _scan_media_list() == []


def test_scan_media_list_finds_files(media_root):
    project = media_root / "TestProject"
    project.mkdir()
    img = Image.new("RGB", (100, 100), "red")
    img.save(str(project / "test_001.png"))
    (project / "notes.txt").write_text("skip me")

    from src.routers.bridge import _scan_media_list
    entries = _scan_media_list()
    assert len(entries) == 1
    assert entries[0]["id"] == "test_001"
    assert entries[0]["filename"] == "test_001.png"
    assert entries[0]["project"] == "TestProject"
    assert entries[0]["type"] == "image/png"


def test_scan_media_list_skips_thumbs(media_root):
    project = media_root / "P1"
    thumbs = project / ".thumbs"
    thumbs.mkdir(parents=True)
    img = Image.new("RGB", (100, 100), "blue")
    img.save(str(project / "real.png"))
    img.save(str(thumbs / "real.jpg"))

    from src.routers.bridge import _scan_media_list
    entries = _scan_media_list()
    assert len(entries) == 1
    assert entries[0]["filename"] == "real.png"


def test_find_png_meta_with_text_chunks(media_root):
    project = media_root / "MetaTest"
    project.mkdir(parents=True)

    img = Image.new("RGB", (50, 50), "green")
    info = PngInfo()
    info.add_text("source", "aycb")
    info.add_text("prompt", "a green square")
    info.add_text("model", "test-model")
    info.add_text("cost_usd", "0.05")
    img.save(str(project / "meta_test.png"), pnginfo=info)

    from src.routers.bridge import _find_png_meta
    result = _find_png_meta("meta_test")
    assert result is not None
    assert result["source"] == "aycb"
    assert result["prompt"] == "a green square"
    assert result["cost_usd"] == pytest.approx(0.05)


def test_find_png_meta_no_source(media_root):
    img = Image.new("RGB", (10, 10))
    img.save(str(media_root / "plain.png"))

    from src.routers.bridge import _find_png_meta
    assert _find_png_meta("plain") is None


def test_find_png_meta_nonexistent(media_root):
    from src.routers.bridge import _find_png_meta
    assert _find_png_meta("no_such_file") is None


def test_find_png_meta_sanitizes_input():
    from src.routers.bridge import _find_png_meta
    assert _find_png_meta("") is None
    assert _find_png_meta("../../etc/passwd") is None


def test_delete_bridge_media(media_root):
    project = media_root / "DelTest"
    project.mkdir(parents=True)
    target = project / "del_me.png"
    img = Image.new("RGB", (10, 10))
    img.save(str(target))
    assert target.exists()

    from src.routers.bridge import _delete_bridge_media
    result = _delete_bridge_media("del_me")
    assert result is not None
    assert not target.exists()


def test_delete_bridge_media_not_found(media_root):
    from src.routers.bridge import _delete_bridge_media
    assert _delete_bridge_media("nonexistent") is None
