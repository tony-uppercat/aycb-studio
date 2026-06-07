"""Google Gemini Batch API wrapper.

Wraps google.genai.Client().batches and .files for submit/get/cancel/parse.
Applies the 0.5 BATCH_DISCOUNT to costs.
"""
from __future__ import annotations

import asyncio
import base64
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo

from src.batch_gen.models import BatchRequest, BatchResult, JobState
from src.shared import MODEL_PRICING, _log

BATCH_DISCOUNT = 0.5
_GOOGLE_TO_STATE = {
    "JOB_STATE_RUNNING": JobState.RUNNING,
    "JOB_STATE_PENDING": JobState.RUNNING,
    "JOB_STATE_QUEUED": JobState.RUNNING,
    "JOB_STATE_SUCCEEDED": JobState.SUCCEEDED,
    "JOB_STATE_FAILED": JobState.FAILED,
    "JOB_STATE_CANCELLED": JobState.CANCELLED,
    "JOB_STATE_EXPIRED": JobState.EXPIRED,
}

_AVG_PER_IMAGE = {
    "gemini-3-pro-image-preview": 0.134,
    "gemini-3.1-flash-image-preview": 0.067,
    "gemini-3.1-flash-lite-image-preview": 0.040,
}


@dataclass
class JobStateInfo:
    state: JobState
    result_file: str | None
    error: str | None


def _is_high_res(resolution: str) -> bool:
    return resolution in ("2K", "4K")


def build_jsonl_lines(requests: list[BatchRequest]) -> list[str]:
    """Build one JSONL line per request matching Gemini Batch schema."""
    lines: list[str] = []
    for req in requests:
        parts: list[dict[str, Any]] = []
        for b64, mime in zip(req.refs_b64, req.refs_mime):
            parts.append({"inlineData": {"mimeType": mime, "data": b64}})
        parts.append({"text": req.prompt})

        gen_cfg: dict[str, Any] = {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "imageSize": req.resolution,
                "aspectRatio": req.aspect_ratio,
            },
        }
        # Memo feedback_gemini_thinking_imagesize: explicit thinking + >=2K degrades.
        if req.thinking and not _is_high_res(req.resolution):
            gen_cfg["thinkingConfig"] = {"thinkingLevel": "high"}
        if req.grounding:
            gen_cfg["tools"] = [{"google_search": {}}]

        entry = {
            "key": req.key,
            "request": {
                "contents": [{"parts": parts}],
                "generation_config": gen_cfg,
            },
        }
        lines.append(json.dumps(entry))
    return lines


def estimate_batch_cost(model: str, count: int) -> float:
    """Discounted budget estimate for `count` requests on `model`."""
    avg = _AVG_PER_IMAGE.get(model, 0.10)
    return round(avg * BATCH_DISCOUNT * count, 6)


def _decode_image(resp: dict[str, Any]) -> bytes | None:
    candidates = resp.get("candidates") or []
    if not candidates:
        return None
    parts = candidates[0].get("content", {}).get("parts") or []
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    return None


def _cost_for_response(model: str, resp: dict[str, Any]) -> float:
    """Discounted cost using token counts from response.usageMetadata."""
    usage = resp.get("usageMetadata") or {}
    in_tok = usage.get("promptTokenCount", 0)
    out_tok = usage.get("candidatesTokenCount", 0)
    rates = MODEL_PRICING.get(model, (0.0, 0.0))
    full = (in_tok / 1_000_000) * rates[0] + (out_tok / 1_000_000) * rates[1]
    return round(full * BATCH_DISCOUNT, 6)


