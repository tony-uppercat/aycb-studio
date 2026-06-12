"""LLM router — chat with Gemini and Claude models."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.shared import (
    _log, _read_upload,
    _require_key, _require_prompt,
    _estimate_cost, _classify_error,
    MODELS, MAX_IMAGE_BYTES,
)
from src import claude_cli

router = APIRouter(prefix="/api/llm", tags=["llm"])


def _is_claude_model(model_id: str) -> bool:
    return model_id.startswith("claude-")


@router.post("/chat")
async def llm_chat_endpoint(
    prompt: str = Form(...),
    system_prompt: str = Form(""),
    api_key: str = Form(""),
    model: str = Form("Gemini 3 Flash"),
    skills_mode: bool = Form(False),
    skills: str = Form(""),
    media_files: list[UploadFile] | None = File(default=None),
):
    import time

    clean_prompt = _require_prompt(prompt)
    model_id = MODELS.get(model, model)

    if claude_cli.is_claude_cli_model(model_id):
        skill_names = [s.strip() for s in skills.split(",") if s.strip()]
        return await _chat_claude_cli(
            clean_prompt, system_prompt, model_id, media_files,
            time.time(), skills_mode, skill_names,
        )
    if _is_claude_model(model_id):
        return await _chat_claude(clean_prompt, system_prompt, api_key, model_id, media_files, time.time())
    return await _chat_gemini(clean_prompt, system_prompt, api_key, model_id, media_files, time.time())


async def _chat_claude(
    prompt: str, system_prompt: str, api_key: str,
    model_id: str, media_files: list[UploadFile] | None, t0: float,
):
    """Handle Claude (Anthropic) model requests."""
    import time
    import base64
    import anthropic

    effective_key = _require_key(api_key, "anthropic")
    media_count = len(media_files) if media_files else 0
    _log(f"LLM chat (Claude) — model={model_id}, {media_count} media, prompt={prompt[:80]}...")

    try:
        client = anthropic.Anthropic(api_key=effective_key)

        content: list[dict] = []
        if media_files:
            for f in media_files:
                raw = await _read_upload(f, MAX_IMAGE_BYTES, "Media")
                mime = f.content_type or "image/png"
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime,
                        "data": base64.b64encode(raw).decode(),
                    },
                })
        content.append({"type": "text", "text": prompt})

        kwargs: dict = {
            "model": model_id,
            "max_tokens": 8192,
            "messages": [{"role": "user", "content": content}],
        }
        if system_prompt.strip():
            kwargs["system"] = system_prompt.strip()

        response = await asyncio.to_thread(lambda: client.messages.create(**kwargs))

        text = "".join(b.text for b in response.content if b.type == "text")
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }
        cost = _estimate_cost(model_id, usage)

        dt = time.time() - t0
        _log(f"LLM chat (Claude) complete — {len(text)} chars ({dt:.1f}s)")
        return {"text": text, "status": "OK", "usage": cost}
    except anthropic.APIStatusError as exc:
        dt = time.time() - t0
        _log(f"LLM chat (Claude) FAILED — {exc.status_code} {exc.message} ({dt:.1f}s)")
        raise HTTPException(exc.status_code, detail=exc.message)
    except Exception as exc:
        dt = time.time() - t0
        _log(f"LLM chat (Claude) FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)


async def _chat_claude_cli(
    prompt: str, system_prompt: str, model_id: str,
    media_files: list[UploadFile] | None, t0: float,
    skills_mode: bool = False, skill_names: list[str] | None = None,
):
    """Handle Claude via the local `claude` CLI — subscription auth, no API key. Uploaded
    media are written to a temp dir so claude can Read them; the dir is removed after."""
    import time
    import tempfile
    from pathlib import Path

    media_count = len(media_files) if media_files else 0
    _log(f"LLM chat (Claude CLI) — model={model_id}, {media_count} media, prompt={prompt[:80]}...")

    try:
        with tempfile.TemporaryDirectory(prefix="aycb_claude_") as tmp:
            image_paths: list[str] = []
            if media_files:
                for i, f in enumerate(media_files):
                    raw = await _read_upload(f, MAX_IMAGE_BYTES, "Media")
                    name = f.filename or ""
                    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
                    p = Path(tmp) / f"media_{i}.{ext}"
                    p.write_bytes(raw)
                    image_paths.append(str(p))
            # System prompt goes to a file, not argv — a large one blows the Windows
            # ~8191-char command-line limit ("The command line is too long").
            system_file: str | None = None
            if system_prompt and system_prompt.strip():
                sf = Path(tmp) / "system.txt"
                sf.write_text(system_prompt.strip(), encoding="utf-8")
                system_file = str(sf)
            result = await asyncio.to_thread(
                claude_cli.run, prompt, model_id, system_file, image_paths,
                None, skills_mode, skill_names,
            )
        dt = time.time() - t0
        if result.get("status") != "OK":
            _log(f"LLM chat (Claude CLI) FAILED — {result.get('error')} ({dt:.1f}s)")
            raise HTTPException(422, detail=result.get("error") or "Claude CLI failed")
        _log(f"LLM chat (Claude CLI) complete — {len(result['text'])} chars ({dt:.1f}s)")
        return {"text": result["text"], "status": "OK", "usage": result["usage"]}
    except HTTPException:
        raise
    except Exception as exc:
        dt = time.time() - t0
        _log(f"LLM chat (Claude CLI) FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)


async def _chat_gemini(
    prompt: str, system_prompt: str, api_key: str,
    model_id: str, media_files: list[UploadFile] | None, t0: float,
):
    """Handle Gemini (Google) model requests."""
    import time
    from google import genai
    from google.genai import types as genai_types
    from src.gemini import _call_with_gemini_retries

    effective_key = _require_key(api_key, "gemini")

    # Handle :thinking suffix — strip it and enable thinking config
    is_thinking = model_id.endswith(":thinking")
    if is_thinking:
        model_id = model_id.replace(":thinking", "")
    is_gemini3 = model_id.startswith("gemini-3")

    # Gemini 3.1 Pro has thinking always enabled
    if model_id == "gemini-3.1-pro-preview":
        is_thinking = True

    media_count = len(media_files) if media_files else 0
    _log(f"LLM chat (Gemini) — model={model_id}, thinking={is_thinking}, {media_count} media, prompt={prompt[:80]}...")

    try:
        client = genai.Client(api_key=effective_key)

        parts = []
        if media_files:
            for f in media_files:
                raw = await _read_upload(f, MAX_IMAGE_BYTES, "Media")
                mime = f.content_type or "image/png"
                parts.append(genai_types.Part.from_bytes(data=raw, mime_type=mime))
        parts.append(genai_types.Part.from_text(text=prompt))

        config_kwargs: dict = {}
        if system_prompt.strip():
            config_kwargs["system_instruction"] = system_prompt.strip()
        if is_thinking and is_gemini3:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                include_thoughts=True, thinking_level="high"
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
        _log(f"LLM chat (Gemini) complete — {len(text)} chars ({dt:.1f}s)")
        return {"text": text, "status": "OK", "usage": cost}
    except Exception as exc:
        dt = time.time() - t0
        _log(f"LLM chat (Gemini) FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)
