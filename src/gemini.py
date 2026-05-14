"""Gemini 2.0 Flash vision + Embedding 2 — core module."""

from __future__ import annotations

import io
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import cv2
import numpy as np
from PIL import Image
from rich.console import Console

from config.settings import settings

console = Console()

SEPARATOR = "---JSON---"

# ── Token usage tracking ──────────────────────────────────────────────────

# DEPRECATED: kept for backward-compat; prefer the `usage` field returned by
# _call_with_gemini_retries and higher-level functions.
_last_usage: dict | None = None


def get_last_usage() -> dict | None:
    """Return the last captured usage metadata and reset it.

    DEPRECATED — prefer reading the ``usage`` key from the tuple returned by
    ``_call_with_gemini_retries``, ``analyze_image``, ``process_image``, etc.
    """
    global _last_usage
    u = _last_usage
    _last_usage = None
    return u


def _extract_usage(result: object) -> dict | None:
    """Extract token usage from a Gemini API response object."""
    meta = getattr(result, 'usage_metadata', None)
    if not meta:
        return None
    return {
        'input_tokens': getattr(meta, 'prompt_token_count', 0) or 0,
        'output_tokens': getattr(meta, 'candidates_token_count', 0) or 0,
        'total_tokens': getattr(meta, 'total_token_count', 0) or 0,
    }


def _parse_retry_delay_seconds(err: Exception) -> float | None:
    """
    Extract a retry delay like "retryDelay': '54s'" or '54.9s' from the API error.
    """
    text = str(err)
    match = re.search(
        r"retryDelay['\"]?\s*:\s*['\"](?P<secs>\d+(?:\.\d+)?)s['\"]",
        text,
    )
    if not match:
        return None
    try:
        return float(match.group("secs"))
    except (TypeError, ValueError) as exc:
        console.print(f"[yellow]Gemini retry-delay parse error: {exc}[/]")
        return None


def _call_with_gemini_retries(call: Callable[[], Any], operation: str) -> tuple[Any, dict | None]:
    """Retry Gemini calls on quota/rate-limit exhaustion (typically HTTP 429).

    Returns ``(result, usage)`` where *usage* is a dict with token counts or
    ``None`` when the response carries no usage metadata.  This avoids the
    previous thread-unsafe global ``_last_usage`` pattern.
    """
    max_retries = max(0, getattr(settings, "api_max_retries", 3))
    max_delay = float(getattr(settings, "api_retry_max_delay_seconds", 120.0))

    global _last_usage  # still populated for backward-compat
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            result = call()
            usage = _extract_usage(result)
            _last_usage = usage  # backward-compat
            return result, usage
        except Exception as exc:  # google-genai errors inherit from Exception
            last_exc = exc
            msg = str(exc).lower()

            is_quota = (
                "resource_exhausted" in msg
                or "429" in msg
                or "quota exceeded" in msg
                or "rate limit" in msg
            )
            if not is_quota or attempt >= max_retries:
                raise RuntimeError(
                    f"Gemini API call failed during {operation}. "
                    f"Last error: {exc}"
                ) from exc

            # Prefer provider's suggested retry delay, otherwise exponential backoff.
            provider_delay = _parse_retry_delay_seconds(exc)
            if provider_delay is not None:
                delay = max(1.0, provider_delay)
            else:
                delay = max(1.0, 2.0**attempt)
            delay = min(delay, max_delay)

            console.print(
                f"[yellow]Gemini quota/rate limit exhausted. "
                f"Retrying {attempt + 1}/{max_retries + 1} in {delay:.1f}s...[/]"
            )
            time.sleep(delay)

    # Should never happen, but keeps type-checkers happy.
    assert last_exc is not None
    raise RuntimeError(f"Gemini API call failed during {operation}.") from last_exc


# ── Data ────────────────────────────────────────────────────────────────────


@dataclass
class AnalysisResult:
    """Output of vision analysis for a single image."""

    prompt_text: str = ""
    prompt_json: dict = field(default_factory=dict)
    embedding: list[float] | None = None
    raw_response: str = ""
    source_path: str = ""


