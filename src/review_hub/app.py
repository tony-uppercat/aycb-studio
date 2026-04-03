"""Review Hub — Socket.io server + FastAPI mount."""
from __future__ import annotations

import asyncio
import socketio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from src.review_hub.db import init_db
from src.review_hub.scanner import run_scanner, set_sio
from src.review_hub.routes import media, comments, favorites, drawings, references, upload, download, folders, feedback, logs

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=[])

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

@sio.event
async def drawing_stroke(sid, data):
    await sio.emit("drawing_stroke", data, room="review", skip_sid=sid)

@sio.event
async def drawing_clear(sid, data):
    await sio.emit("drawing_clear", data, room="review", skip_sid=sid)

@sio.event
async def drawing_undo(sid, data):
    await sio.emit("drawing_undo", data, room="review", skip_sid=sid)

@sio.event
async def cursor_move(sid, data):
    await sio.emit("cursor_move", data, room="review", skip_sid=sid)

@sio.event
async def comment_new(sid, data):
    await sio.emit("comment_new", data, room="review", skip_sid=sid)

@sio.event
async def favorite_toggle(sid, data):
    await sio.emit("favorite_toggle", data, room="review", skip_sid=sid)

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

def mount_review_hub(app: FastAPI) -> None:
    """Mount Review Hub routes, socket.io, static files, and scanner onto FastAPI app."""
    # Routes (BEFORE static mounts to prevent path interception)
    for router_mod in [media, comments, favorites, drawings, references, upload, download, folders, feedback, logs]:
        app.include_router(router_mod.router)

    # Socket.io ASGI mount
    set_sio(sio)
    sio_asgi = socketio.ASGIApp(sio)
    app.mount("/socket.io", sio_asgi)

    # DB init + scanner background task on startup
    @app.on_event("startup")
    async def _rh_startup():
        await init_db()
        asyncio.create_task(run_scanner())

    # Static file mounts (AFTER routes)
    from config.settings import settings
    media_dir = settings.media_dir
    refs_dir = settings.references_dir
    thumb_dir = settings.thumbnails_dir
    media_dir.mkdir(parents=True, exist_ok=True)
    refs_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/thumbnails", StaticFiles(directory=str(thumb_dir)), name="rh-thumbnails")
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="rh-media")
    app.mount("/references", StaticFiles(directory=str(refs_dir)), name="rh-references")
