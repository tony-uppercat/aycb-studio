"""LLM router — chat with Gemini models."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.shared import (
    _log, _read_upload,
    _require_api_key, _require_prompt, _estimate_cost, _classify_error,
    MODELS, MAX_IMAGE_BYTES,
)

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.post("/chat")
async def llm_chat_endpoint(
    prompt: str = Form(...),
    system_prompt: str = Form(""),
    api_key: str = Form(""),
    model: str = Form("Gemini 3 Flash"),
    media_files: list[UploadFile] | None = File(default=None),
):
    import time

    clean_prompt = _require_prompt(prompt)
    effective_key = _require_api_key(api_key)

    model_id = MODELS.get(model, model)

    # Handle :thinking suffix — strip it and enable thinking config
    is_thinking = model_id.endswith(":thinking")
    if is_thinking:
        model_id = model_id.replace(":thinking", "")
    is_gemini3 = model_id.startswith("gemini-3")

    # Gemini 3.1 Pro has thinking always enabled — auto-set thinking config
    is_always_thinking = model_id == "gemini-3.1-pro-preview"
    if is_always_thinking:
        is_thinking = True

    media_count = len(media_files) if media_files else 0
    _log(f"LLM chat — model={model_id}, thinking={is_thinking}, {media_count} media, prompt={clean_prompt[:80]}...")

    t0 = time.time()
    try:
        client = genai.Client(api_key=effective_key)

        parts = []
        if media_files:
            for f in media_files:
                raw = await _read_upload(f, MAX_IMAGE_BYTES, "Media")
                mime = f.content_type or "image/png"
                parts.append(genai_types.Part.from_bytes(data=raw, mime_type=mime))
        parts.append(genai_types.Part.from_text(text=clean_prompt))

        config_kwargs: dict = {}
        if system_prompt.strip():
            config_kwargs["system_instruction"] = system_prompt.strip()
        if is_thinking:
            if is_gemini3:
                config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                    include_thoughts=True, thinking_level="HIGH"
                )
            else:
                config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                    include_thoughts=True, thinking_budget=-1
                )
        config = genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

        contents = [{"role": "user", "parts": parts}]

        response, usage = await asyncio.to_thread(
            lambda: _call_with_gemini_retries(
                lambda: client.models.generate_content(model=model_id, contents=contents, config=config),
                operation="llm_chat",
            )
        )
        cost = _estimate_cost(model_id, usage)

        # Extract thinking + answer parts
        resp_parts = getattr(response.candidates[0].content, "parts", None) or []
        thought_parts = [p.text for p in resp_parts if getattr(p, "thought", False) and p.text]
        answer_parts = [p.text for p in resp_parts if not getattr(p, "thought", False) and p.text]

        if is_thinking and thought_parts:
            text = f"<thinking>\n{''.join(thought_parts)}\n</thinking>\n\n{''.join(answer_parts)}"
        else:
            text = "".join(answer_parts) or response.text or ""
        dt = time.time() - t0
        _log(f"LLM chat complete — {len(text)} chars ({dt:.1f}s)")
        return {"text": text, "status": "OK", "usage": cost}
    except Exception as exc:
        dt = time.time() - t0
        _log(f"LLM chat FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)
