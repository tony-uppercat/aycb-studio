"""Lightweight frame extraction from video files."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from rich.console import Console

from config.settings import settings

console = Console()


@dataclass
class Frame:
    """A single extracted frame."""

    image: np.ndarray
    index: int
    timestamp_sec: float
    sharpness: float


def _laplacian_sharpness(gray: np.ndarray) -> float:
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def _sample_video(
    video_path: Path,
    sample_fps: float,
) -> tuple[list[tuple[np.ndarray, float]], float]:
    """Sample frames from a video at the given FPS.

    Returns (list of (bgr_frame, timestamp_sec), video_fps).
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, int(video_fps / sample_fps))

    console.log(
        f"Video: {video_fps:.1f} fps, {total_frames} frames, "
        f"sampling every {step} frames"
    )

    samples: list[tuple[np.ndarray, float]] = []
    idx = 0
    while idx < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            break
        samples.append((frame, round(idx / video_fps, 3)))
        idx += step

    cap.release()
    return samples, video_fps


def _hsv_histogram(frame: np.ndarray) -> np.ndarray:
    """Compute L1-normalized HSV histogram for a BGR frame."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist, norm_type=cv2.NORM_L1)
    return hist


def extract_frames_cuts(
    video_path: str | Path,
    threshold: float = 0.4,
    sample_fps: float = 4.0,
) -> list[tuple[np.ndarray, float]]:
    """Extract one sharp frame per scene using cut detection.

    Uses Bhattacharyya distance on HSV histograms to detect scene changes,
    then picks the sharpest frame (Laplacian variance) within each scene.
    Returns list of (bgr_frame, timestamp_seconds) tuples.
    """
    video_path = Path(video_path)
    samples, _ = _sample_video(video_path, sample_fps)

    if not samples:
        return []

    # Compute histograms for all sampled frames
    hists = [_hsv_histogram(f) for f, _ in samples]

    # Find scene boundaries: indices where a new scene starts
    scene_starts = [0]
    for i in range(1, len(hists)):
        dist = cv2.compareHist(hists[i - 1], hists[i], cv2.HISTCMP_BHATTACHARYYA)
        if dist > threshold:
            scene_starts.append(i)

    console.log(
        f"Cut detection: {len(scene_starts)} scene(s) detected "
        f"from {len(samples)} sampled frames (threshold={threshold})"
    )

    # For each scene segment, pick the sharpest frame
    result: list[tuple[np.ndarray, float]] = []
    scene_starts.append(len(samples))  # sentinel end
    for seg in range(len(scene_starts) - 1):
        start = scene_starts[seg]
        end = scene_starts[seg + 1]
        segment = samples[start:end]

        best_frame, best_ts = max(
            segment,
            key=lambda ft: _laplacian_sharpness(cv2.cvtColor(ft[0], cv2.COLOR_BGR2GRAY)),
        )
        result.append((best_frame, best_ts))

    return result


def extract_keyframes(
    video_path: str | Path,
    max_frames: int | None = None,
    sample_fps: float | None = None,
    mode: str = "sharpness",
    cut_threshold: float = 0.4,
) -> list[Frame]:
    """Extract key-frames from a video.

    When ``mode='sharpness'`` (default), samples at ``sample_fps`` (or
    ``settings.sample_fps``), ranks by Laplacian sharpness, and returns
    the top ``max_frames`` (or ``settings.max_keyframes``) frames.

    When ``mode='cuts'``, delegates to ``extract_frames_cuts`` and wraps
    results as ``Frame`` objects. The number of frames equals the number
    of detected scene cuts (``max_frames`` is ignored in this mode).
    """
    _max = max_frames if max_frames is not None else settings.max_keyframes
    _fps = sample_fps if sample_fps is not None else settings.sample_fps
    video_path = Path(video_path)

    if mode == "cuts":
        cuts = extract_frames_cuts(video_path, threshold=cut_threshold, sample_fps=_fps)
        # No cap — return one frame per detected scene
        return [
            Frame(
                image=bgr,
                index=i,
                timestamp_sec=ts,
                sharpness=_laplacian_sharpness(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)),
            )
            for i, (bgr, ts) in enumerate(cuts)
        ]

    # mode == 'sharpness' — original logic
    samples, video_fps = _sample_video(video_path, _fps)

    candidates: list[Frame] = []
    for bgr, ts in samples:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        sharpness = _laplacian_sharpness(gray)
        idx = int(ts * video_fps)
        candidates.append(Frame(image=bgr, index=idx, timestamp_sec=ts, sharpness=sharpness))

    # Rank by sharpness, take top N
    candidates.sort(key=lambda f: f.sharpness, reverse=True)
    selected = candidates[:_max]
    # Re-sort by timestamp
    selected.sort(key=lambda f: f.index)

    console.log(
        f"Selected {len(selected)} key-frames from {len(candidates)} sampled "
        f"(best sharpness: {selected[0].sharpness:.1f})" if selected else
        "No frames could be read from video"
    )
    return selected


def extract_frames(video_path: Path) -> list[Frame]:
    """Extract key-frames from a video by sharpness ranking.

    Samples at ``settings.sample_fps``, ranks by Laplacian sharpness,
    and returns the top ``settings.max_keyframes`` frames.
    """
    return extract_keyframes(video_path)


def load_image(image_path: Path) -> Frame:
    """Load a single image file as a Frame."""
    img = cv2.imread(str(image_path))
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return Frame(
        image=img,
        index=0,
        timestamp_sec=0.0,
        sharpness=_laplacian_sharpness(gray),
    )
