"""Image edit router — Vertex AI Imagen edit_image() endpoint."""
from __future__ import annotations

import asyncio
import base64
import io
import time
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image as PILImage

from src.shared import (
    _log,
    _require_prompt,
    _validate_image_upload,
    _read_upload,
    MAX_IMAGE_BYTES,
)
from src.vertex_client import (
    get_vertex_client as _get_vertex_client,
    reset_vertex_client as _reset_vertex_client,
)

router = APIRouter(prefix="/api/edit", tags=["edit"])


# ── Edit mode configuration ──────────────────────────────────────────────────

_NEEDS_MASK = {
    "EDIT_MODE_INPAINT_REMOVAL",
    "EDIT_MODE_INPAINT_INSERTION",
    "EDIT_MODE_OUTPAINT",
}

_EDIT_MODEL = "imagen-3.0-capability-001"

EDIT_MODELS = [
    {"id": "gemini-3.1-flash-image-preview", "name": "Nano Banana 2 (Gemini)", "provider": "gemini"},
    {"id": "imagen-3.0-capability-001", "name": "Imagen 3 (Vertex AI)", "provider": "imagen"},
]


# ── Gemini edit (generateContent with image input) ─────────────────────────

def _edit_gemini_sync(
    prompt: str,
    base_pil: PILImage.Image,
    api_key: str,
    subject_pils: list[PILImage.Image] | None = None,
) -> list[PILImage.Image]:
    """Edit via Gemini generateContent — prompt-based, no mask."""
    from src.gemini import _get_client, _call_with_gemini_retries
    from google.genai import types

    client = _get_client(api_key)
    contents: list = [base_pil]
    if subject_pils:
        contents.extend(subject_pils[:4])
    contents.append(prompt)

    response, _usage = _call_with_gemini_retries(
        lambda: client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        ),
        operation="edit_image_gemini",
    )

    results: list[PILImage.Image] = []
    if response.candidates:
        parts = getattr(response.candidates[0].content, 'parts', None) or []
        for part in parts:
            if part.inline_data is not None:
                results.append(PILImage.open(io.BytesIO(part.inline_data.data)))
    return results


# ── Imagen edit (Vertex AI edit_image) ─────────────────────────────────────

def _edit_image_sync(
    prompt: str,
    base_pil: PILImage.Image,
    edit_mode: str,
    mask_mode: str,
    mask_dilation: float,
    number_of_images: int,
    aspect_ratio: str = "",
    subject_pils: list[PILImage.Image] | None = None,
) -> list[PILImage.Image]:
    """Call Vertex AI edit_image() synchronously. Returns list of PIL images."""
    from google.genai import types

    client = _get_vertex_client()

    # Convert base image to PNG bytes for API
    buf = io.BytesIO()
    base_pil.save(buf, format="PNG")
    base_bytes = buf.getvalue()

    base_image = types.Image(image_bytes=base_bytes, mime_type="image/png")

    reference_images: list = [
        types.RawReferenceImage(reference_id=0, reference_image=base_image)
    ]

    # Add mask reference if this edit mode requires one
    if edit_mode in _NEEDS_MASK:
        reference_images.append(
            types.MaskReferenceImage(
                reference_id=1,
                config=types.MaskReferenceConfig(
                    mask_mode=mask_mode,
                    mask_dilation=mask_dilation,
                ),
            )
        )

    # Add subject reference images if provided
    if subject_pils:
        for i, subject_pil in enumerate(subject_pils):
            s_buf = io.BytesIO()
            subject_pil.save(s_buf, format="PNG")
            s_bytes = s_buf.getvalue()
            s_image = types.Image(image_bytes=s_bytes, mime_type="image/png")
            reference_images.append(
                types.SubjectReferenceImage(
                    reference_id=10 + i,
                    reference_image=s_image,
                    config=types.SubjectReferenceConfig(
                        subject_type="SUBJECT_TYPE_DEFAULT"
                    ),
                )
            )

    edit_kwargs: dict = {
        "edit_mode": edit_mode,
        "number_of_images": number_of_images,
    }
    if aspect_ratio:
        edit_kwargs["aspect_ratio"] = aspect_ratio
    edit_config = types.EditImageConfig(**edit_kwargs)

    _log(f"Vertex AI edit_image — model={_EDIT_MODEL}, mode={edit_mode}, n={number_of_images}")
    response = client.models.edit_image(
        model=_EDIT_MODEL,
        prompt=prompt,
        reference_images=reference_images,
        config=edit_config,
    )

    results: list[PILImage.Image] = []
    for generated in response.generated_images:
        img_bytes = generated.image.image_bytes
        pil = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
        results.append(pil)

    return results


