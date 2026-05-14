"""Verify generate_image() passes thinkingConfig + 0.5K mapping + 14-ref cap."""
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from src import gemini


def _fake_inline_response():
    """Mock a successful inline image response with a minimal valid PNG."""
    # Minimal 1x1 PNG (valid magic bytes + IHDR + IEND)
    png_bytes = (
        b'\x89PNG\r\n\x1a\n'  # PNG magic
        b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x02\x00\x00\x00\x90wS\xde'  # width=1, height=1, 8-bit RGB
        b'\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05'
        b'\xd9\xd7Nl'  # minimal pixel data
        b'\x00\x00\x00\x00IEND\xaeB`\x82'  # IEND chunk
    )
    part = MagicMock()
    part.inline_data = MagicMock()
    part.inline_data.data = png_bytes
    candidate = MagicMock()
    candidate.content.parts = [part]
    candidate.finish_reason = None
    response = MagicMock()
    response.candidates = [candidate]
    response.usage_metadata = None
    return response


def test_generate_image_passes_thinking_config_by_default():
    """Verify thinking_config is set with HIGH level + include_thoughts by default."""
    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", api_key="fake-key")

        kwargs = sdk.models.generate_content.call_args.kwargs
        config = kwargs["config"]
        thinking = getattr(config, "thinking_config", None)
        assert thinking is not None, "thinking_config should be set by default"
        assert thinking.thinking_level == "HIGH"
        assert thinking.include_thoughts is True


def test_generate_image_thinking_false_skips_config():
    """Verify thinking_config is not set when thinking=False."""
    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", api_key="fake-key", thinking=False)

        config = sdk.models.generate_content.call_args.kwargs["config"]
        assert getattr(config, "thinking_config", None) is None


def test_generate_image_maps_0_5k_to_512():
    """Verify 0.5K image_size is mapped to '512'."""
    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", api_key="fake-key", image_size="0.5K")

        config = sdk.models.generate_content.call_args.kwargs["config"]
        assert config.image_config.image_size == "512"


def test_generate_image_accepts_14_refs():
    """Verify reference_images are sliced to 14 (not 8)."""
    refs = [Image.new("RGB", (2, 2), "red") for _ in range(14)]

    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", reference_images=refs, api_key="fake-key")

        contents = sdk.models.generate_content.call_args.kwargs["contents"]
        # contents = refs (14 PIL images) + 1 prompt string
        assert len(contents) == 15


def test_generate_image_caps_excess_refs_at_14():
    """If caller passes more than 14 refs, generate_image must slice down to 14."""
    refs = [Image.new("RGB", (2, 2), "red") for _ in range(20)]

    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", reference_images=refs, api_key="fake-key")

        contents = sdk.models.generate_content.call_args.kwargs["contents"]
        # 20 refs passed → sliced to 14 + 1 prompt = 15
        assert len(contents) == 15


def test_generate_image_skips_thinking_config_for_pro_image():
    """Pro Image has built-in thinking; thinking_config must not be sent."""
    with patch.object(gemini, "_get_client") as mock_client, \
         patch.object(gemini, "_call_with_gemini_retries") as mock_retries:
        sdk = mock_client.return_value
        sdk.models.generate_content.return_value = _fake_inline_response()
        mock_retries.side_effect = lambda call, operation: (call(), None)

        gemini.generate_image(prompt="hello", model_id="gemini-3-pro-image-preview", api_key="fake-key", thinking=True)

        config = sdk.models.generate_content.call_args.kwargs["config"]
        assert getattr(config, "thinking_config", None) is None, \
            "thinking_config must NOT be sent to Pro Image (auto-thinking model)"
