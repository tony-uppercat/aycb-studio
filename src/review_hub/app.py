"""Review Hub — Socket.io server + FastAPI mount."""
from __future__ import annotations

import asyncio
import importlib
import pkgutil
import socketio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from src.review_hub.db import init_db
from src.review_hub.scanner import run_scanner, set_sio
from src.review_hub import routes as _rh_routes

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

@sio.event
async def connect(sid, environ):
    pass

@sio.event
async def disconnect(sid):
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import end_session
    db = await get_db()
    try:
        await end_session(db, sid)
        await db.commit()
    finally:
        await db.close()
    await sio.emit("users_update", await _get_users(), room="review")

@sio.event
async def join_room(sid, data):
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import add_session
    room = data.get("room", "review")
    await sio.enter_room(sid, room)
    db = await get_db()
    try:
        await add_session(db, data.get("user", "Anonymous"), data.get("device", "unknown"), sid)
        await db.commit()
    finally:
        await db.close()
    await sio.emit("users_update", await _get_users(), room=room)

@sio.event
async def leave_room(sid, data):
    room = data.get("room", "review")
    await sio.leave_room(sid, room)

# Fan-out relays — each one just re-emits the same event name to all
# other clients in the review room. Registering them in a loop keeps the
# list in one place so adding a new event is a single-line edit.
_RELAY_EVENTS = (
    "drawing_stroke", "drawing_clear", "drawing_undo",
    "cursor_move",
    "comment_new", "comment_delete",
    "favorite_toggle",
    "asset_link_new", "asset_link_delete",
)


def _make_relay(event_name: str):
    async def _relay(sid, data):
        await sio.emit(event_name, data, room="review", skip_sid=sid)
    return _relay


for _ev in _RELAY_EVENTS:
    sio.on(_ev, _make_relay(_ev))

# ping_check is not a relay — it replies directly to the sender.
@sio.event
async def ping_check(sid, data):
    await sio.emit('pong_check', data, to=sid)

async def _get_users():
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import get_active_sessions
    db = await get_db()
    try:
        sessions = await get_active_sessions(db)
        return [{"id": s["socket_id"], "user": s["user_name"], "device": s["device"]} for s in sessions]
    finally:
        await db.close()

async def rh_startup() -> None:
    """Initialize Review Hub DB, clear stale sessions, start scanner."""
    await init_db()
    from src.review_hub.db import get_db
    from src.review_hub.queries.sessions import clear_stale_sessions
    from src.shared import _log
    db = await get_db()
    try:
        cleared = await clear_stale_sessions(db)
        if cleared:
            _log(f"Cleared {cleared} stale session(s)")
    finally:
        await db.close()
    asyncio.create_task(run_scanner())


def mount_review_hub(app: FastAPI) -> None:
    """Mount Review Hub routes, socket.io, static files, and scanner onto FastAPI app."""
    # Routes (BEFORE static mounts to prevent path interception).
    # Auto-discover: any module in routes/ exposing a `router` is mounted.
    from src.shared import _log
    for _, mod_name, _ in pkgutil.iter_modules(_rh_routes.__path__):
        if mod_name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"src.review_hub.routes.{mod_name}")
            if hasattr(mod, "router"):
                app.include_router(mod.router)
        except Exception as e:
            _log(f"Review Hub route {mod_name} failed to load: {e}")

    # Socket.io ASGI mount
    set_sio(sio)
    sio_asgi = socketio.ASGIApp(sio)
    app.mount("/socket.io", sio_asgi)

    # Nothing else needed — startup logic is in rh_startup(), called from main lifespan

    # Static file mounts (AFTER routes)
    from config.settings import settings
    media_dir = settings.media_dir
    refs_dir = settings.references_dir
    thumb_dir = settings.thumbnails_dir
    assets_dir = settings.assets_dir
    media_dir.mkdir(parents=True, exist_ok=True)
    refs_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/thumbnails", StaticFiles(directory=str(thumb_dir)), name="rh-thumbnails")
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="rh-media")
    app.mount("/references", StaticFiles(directory=str(refs_dir)), name="rh-references")
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="rh-assets")
