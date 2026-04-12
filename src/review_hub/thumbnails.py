"""Generate 300px-wide JPEG thumbnails using Pillow."""
from pathlib import Path
from PIL import Image

from config.settings import settings

THUMB_DIR = settings.thumbnails_dir
THUMB_WIDTH = 300

def generate_thumbnail(source_path: Path, media_id: int) -> str:
    """Generate thumbnail, return path string."""
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    thumb_path = THUMB_DIR / f"{media_id}.jpg"
    with Image.open(source_path) as img:
        ratio = THUMB_WIDTH / img.width
        size = (THUMB_WIDTH, int(img.height * ratio))
        img.thumbnail(size, Image.LANCZOS)
        img.convert("RGB").save(thumb_path, "JPEG", quality=80)
    return str(thumb_path)

def generate_asset_thumbnail(source_path: Path, asset_id: int) -> str:
    """Generate thumbnail for an asset in thumbnails/assets/, return path string."""
    asset_thumb_dir = THUMB_DIR / "assets"
    asset_thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = asset_thumb_dir / f"{asset_id}.jpg"
    with Image.open(source_path) as img:
        ratio = THUMB_WIDTH / img.width
        size = (THUMB_WIDTH, int(img.height * ratio))
        img.thumbnail(size, Image.LANCZOS)
        img.convert("RGB").save(thumb_path, "JPEG", quality=80)
    return str(thumb_path)

def get_image_dimensions(path: Path) -> tuple[int, int]:
    """Return (width, height)."""
    with Image.open(path) as img:
        return img.size
