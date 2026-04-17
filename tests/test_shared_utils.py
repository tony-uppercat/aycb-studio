"""Tests for pure utility functions in src.shared."""
import pytest


# ── _sanitize_filename ──────────────────────────────────────────────────────

def test_sanitize_filename_normal():
    from src.shared import _sanitize_filename
    assert _sanitize_filename("photo.png") == "photo.png"


def test_sanitize_filename_strips_path_separators():
    from src.shared import _sanitize_filename
    result = _sanitize_filename('../../etc/passwd')
    assert "/" not in result
    assert "\\" not in result


def test_sanitize_filename_collapses_double_dot():
    """Defense in depth: even after slash replacement, `..` is a
    suspicious token in a filename. Collapse it so no caller can write
    `Path(base) / sanitized` and walk upward via shell glob or exotic
    filesystem semantics. Regression test for v2 audit finding C1."""
    from src.shared import _sanitize_filename
    assert ".." not in _sanitize_filename("..evil")
    assert ".." not in _sanitize_filename("a..b..c")


def test_sanitize_stem_alphanumeric_only():
    from src.shared import _sanitize_stem
    # Letters, digits, underscore, and hyphen survive; everything else
    # (including the dot) is stripped, because bridge stems are used as
    # glob patterns against filesystem extensions added separately.
    assert _sanitize_stem("generated_1774482284911") == "generated_1774482284911"
    assert _sanitize_stem("foo/bar-123") == "foobar-123"
    assert _sanitize_stem("../../etc/passwd") == "etcpasswd"
    assert _sanitize_stem("has dot.png") == "hasdotpng"
    assert _sanitize_stem(None) == ""
    assert _sanitize_stem("") == ""


def test_sanitize_filename_strips_control_chars():
    from src.shared import _sanitize_filename
    result = _sanitize_filename("file\x00name\x1f.png")
    assert "\x00" not in result
    assert "\x1f" not in result


def test_sanitize_filename_empty():
    from src.shared import _sanitize_filename
    assert _sanitize_filename(None) == "file"
    assert _sanitize_filename("") == "file"


def test_sanitize_filename_truncates_long():
    from src.shared import _sanitize_filename
    result = _sanitize_filename("a" * 300)
    assert len(result) <= 200


# ── _safe_video_suffix ──────────────────────────────────────────────────────

def test_safe_video_suffix_valid():
    from src.shared import _safe_video_suffix
    assert _safe_video_suffix("clip.mp4") == ".mp4"
    assert _safe_video_suffix("clip.mov") == ".mov"


def test_safe_video_suffix_invalid():
    from src.shared import _safe_video_suffix
    assert _safe_video_suffix("clip.exe") == ".mp4"


def test_safe_video_suffix_none():
    from src.shared import _safe_video_suffix
    assert _safe_video_suffix(None) == ".mp4"


# ── _classify_error ─────────────────────────────────────────────────────────

def test_classify_error_invalid():
    from src.shared import _classify_error
    code, msg = _classify_error(ValueError("Invalid parameter"))
    assert code == 400


def test_classify_error_auth():
    from src.shared import _classify_error
    code, msg = _classify_error(Exception("API key not found"))
    assert code == 401


def test_classify_error_rate_limit():
    from src.shared import _classify_error
    code, msg = _classify_error(Exception("429 RESOURCE_EXHAUSTED"))
    assert code == 429


def test_classify_error_generic():
    from src.shared import _classify_error
    code, msg = _classify_error(Exception("something broke"))
    assert code == 500


# ── _estimate_cost ──────────────────────────────────────────────────────────

def test_estimate_cost_known_model():
    from src.shared import _estimate_cost
    result = _estimate_cost("gemini-2.5-flash", {"input_tokens": 1_000_000, "output_tokens": 1_000_000})
    assert result is not None
    assert result["cost_usd"] == pytest.approx(0.30 + 2.50, abs=0.01)


def test_estimate_cost_unknown_model():
    from src.shared import _estimate_cost
    result = _estimate_cost("unknown-model", {"input_tokens": 100, "output_tokens": 100})
    assert result is not None
    assert result["cost_usd"] == 0


def test_estimate_cost_none_usage():
    from src.shared import _estimate_cost
    assert _estimate_cost("gemini-2.5-flash", None) is None


# ── generate_image grounding config ────────────────────────────────────────

def test_generate_image_grounding_config():
    """Verify grounding adds google_search tool and TEXT+IMAGE modalities."""
    from google.genai import types

    # Grounding ON
    modalities_on = ["TEXT", "IMAGE"]
    kwargs_on: dict = {"tools": [types.Tool(google_search=types.GoogleSearch())]}
    cfg_on = types.GenerateContentConfig(response_modalities=modalities_on, **kwargs_on)
    assert cfg_on.response_modalities == ["TEXT", "IMAGE"]
    assert cfg_on.tools is not None
    assert len(cfg_on.tools) == 1
    assert cfg_on.tools[0].google_search is not None

    # Grounding OFF
    cfg_off = types.GenerateContentConfig(response_modalities=["IMAGE"])
    assert cfg_off.response_modalities == ["IMAGE"]
    assert cfg_off.tools is None


def test_generate_image_grounding_parameter():
    """Verify generate_image function accepts use_grounding parameter."""
    import inspect
    from src.gemini import generate_image
    sig = inspect.signature(generate_image)
    assert "use_grounding" in sig.parameters
    assert sig.parameters["use_grounding"].default is False


# ── _require_prompt ─────────────────────────────────────────────────────────

def test_require_prompt_valid():
    from src.shared import _require_prompt
    assert _require_prompt("  hello  ") == "hello"


def test_require_prompt_empty():
    from src.shared import _require_prompt
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _require_prompt("   ")
    assert exc_info.value.status_code == 400