# ── Client ──────────────────────────────────────────────────────────────────


def _get_client(api_key: str | None = None):
    from google import genai

    key = api_key or settings.gemini_api_key
    if not key:
        raise RuntimeError(
            "AYCB_GEMINI_API_KEY is not set. "
            "Add it to your .env file or set the environment variable."
        )
    return genai.Client(api_key=key)


def _to_pil(frame_bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))


# ── Prompt ──────────────────────────────────────────────────────────────────


def _load_prompt() -> str:
    path = settings.prompts_dir / "analyze.txt"
    return path.read_text(encoding="utf-8")


# ── Response parsing ────────────────────────────────────────────────────────


def _parse_response(text: str) -> tuple[str, dict]:
    """Split VLM output into descriptive text and structured JSON.

    Tries direct JSON parse first (for structured-output responses), then
    falls back to the legacy separator / code-block extraction so that
    responses from models or prompts that don't use structured output still
    work correctly.
    """
    # Fast path: structured-output responses are already valid JSON.
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return text.strip(), parsed
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        console.print(f"[dim]Gemini structured-output parse miss (falling back to legacy): {exc}[/]")

    # Legacy path: look for ---JSON--- separator or ```json … ``` block.
    prompt_text = ""
    prompt_json: dict = {}

    if SEPARATOR in text:
        parts = text.split(SEPARATOR, 1)
        prompt_text = parts[0].strip()
        json_part = parts[1].strip()
    else:
        json_match = re.search(r"```json\s*(.*?)```", text, re.DOTALL)
        if json_match:
            json_part = json_match.group(1).strip()
            prompt_text = text[: json_match.start()].strip()
        else:
            return text.strip(), {}

    try:
        prompt_json = json.loads(json_part)
    except json.JSONDecodeError:
        obj_match = re.search(r"\{.*\}", json_part, re.DOTALL)
        if obj_match:
            try:
                prompt_json = json.loads(obj_match.group())
            except json.JSONDecodeError as exc:
                console.print(f"[yellow]Gemini JSON extraction failed after fallback: {exc}[/]")

    return prompt_text, prompt_json


# ── Vision ──────────────────────────────────────────────────────────────────


def analyze_image(
    frame_bgr: np.ndarray,
    *,
    model_id: str | None = None,
    custom_prompt: str | None = None,
    force_json: bool = True,
    api_key: str | None = None,
) -> tuple[str, dict, str, dict | None]:
    """Analyze a frame with Gemini.

    When *custom_prompt* is provided it overrides the default analyze.txt prompt.
    When *force_json* is False, the response_mime_type constraint is removed
    to allow descriptive plain-text output (used by Video Analysis node).
    Supports ``:thinking`` suffix on *model_id* for deep reasoning.

    Returns ``(text, json_dict, raw, usage)``.
    """
    from google.genai import types

    client = _get_client(api_key)
    pil = _to_pil(frame_bgr)
    prompt = custom_prompt if custom_prompt else _load_prompt()
    use_model = model_id or settings.gemini_flash_model

    # Handle :thinking suffix
    is_thinking = use_model.endswith(":thinking")
    if is_thinking:
        use_model = use_model.replace(":thinking", "")

    config_kwargs: dict = {}
    if force_json:
        config_kwargs["response_mime_type"] = "application/json"
    if is_thinking:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            include_thoughts=True, thinking_level="HIGH"
        )

    config = types.GenerateContentConfig(**config_kwargs)

    response, usage = _call_with_gemini_retries(
        lambda: client.models.generate_content(
            model=use_model,
            contents=[pil, prompt],
            config=config,
        ),
        operation="generate_content",
    )
    raw = response.text
    text, json_dict = _parse_response(raw)
    return text, json_dict, raw, usage


# ── Embedding ───────────────────────────────────────────────────────────────


