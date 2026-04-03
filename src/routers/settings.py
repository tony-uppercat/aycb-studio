"""Settings API — read/update persistent paths."""

from pathlib import Path

from fastapi import APIRouter

from config.settings import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

ENV_PATH = settings.project_root / ".env"


def _read_env() -> dict[str, str]:
    """Parse .env into a dict."""
    out: dict[str, str] = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _write_env(data: dict[str, str]) -> None:
    """Write dict back to .env, preserving unknown keys."""
    lines: list[str] = []
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                k = stripped.split("=", 1)[0].strip()
                if k in data:
                    lines.append(f"{k}={data.pop(k)}")
                    continue
            lines.append(line)
    for k, v in data.items():
        lines.append(f"{k}={v}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


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
    env = _read_env()
    env["AYCB_SHARED_ROOT"] = str(p)
    _write_env(env)
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
