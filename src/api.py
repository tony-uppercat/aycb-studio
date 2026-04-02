"""AYCB API — App factory.

All endpoint logic lives in src/routers/*.py.
Shared helpers live in src/shared.py.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config.settings import settings
from src.shared import _log

import importlib
import pkgutil

# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="AYCB API", version="2.0.0")

# ── CORS ────────────────────────────────────────────────────────────────────
_CORS_ORIGINS = os.environ.get("AYCB_CORS_ORIGINS", "").split(",") if os.environ.get("AYCB_CORS_ORIGINS") else [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def _on_startup():
    _log("AYCB backend ready")
    if not settings.shared_media_path.exists():
        try:
            settings.shared_media_path.mkdir(parents=True, exist_ok=True)
            _log(f"Created shared media dir: {settings.shared_media_path}")
        except Exception as e:
            _log(f"WARNING: shared media dir not available: {e}")

# ── Request logging middleware ──────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request, call_next):
    t0 = time.time()
    response = await call_next(request)
    dt = time.time() - t0
    skip = ("/api/logs", "/api/health")
    if not any(request.url.path.startswith(p) for p in skip):
        _log(f"{request.method} {request.url.path} -> {response.status_code} ({dt:.1f}s)")
    return response

# ── Auto-discover routers ──────────────────────────────────────────────────
def _discover_routers(package_path: str, package_name: str) -> None:
    pkg_dir = Path(__file__).resolve().parent / package_path
    if not pkg_dir.exists():
        return
    for _, name, _ in pkgutil.iter_modules([str(pkg_dir)]):
        if name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"{package_name}.{name}")
            if hasattr(mod, "router"):
                app.include_router(mod.router)
                _log(f"Router loaded: {name}")
        except Exception as e:
            _log(f"Router {name} failed to load: {e}")

_discover_routers("routers", "src.routers")
_discover_routers("plugins", "src.plugins")

# ── Static files (production) ──────────────────────────────────────────────
_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

def mount_static() -> None:
    if os.getenv("AYCB_SERVE_STATIC", "").lower() in ("1", "true", "yes") and _FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="static")
