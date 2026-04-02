"""Centralized configuration for AYCB."""

import os
from pathlib import Path

from pydantic_settings import BaseSettings


def _env_with_fallback(new_name: str, old_name: str, default: str = "") -> str:
    """Read env var with fallback to old GEMINISHOT_* name for backwards compatibility (AYCB_ is the current prefix)."""
    return os.getenv(new_name) or os.getenv(old_name) or default


class Settings(BaseSettings):
    """All configurable parameters."""

    # ── Paths ────────────────────────────────────────────────────────
    project_root: Path = Path(__file__).resolve().parent.parent
    output_dir: Path = project_root / "output"
    prompts_dir: Path = project_root / "config" / "prompts"
    shared_media_path: Path = project_root.parent / "shared" / "Media"

    # ── Gemini ────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_flash_model: str = "gemini-3.1-flash-lite-preview"
    gemini_embedding_model: str = "gemini-embedding-exp-03-07"

    # ── Frame extraction ──────────────────────────────────────────────
    max_keyframes: int = 3
    sample_fps: float = 4.0
    sharpness_threshold: float = 50.0

    # ── Embeddings ────────────────────────────────────────────────────
    enable_embeddings: bool = False

    # ── Gemini API retries ────────────────────────────────────────────
    # Used to handle HTTP 429 RESOURCE_EXHAUSTED responses with provider-provided retryDelay.
    api_max_retries: int = 5
    api_retry_max_delay_seconds: float = 180.0

    model_config = {
        "env_file": ".env",
        "env_prefix": "AYCB_",
        "extra": "ignore",
    }

    def model_post_init(self, __context) -> None:
        """Fallback to old GEMINISHOT_* env vars for backwards compatibility (current prefix is AYCB_)."""
        if not self.gemini_api_key:
            self.gemini_api_key = os.getenv("GEMINISHOT_GEMINI_API_KEY") or ""
        if self.gemini_flash_model == "gemini-3-flash-preview":
            self.gemini_flash_model = os.getenv("GEMINISHOT_GEMINI_FLASH_MODEL") or "gemini-3-flash-preview"
        if self.gemini_embedding_model == "gemini-embedding-exp-03-07":
            self.gemini_embedding_model = os.getenv("GEMINISHOT_GEMINI_EMBEDDING_MODEL") or "gemini-embedding-exp-03-07"
        if not self.shared_media_path.exists():
            old_path = os.getenv("GEMINISHOT_SHARED_MEDIA_PATH")
            if old_path:
                self.shared_media_path = Path(old_path)


settings = Settings()


def save_api_key_to_env(key: str) -> None:
    """Persist the API key to the .env file so it survives restarts."""
    settings.gemini_api_key = key
    env_path = settings.project_root / ".env"
    env_var = "AYCB_GEMINI_API_KEY"

    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()
        found = False
        for i, line in enumerate(lines):
            if line.startswith(f"{env_var}=") or line.startswith("GEMINISHOT_GEMINI_API_KEY="):
                lines[i] = f"{env_var}={key}"
                found = True
                break
        if not found:
            lines.append(f"{env_var}={key}")
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    else:
        env_path.write_text(f"{env_var}={key}\n", encoding="utf-8")
