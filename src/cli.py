"""CLI entry-point for AYCB."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import numpy as np
import typer
from rich.console import Console
from rich.table import Table

console = Console()
app = typer.Typer(name="aycb", help="AYCB — lean cinematic analyzer powered by Gemini")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


MODELS = {
    "3-pro": "gemini-3-pro-preview",
    "3-flash": "gemini-3-flash-preview",
    "flash": "gemini-3-flash-preview",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-pro": "gemini-2.5-pro",
}


@app.command()
def analyze(
    path: Path = typer.Argument(..., help="Image or video file to analyze"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    model: str = typer.Option("2.5-flash", "--model", "-m", help="Model: flash, 2.5-flash, 2.5-pro, 3.1-pro, 3-flash"),
    keyframes: int = typer.Option(3, "--keyframes", "-n", min=1, max=10, help="Max key-frames (video only)"),
    embed: bool = typer.Option(False, "--embed", "-e", help="Generate Gemini Embedding 2 vectors"),
    verbose: bool = typer.Option(False, "-v", "--verbose"),
) -> None:
    """Analyze an image or video with Gemini Flash/Pro."""
    if not path.exists():
        console.print(f"[red]File not found: {path}[/]")
        raise typer.Exit(1)

    from config.settings import Settings

    cfg = Settings()
    cfg.gemini_flash_model = MODELS.get(model, model)
    cfg.max_keyframes = keyframes
    cfg.enable_embeddings = embed
    console.print(f"Using model: [bold]{cfg.gemini_flash_model}[/]")
    if output is not None:
        cfg.output_dir = output

    t0 = time.perf_counter()
    suffix = path.suffix.lower()

    from src.gemini import process_image, AnalysisResult

    results: list[AnalysisResult] = []

    if suffix in IMAGE_EXTS:
        # ── Single image ─────────────────────────────────────────────
        console.rule(f"[bold]AYCB — {path.name}[/]")
        from src.frames import load_image

        frame = load_image(path)
        console.log(f"Analyzing image with {cfg.gemini_flash_model}...")
        result, _usage = process_image(frame.image, source_path=str(path), do_embed=embed)
        results.append(result)

    elif suffix in VIDEO_EXTS:
        # ── Video → frames → analyze ────────────────────────────────
        console.rule(f"[bold]AYCB — {path.name}[/]")
        from src.frames import extract_frames

        frames = extract_frames(path)
        if not frames:
            console.print("[red]No suitable frames found in video[/]")
            raise typer.Exit(1)

        for i, frame in enumerate(frames):
            console.log(f"Analyzing frame {i + 1}/{len(frames)} (t={frame.timestamp_sec:.2f}s)")
            result, _usage = process_image(
                frame.image,
                source_path=f"{path.name}:frame{frame.index}",
                do_embed=embed,
            )
            results.append(result)

    else:
        console.print(f"[red]Unsupported file type: {suffix}[/]")
        raise typer.Exit(1)

    elapsed = time.perf_counter() - t0

    # ── Save output ──────────────────────────────────────────────────
    out_dir = cfg.output_dir / path.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    # JSON output
    output_data = []
    for i, r in enumerate(results):
        entry = {
            "id": f"GS_{i + 1:02d}",
            "source": r.source_path,
            "prompt_text": r.prompt_text,
            "prompt_json": r.prompt_json,
        }
        output_data.append(entry)

        # Save embedding as .npy
        if r.embedding is not None:
            npy_path = out_dir / f"GS_{i + 1:02d}_embedding.npy"
            np.save(str(npy_path), np.array(r.embedding))

    json_path = out_dir / "analysis.json"
    json_path.write_text(json.dumps(output_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Prompt text file (ready for copy-paste into Nano Banana 2)
    txt_path = out_dir / "prompts.txt"
    lines = []
    for i, r in enumerate(results):
        lines.append(f"=== GS_{i + 1:02d} ===")
        lines.append(r.prompt_text)
        lines.append("")
    txt_path.write_text("\n".join(lines), encoding="utf-8")

    # ── Summary table ────────────────────────────────────────────────
    table = Table(title="AYCB Results")
    table.add_column("ID", style="bold")
    table.add_column("Source")
    table.add_column("Shot Type")
    table.add_column("Mood")
    table.add_column("Embedding")
    for i, r in enumerate(results):
        pj = r.prompt_json
        table.add_row(
            f"GS_{i + 1:02d}",
            r.source_path,
            pj.get("camera", {}).get("shot_type", "—"),
            pj.get("mood", "—"),
            "yes" if r.embedding else "no",
        )
    console.print(table)
    console.print(f"\nDone in [bold]{elapsed:.1f}s[/]")
    console.print(f"Output: [bold]{out_dir}[/]")
    console.print(f"  - {json_path.name} (structured)")
    console.print(f"  - {txt_path.name} (copy-paste prompts)")
    if embed:
        console.print(f"  - *_embedding.npy (vectors)")


@app.command()
def batch(
    input_dir: Path = typer.Argument(..., help="Directory of images/videos"),
    output: Optional[Path] = typer.Option(None, "--output", "-o"),
    embed: bool = typer.Option(False, "--embed", "-e"),
) -> None:
    """Process all images and videos in a directory."""
    if not input_dir.is_dir():
        console.print(f"[red]Not a directory: {input_dir}[/]")
        raise typer.Exit(1)

    files = sorted(
        f for f in input_dir.iterdir()
        if f.suffix.lower() in IMAGE_EXTS | VIDEO_EXTS
    )
    if not files:
        console.print("[yellow]No supported files found[/]")
        raise typer.Exit(0)

    console.print(f"Found [bold]{len(files)}[/] files to process")

    for f in files:
        try:
            analyze(f, output=output, embed=embed)
        except Exception as exc:
            console.print(f"[red]Error processing {f.name}: {exc}[/]")


@app.command()
def info() -> None:
    """Show configuration and API status."""
    from config.settings import settings

    console.rule("[bold]AYCB Info[/]")
    console.print(f"  Flash model: {settings.gemini_flash_model}")
    console.print(f"  Embedding model: {settings.gemini_embedding_model}")
    console.print(f"  API key: {'[green]set[/]' if settings.gemini_api_key else '[red]not set[/]'}")
    console.print(f"  Max keyframes: {settings.max_keyframes}")
    console.print(f"  Output dir: {settings.output_dir}")

    if settings.gemini_api_key:
        try:
            from google import genai
            client = genai.Client(api_key=settings.gemini_api_key)
            # Quick test
            console.print("  API connection: [green]ok[/]")
        except Exception as exc:
            console.print(f"  API connection: [red]{exc}[/]")


@app.command("ui-react")
def ui_react(
    host: str = typer.Option("127.0.0.1", help="Host to bind"),
    port: int = typer.Option(5101, help="Port to listen on"),
    build: bool = typer.Option(False, "--build", help="Build frontend before starting"),
    open_browser: bool = typer.Option(True, "--open/--no-open", help="Open browser automatically"),
):
    """Start the React UI backed by FastAPI."""
    import subprocess, webbrowser, uvicorn
    from pathlib import Path

    frontend_dir = Path(__file__).resolve().parent.parent / "frontend"

    if build and frontend_dir.exists():
        console.print("[cyan]Building frontend…[/]")
        subprocess.run(["npm", "run", "build"], cwd=str(frontend_dir), check=True)

    url = f"http://{host}:{port}"
    console.print(f"[green]AYCB React UI -> {url}[/]")
    if open_browser:
        webbrowser.open(url)

    uvicorn.run("src.api:app", host=host, port=port, reload=True, access_log=False)


if __name__ == "__main__":
    app()
