"""AYCB API — App factory.

All endpoint logic lives in src/routers/*.py.
Shared helpers live in src/shared.py.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config.settings import settings
from src.shared import _log

import importlib
import pkgutil


# ── Quiet routes — polled per-media, spam both our middleware and uvicorn ──
# These endpoints are hit once per gallery item on every gallery load and
# once per history entry on every generate-node render. A 50-item gallery
# produces 50 log lines; suppressing them keeps the console readable while
# leaving genuine errors (4xx/5xx) visible via the uvicorn error logger.
_QUIET_PATHS = (
    "/api/logs",
    "/api/health",
    "/api/bridge/review/",
    "/api/bridge/meta/",
    "/api/rh/media/",
)


class _AccessLogFilter(logging.Filter):
    """Drop uvicorn access-log records for quiet paths."""
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(p in msg for p in _QUIET_PATHS)


logging.getLogger("uvicorn.access").addFilter(_AccessLogFilter())


# ── Lifespan ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    _log("AYCB backend ready")
    if not settings.media_dir.exists():
        try:
            settings.media_dir.mkdir(parents=True, exist_ok=True)
            _log(f"Created shared media dir: {settings.media_dir}")
        except Exception as e:
            _log(f"WARNING: shared media dir not available: {e}")
    from src.review_hub.app import rh_startup
    await rh_startup()

    # ── Batch generation poller ──
    app.state.batch_poller = None
    try:
        from src.plugins.batch_gen import _get_provider, get_store
        from src.batch_gen.poller import BatchPoller
        provider = _get_provider()
        poller = BatchPoller(
            store=get_store(),
            provider=provider,
            media_dir=settings.media_dir,
        )
        poller.start()
        app.state.batch_poller = poller
    except Exception as e:
        _log(f"batch_gen: poller NOT started ({e})")

    yield

    # ── Shutdown ──
    poller = getattr(app.state, "batch_poller", None)
    if poller is not None:
        await poller.stop()


# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="AYCB API", version="2.0.0", lifespan=lifespan)

# ── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request logging middleware ──────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request, call_next):
    t0 = time.time()
    response = await call_next(request)
    dt = time.time() - t0
    # 5xx responses are always worth logging even for quiet paths.
    if response.status_code >= 500 or not any(
        request.url.path.startswith(p) for p in _QUIET_PATHS
    ):
        _log(f"{request.method} {request.url.path} -> {response.status_code} ({dt:.1f}s)")
    return response

# ── Auto-discover routers ──────────────────────────────────────────────────
def _discover_routers(package_path: str, package_name: str) -> list[str]:
    loaded: list[str] = []
    pkg_dir = Path(__file__).resolve().parent / package_path
    if not pkg_dir.exists():
        return loaded
    for _, name, _ in pkgutil.iter_modules([str(pkg_dir)]):
        if name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"{package_name}.{name}")
            if hasattr(mod, "router"):
                app.include_router(mod.router)
                loaded.append(name)
        except Exception as e:
            _log(f"Router {name} failed to load: {e}")
    return loaded

_loaded = _discover_routers("routers", "src.routers")
_loaded += _discover_routers("plugins", "src.plugins")
if _loaded:
    _log(f"{len(_loaded)} routers loaded")

# ── Review Hub ─────────────────────────────────────────────────────────
from src.review_hub.app import mount_review_hub
mount_review_hub(app)

# ── Static files (production) ──────────────────────────────────────────────
_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

def mount_static() -> None:
    if os.getenv("AYCB_SERVE_STATIC", "").lower() in ("1", "true", "yes") and _FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="static")
