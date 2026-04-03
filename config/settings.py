"""Centralized configuration for AYCB."""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """All configurable parameters."""

    # ── Paths ────────────────────────────────────────────────────────
    project_root: Path = Path(__file__).resolve().parent.parent
    output_dir: Path = project_root / "output"
    prompts_dir: Path = project_root / "config" / "prompts"
    shared_root: Path = project_root.parent / "shared"

    @property
    def media_dir(self) -> Path:
        return self.shared_root / "Media"

    @property
    def references_dir(self) -> Path:
        return self.shared_root / "References"

    @property
    def thumbnails_dir(self) -> Path:
        return self.shared_root / "data" / "thumbnails"

    @property
    def db_path(self) -> Path:
        return self.shared_root / "data" / "review-hub.db"

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
        """Ensure derived directories exist."""
        self.shared_root.mkdir(parents=True, exist_ok=True)


settings = Settings()


def save_api_key_to_env(key: str) -> None:
    """Persist the API key to the .env file so it survives restarts."""
    from dotenv import set_key

    settings.gemini_api_key = key
    env_path = str(settings.project_root / ".env")
    set_key(env_path, "AYCB_GEMINI_API_KEY", key)