def parse_result_line(
    *, line: dict[str, Any], model: str, media_dir: Path, prompt: str
) -> BatchResult:
    """Process one JSONL line from the result file.

    On success, writes a PNG to `media_dir` with tEXt metadata and returns
    a populated BatchResult. On per-request failure, returns BatchResult with
    `error` set and no media_path.
    """
    key = line.get("key", "?")
    if line.get("error"):
        return BatchResult(
            request_key=key,
            error=json.dumps(line["error"])[:300],
        )
    resp = line.get("response")
    if not resp:
        return BatchResult(request_key=key, error="no response in result line")

    img_bytes = _decode_image(resp)
    if img_bytes is None:
        finish = (resp.get("candidates") or [{}])[0].get("finishReason", "?")
        return BatchResult(request_key=key, error=f"no inline image (finish={finish})")

    media_id = uuid.uuid4().hex
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"{ts}_batch_{key}_{media_id[:8]}.png"
    out_path = media_dir / out_name

    cost = _cost_for_response(model, resp)
    try:
        from io import BytesIO
        pil = PILImage.open(BytesIO(img_bytes))
        meta = PngInfo()
        meta.add_text("prompt", prompt[:4000])
        meta.add_text("model", model)
        meta.add_text("cost_usd", f"{cost:.6f}")
        meta.add_text("source", "batch_api")
        pil.save(out_path, format="PNG", pnginfo=meta)
    except Exception as exc:
        _log(f"batch_gen: PNG write failed for {key}: {exc}")
        out_path.write_bytes(img_bytes)

    return BatchResult(
        request_key=key,
        media_path=str(out_path.relative_to(media_dir.parent)),
        media_id=media_id,
        cost=cost,
    )


class GeminiBatchProvider:
    """Thin async wrapper over google.genai batch + files endpoints."""

    def __init__(self, client: Any, scratch_dir: Path):
        self._client = client
        self._scratch = scratch_dir
        self._scratch.mkdir(parents=True, exist_ok=True)

    async def submit(
        self, *, model: str, requests: list[BatchRequest], display_name: str
    ) -> str:
        """Build JSONL, upload via Files API, create batch job. Returns job.name."""
        lines = build_jsonl_lines(requests)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        jsonl_path = self._scratch / f"batch_{ts}_{uuid.uuid4().hex[:8]}.jsonl"
        jsonl_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

        def _do_submit() -> str:
            try:
                from google.genai import types  # type: ignore
                cfg = types.UploadFileConfig(
                    display_name=jsonl_path.stem,
                    mime_type="jsonl",
                )
            except ImportError:
                cfg = None  # tests inject MagicMock client
            uploaded = self._client.files.upload(file=jsonl_path, config=cfg)
            job = self._client.batches.create(
                model=model,
                src=uploaded.name,
                config={"display_name": display_name},
            )
            return job.name

        return await asyncio.to_thread(_do_submit)

    async def get_state(self, job_name: str) -> JobStateInfo:
        def _do_get():
            return self._client.batches.get(name=job_name)
        job = await asyncio.to_thread(_do_get)
        state = _GOOGLE_TO_STATE.get(job.state.name, JobState.RUNNING)
        result_file = None
        if state == JobState.SUCCEEDED:
            dest = getattr(job, "dest", None)
            if dest:
                result_file = getattr(dest, "file_name", None)
        error = None
        err_obj = getattr(job, "error", None)
        if err_obj:
            error = getattr(err_obj, "message", str(err_obj))
        return JobStateInfo(state=state, result_file=result_file, error=error)

    async def cancel(self, job_name: str) -> None:
        def _do_cancel():
            self._client.batches.cancel(name=job_name)
        await asyncio.to_thread(_do_cancel)

    async def download_results(
        self, *, result_file: str, model: str, media_dir: Path, prompts: dict[str, str]
    ) -> list[BatchResult]:
        """Download result JSONL, parse each line, write images. `prompts` maps key->prompt."""
        def _do_download() -> str:
            content = self._client.files.download(file=result_file)
            return content.decode("utf-8") if isinstance(content, bytes) else content
        raw = await asyncio.to_thread(_do_download)
        out: list[BatchResult] = []
        for line in raw.splitlines():
            if not line.strip():
                continue
            try:
                parsed = json.loads(line)
            except Exception as exc:
                _log(f"batch_gen: bad JSONL line: {exc}")
                continue
            key = parsed.get("key", "?")
            res = parse_result_line(
                line=parsed,
                model=model,
                media_dir=media_dir,
                prompt=prompts.get(key, ""),
            )
            out.append(res)
        return out
