"""Settings API — read/update persistent paths."""

from pathlib import Path

from dotenv import set_key
from fastapi import APIRouter

from config.settings import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

ENV_PATH = str(settings.project_root / ".env")


@router.get("/paths")
async def get_paths():
    resolved = settings.shared_root.resolve()
    return {
        "shared_root": str(resolved),
        "exists": resolved.exists(),
        "media_dir": str(settings.media_dir),
        "references_dir": str(settings.references_dir),
    }


@router.put("/paths")
async def set_paths(body: dict):
    new_path = body.get("shared_root", "").strip()
    if not new_path:
        return {"error": "shared_root is required"}
    p = Path(new_path).resolve()
    settings.shared_root = p
    set_key(ENV_PATH, "AYCB_SHARED_ROOT", str(p))
    return {"shared_root": str(p), "exists": p.exists()}


@router.post("/open-folder")
async def open_folder():
    """Open shared root in system file explorer."""
    import subprocess
    import platform
    target = settings.shared_root.resolve()
    if not target.exists():
        return {"error": "Directory does not exist"}
    if platform.system() == "Windows":
        subprocess.Popen(["explorer", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])
    return {"ok": True}
