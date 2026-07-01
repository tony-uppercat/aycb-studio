"""Low-level HTTP / parse / save helpers for Gemini Omni Flash video.

Split out of ``gemini_omni_gen.py`` to keep each file under the 300-line
cap. This module owns the raw ``httpx`` REST call to the Gemini-native
``interactions`` endpoint, the defensive response parsing, and the mp4
save. The orchestration (submit->poll, job table, validation) stays in
``gemini_omni_gen.py``.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)

_API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

# interactions.create blocks until the render finishes; give it room.
_HTTP_TIMEOUT = 300.0

# File-delivery (uri) polling — used only when a clip is >4MB and the API
# returns a file uri instead of inline base64.
_FILE_STATE_INTERVAL = 3.0
_FILE_STATE_TIMEOUT = 180.0


class GeminiOmniGenError(Exception):
    """Raised on Gemini Omni Flash video generation errors."""


async def _post_interaction(api_key: str, body: dict[str, Any]) -> dict[str, Any]:
    """Blocking POST to interactions — returns once the clip has rendered."""
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(_API_URL, headers=headers, json=body)
    if resp.status_code >= 400:
        raise GeminiOmniGenError(
            f"Omni interactions HTTP {resp.status_code}: {resp.text[:500]}"
        )
    try:
        return resp.json()
    except Exception as exc:
        raise GeminiOmniGenError(f"Omni interactions returned non-JSON: {exc}") from exc


def _extract_video(data: dict[str, Any]) -> tuple[bytes | None, str | None]:
    """Defensively locate the clip. Returns ``(inline_bytes, file_uri)``.

    Order per the API contract: output_video.data (inline b64) ->
    steps[].content[].data (inline b64) -> steps[].content[].uri (file uri).
    """
    ov = data.get("output_video")
    if isinstance(ov, dict) and ov.get("data"):
        return base64.b64decode(ov["data"]), None
    for step in data.get("steps") or []:
        for content in step.get("content") or []:
            if not isinstance(content, dict):
                continue
            if content.get("data"):
                return base64.b64decode(content["data"]), None
            if content.get("uri"):
                return None, content["uri"]
    return None, None


async def _fetch_file_uri(api_key: str, uri: str) -> bytes:
    """Poll a delivered file uri until ACTIVE, then download the bytes.

    ponytail: the download-url construction (alt=media on the resource) is a
    best guess for this preview endpoint, unverified against a live clip.
    """
    headers = {"x-goog-api-key": api_key}
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        start = time.monotonic()
        meta: dict[str, Any] = {}
        while True:
            meta_resp = await client.get(uri, headers=headers)
            if meta_resp.status_code >= 400:
                raise GeminiOmniGenError(
                    f"Omni file poll HTTP {meta_resp.status_code}: {meta_resp.text[:300]}"
                )
            meta = meta_resp.json()
            state = meta.get("state") or meta.get("status")
            if state == "ACTIVE":
                break
            if state in ("FAILED", "ERROR"):
                raise GeminiOmniGenError(f"Omni file processing failed: {meta}")
            if time.monotonic() - start > _FILE_STATE_TIMEOUT:
                raise GeminiOmniGenError(
                    f"Omni file not ACTIVE after {_FILE_STATE_TIMEOUT}s (state={state})"
                )
            await asyncio.sleep(_FILE_STATE_INTERVAL)
        download_uri = (
            meta.get("download_uri") or meta.get("downloadUri")
            or meta.get("uri") or uri
        )
        dl = await client.get(download_uri, headers=headers, params={"alt": "media"})
    if dl.status_code >= 400:
        raise GeminiOmniGenError(
            f"Omni file download HTTP {dl.status_code}: {dl.text[:300]}"
        )
    return dl.content


def _save_video(video_bytes: bytes, request_id: str) -> str:
    """Write the mp4 to shared/Media and return its /media/ URL."""
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    filename = f"omni_{request_id}.mp4"
    out_path = settings.media_dir / filename
    out_path.write_bytes(video_bytes)
    logger.info("Omni video saved -> %s", out_path)
    return f"/media/{filename}"