# ── Base64 helper ────────────────────────────────────────────────────────────

def _pil_to_b64(pil: PILImage.Image) -> str:
    """Convert PIL image to base64-encoded PNG string."""
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/image")
async def edit_image_endpoint(
    prompt: str = Form(...),
    model: str = Form("gemini-3.1-flash-image-preview"),
    api_key: str = Form(""),
    edit_mode: str = Form("EDIT_MODE_DEFAULT"),
    mask_mode: str = Form("MASK_MODE_FOREGROUND"),
    mask_dilation: float = Form(0.03),
    number_of_images: int = Form(1),
    aspect_ratio: str = Form(""),
    image: UploadFile = File(...),
    subject_images: Optional[list[UploadFile]] = File(default=None),
):
    """Edit an image using Gemini (prompt-based) or Vertex AI Imagen (mask-based).

    Gemini: prompt-based editing, no mask needed, uses API key.
    Imagen: mask-based editing (inpaint, outpaint, bgswap), requires GCP project.
    """
    clean_prompt = _require_prompt(prompt)

    # Validate and read base image
    _validate_image_upload(image)
    raw_base = await _read_upload(image, MAX_IMAGE_BYTES, "Base image")
    try:
        base_pil = PILImage.open(io.BytesIO(raw_base)).convert("RGB")
    except Exception as exc:
        _log(f"Image edit — base image decode failed: {exc}")
        raise HTTPException(400, detail=f"Could not decode base image: {exc}")

    # Validate and read subject images if provided
    subject_pils: list[PILImage.Image] = []
    if subject_images:
        for sf in subject_images[:4]:
            _validate_image_upload(sf)
            raw_s = await _read_upload(sf, MAX_IMAGE_BYTES, "Subject image")
            try:
                subject_pils.append(PILImage.open(io.BytesIO(raw_s)).convert("RGB"))
            except Exception as exc:
                _log(f"Image edit — subject image decode failed: {exc}")
                raise HTTPException(400, detail=f"Could not decode subject image: {exc}")

    # Validate number_of_images range
    if not (1 <= number_of_images <= 4):
        raise HTTPException(400, detail="number_of_images must be between 1 and 4")

    _log(
        f"Image edit — mode={edit_mode}, mask_mode={mask_mode}, "
        f"n={number_of_images}, subjects={len(subject_pils)}, "
        f"prompt={clean_prompt[:80]}..."
    )

    is_gemini = model.startswith("gemini-")
    t0 = time.time()
    try:
        if is_gemini:
            from src.shared import _require_key
            effective_key = _require_key(api_key, "gemini")
            result_pils = await asyncio.to_thread(
                _edit_gemini_sync, clean_prompt, base_pil, effective_key,
                subject_pils if subject_pils else None,
            )
        else:
            result_pils = await asyncio.to_thread(
                _edit_image_sync, clean_prompt, base_pil, edit_mode, mask_mode,
                mask_dilation, number_of_images, aspect_ratio,
                subject_pils if subject_pils else None,
            )
    except ValueError as exc:
        _log(f"Image edit config error — {exc}")
        raise HTTPException(400, detail=str(exc))
    except Exception as exc:
        dt = time.time() - t0
        _log(f"Image edit FAILED — {exc} ({dt:.1f}s)")
        raise HTTPException(500, detail=f"Image edit failed: {exc}")

    dt = time.time() - t0
    count = len(result_pils)
    _log(f"Image edit complete — {count} image(s) returned ({dt:.1f}s)")

    images_b64 = [_pil_to_b64(pil) for pil in result_pils]
    per_image = 0.067 if is_gemini else 0.02
    cost_usd = round(per_image * count, 4)

    return {
        "images_b64": images_b64,
        "status": "OK",
        "usage": {"cost_usd": cost_usd},
    }
