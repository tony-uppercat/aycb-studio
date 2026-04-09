"""Tests for the image edit router — config building, validation."""
import pytest


def test_vertex_client_raises_without_gcp_project():
    """_get_vertex_client raises ValueError if gcp_project is empty."""
    from src.routers.image_edit import _get_vertex_client, _reset_vertex_client
    from config.settings import settings

    _reset_vertex_client()
    original = settings.gcp_project
    try:
        settings.gcp_project = ""
        with pytest.raises(ValueError, match="GCP project is not configured"):
            _get_vertex_client()
    finally:
        settings.gcp_project = original
        _reset_vertex_client()


def test_needs_mask_modes():
    """Verify which edit modes require a mask."""
    from src.routers.image_edit import _NEEDS_MASK
    assert "EDIT_MODE_INPAINT_REMOVAL" in _NEEDS_MASK
    assert "EDIT_MODE_INPAINT_INSERTION" in _NEEDS_MASK
    assert "EDIT_MODE_OUTPAINT" in _NEEDS_MASK
    assert "EDIT_MODE_BGSWAP" not in _NEEDS_MASK
    assert "EDIT_MODE_PRODUCT_IMAGE" not in _NEEDS_MASK


def test_pil_to_b64_roundtrip():
    """_pil_to_b64 produces valid base64 PNG."""
    import base64
    import io
    from PIL import Image as PILImage
    from src.routers.image_edit import _pil_to_b64

    img = PILImage.new("RGB", (64, 64), color=(255, 0, 0))
    b64 = _pil_to_b64(img)
    decoded = base64.b64decode(b64)
    restored = PILImage.open(io.BytesIO(decoded))
    assert restored.size == (64, 64)


def test_edit_mode_enum_values():
    """Verify EditMode enum has the expected values."""
    from google.genai.types import EditMode
    assert hasattr(EditMode, "EDIT_MODE_INPAINT_REMOVAL")
    assert hasattr(EditMode, "EDIT_MODE_INPAINT_INSERTION")
    assert hasattr(EditMode, "EDIT_MODE_OUTPAINT")
    assert hasattr(EditMode, "EDIT_MODE_BGSWAP")
    assert hasattr(EditMode, "EDIT_MODE_PRODUCT_IMAGE")


def test_reference_image_types_exist():
    """Verify all reference image types we use exist in the SDK."""
    from google.genai import types
    assert hasattr(types, "RawReferenceImage")
    assert hasattr(types, "MaskReferenceImage")
    assert hasattr(types, "SubjectReferenceImage")
    assert hasattr(types, "MaskReferenceConfig")
    assert hasattr(types, "SubjectReferenceConfig")
    assert hasattr(types, "EditImageConfig")