def embed_image(frame_bgr: np.ndarray, api_key: str | None = None) -> list[float]:
    """Generate an embedding vector for a frame."""
    client = _get_client(api_key)
    pil = _to_pil(frame_bgr)

    result, _usage = _call_with_gemini_retries(
        lambda: client.models.embed_content(
            model=settings.gemini_embedding_model,
            contents=pil,
        ),
        operation="embed_content",
    )
    return list(result.embeddings[0].values)


# ── Image Generation (Nano Banana 2) ───────────────────────────────────────

NANO_BANANA_MODEL = "gemini-3.1-flash-image-preview"


def generate_image(
    prompt: str,
    reference_images: list[Image.Image] | None = None,
    model_id: str | None = None,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    api_key: str | None = None,
    use_grounding: bool = False,
    thinking: bool = True,
) -> Image.Image | None:
    """Generate an image using Gemini generateContent with IMAGE modality."""
    from google.genai import types

    client = _get_client(api_key)
    use_model = model_id or NANO_BANANA_MODEL

    contents: list = []
    if reference_images:
        contents.extend(reference_images[:14])
    contents.append(prompt)

    # Map 0.5K → 512 (SDK expects literal "512"); other buckets pass through.
    mapped_size = "512" if image_size == "0.5K" else image_size

    # Build image config for resolution/aspect control
    image_cfg: dict = {}
    if aspect_ratio:
        image_cfg["aspect_ratio"] = aspect_ratio
    if mapped_size:
        image_cfg["image_size"] = mapped_size
    image_config = types.ImageConfig(**image_cfg) if image_cfg else None

    # Grounding requires TEXT+IMAGE modalities so the model can return search metadata
    modalities = ["TEXT", "IMAGE"] if use_grounding else ["IMAGE"]

    config_kwargs: dict = {}
    if image_config:
        config_kwargs["image_config"] = image_config
    if use_grounding:
        config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
    # thinking_config is configurable ONLY for gemini-3.1-flash-image-preview.
    # Pro Image has built-in auto-thinking and rejects explicit thinking_config.
    if thinking and use_model == "gemini-3.1-flash-image-preview":
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            include_thoughts=True, thinking_level="HIGH",
        )

    response, _usage = _call_with_gemini_retries(
        lambda: client.models.generate_content(
            model=use_model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=modalities,
                **config_kwargs,
            ),
        ),
        operation="generate_image",
    )

    # Check for blocked/empty responses
    if not response.candidates:
        reason = getattr(response, 'prompt_feedback', None)
        raise RuntimeError(f"Image generation blocked by API. Feedback: {reason}")

    candidate = response.candidates[0]
    finish = getattr(candidate, 'finish_reason', None)
    parts = getattr(candidate.content, 'parts', None) or []

    for part in parts:
        if part.inline_data is not None:
            return Image.open(io.BytesIO(part.inline_data.data))

    # No image found — build diagnostic message
    text_parts = [p.text for p in parts if hasattr(p, 'text') and p.text]
    diag = f"finish_reason={finish}"
    if text_parts:
        diag += f", model replied: {text_parts[0][:200]}"
    raise RuntimeError(f"No image generated ({diag}). Try a shorter, descriptive prompt instead of raw JSON.")


# ── High-level: process one image ───────────────────────────────────────────


def process_image(
    frame_bgr: np.ndarray,
    source_path: str = "",
    do_embed: bool = False,
    model_id: str | None = None,
    custom_prompt: str | None = None,
    force_json: bool = True,
    api_key: str | None = None,
) -> tuple["AnalysisResult", dict | None]:
    """Full analysis of a single image: vision + optional embedding.

    Returns ``(result, usage)``.
    """
    text, json_dict, raw, usage = analyze_image(
        frame_bgr, model_id=model_id, custom_prompt=custom_prompt, force_json=force_json,
        api_key=api_key,
    )

    embedding = None
    if do_embed:
        embedding = embed_image(frame_bgr, api_key=api_key)

    return AnalysisResult(
        prompt_text=text,
        prompt_json=json_dict,
        embedding=embedding,
        raw_response=raw,
        source_path=source_path,
    ), usage
