"""Video router — trim, extract frames, duration."""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.shared import (
    _log, _read_upload, _validate_video_upload,
    _safe_video_suffix, _sanitize_filename,
    MAX_VIDEO_BYTES,
)

router = APIRouter(prefix="/api/video", tags=["video"])


@router.post("/trim")
async def trim_video_endpoint(
    video: UploadFile = File(...),
    start: float = Form(0),
    end: float = Form(0),
    return_base64: bool = Form(False),
):
    """Trim a video using FFmpeg CLI (must be installed on system).

    Args:
        video: Video file to trim (mp4, mov, webm, avi, mkv).
        start: Start time in seconds.
        end: End time in seconds (must be > start).
        return_base64: If True, return JSON with base64-encoded video and
            duration. If False (default), return raw video bytes as file.
    """
    import subprocess
    import shutil
    import base64 as _base64

    _log(f"Video trim — {start}s to {end}s (base64={return_base64})")

    if end <= start:
        raise HTTPException(400, detail="end must be greater than start")

    _validate_video_upload(video)
    suffix = _safe_video_suffix(video.filename)

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
        shutil.copyfileobj(video.file, tmp_in)
        input_path = tmp_in.name

    output_path = input_path + "_trimmed" + suffix

    try:
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", input_path,
            "-t", str(end - start),
            "-c", "copy",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=120)

        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace")[-500:]
            raise HTTPException(500, detail=f"FFmpeg failed: {stderr}")

        with open(output_path, "rb") as f:
            data = f.read()

        if return_base64:
            content_type = video.content_type or "video/mp4"
            b64 = _base64.b64encode(data).decode()
            return {
                "data_url": f"data:{content_type};base64,{b64}",
                "content_type": content_type,
                "duration": round(end - start, 3),
                "filename": f"trimmed_{_sanitize_filename(video.filename)}",
            }

        from fastapi.responses import Response as FastAPIResponse

        content_type = video.content_type or "video/mp4"
        safe_name = _sanitize_filename(video.filename)
        return FastAPIResponse(
            content=data,
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="trimmed_{safe_name}"'},
        )
    finally:
        Path(input_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)


@router.post("/extract-frames")
async def extract_frames_endpoint(
    video: UploadFile = File(...),
    count: int = Form(5),
):
    """Extract evenly-spaced frames from a video as base64 JPEGs."""
    import subprocess
    import shutil
    import base64 as _base64

    _log(f"Frame extraction — {count} frames")

    _validate_video_upload(video)
    suffix = _safe_video_suffix(video.filename)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
        shutil.copyfileobj(video.file, tmp_in)
        input_path = tmp_in.name

    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if probe.returncode != 0:
            raise HTTPException(400, detail=f"ffprobe failed: {probe.stderr.decode().strip()}")
        duration = float(probe.stdout.decode().strip())

        frame_paths = [f"{input_path}_frame_{i}.jpg" for i in range(count)]
        frames = []
        try:
            for i in range(count):
                timestamp = duration / 2 if count == 1 else (duration * i) / (count - 1)

                frame_path = frame_paths[i]
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(timestamp),
                    "-i", input_path,
                    "-frames:v", "1",
                    "-q:v", "2",
                    frame_path,
                ]
                subprocess.run(cmd, capture_output=True, timeout=30)

                if Path(frame_path).exists():
                    with open(frame_path, "rb") as f:
                        b64 = _base64.b64encode(f.read()).decode()
                    frames.append(
                        {
                            "index": i,
                            "timestamp": round(timestamp, 2),
                            "data_url": f"data:image/jpeg;base64,{b64}",
                        }
                    )
        finally:
            for fp in frame_paths:
                Path(fp).unlink(missing_ok=True)

        return {"frames": frames, "duration": duration}
    finally:
        Path(input_path).unlink(missing_ok=True)


@router.post("/duration")
async def video_duration_endpoint(
    video: UploadFile = File(...),
):
    """Get video duration in seconds."""
    import subprocess
    import shutil

    _validate_video_upload(video)
    suffix = _safe_video_suffix(video.filename)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
        shutil.copyfileobj(video.file, tmp_in)
        input_path = tmp_in.name

    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if probe.returncode != 0:
            raise HTTPException(400, detail=f"ffprobe failed: {probe.stderr.decode().strip()}")
        duration = float(probe.stdout.decode().strip())
        return {"duration": duration}
    finally:
        Path(input_path).unlink(missing_ok=True)
