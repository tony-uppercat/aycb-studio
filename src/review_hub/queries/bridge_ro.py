"""Read-only sync queries for the AYCB ↔ Review Hub bridge.

Before this module, eight sqlite3.connect(..., mode=ro) helpers were
scattered across src/routers/bridge.py and src/routers/bridge_assets.py,
each with inline SQL and direct schema knowledge (v2 audit M1). A
schema migration touching the `media`, `favorites`, `comments`,
`drawings`, `references`, `assets`, or `media_asset_links` tables had
to find and update nine separate call sites.

This module collects them so schema knowledge lives in one place.

Conventions:
- Functions are sync (deliberate: perf — the routers wrap them in
  ``asyncio.to_thread`` before awaiting).
- Each opens its own read-only connection via the DB URI; failures are
  logged and produce empty / None results rather than raising, matching
  the prior per-caller behavior.
- We read ``_DB_PATH`` from ``src.review_hub.db`` at call time (not
  import time) so tests that monkeypatch the attribute see the change.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from src.shared import _log


def _db_path() -> Path:
    """Read the DB path fresh on every call so tests can monkeypatch it."""
    from src.review_hub import db as _db_mod
    return _db_mod._DB_PATH


def _connect_ro() -> sqlite3.Connection | None:
    """Open a read-only connection or return None if the DB is missing."""
    p = _db_path()
    if not p.exists():
        return None
    return sqlite3.connect(p.as_uri() + "?mode=ro", uri=True)


# ── Media / review status ──────────────────────────────────────────────

def get_review_info(stem: str) -> dict | None:
    """Return review status for a media stem, or None if not indexed.

    Shape: ``{status, reviewed_by, favorite, comments_count, drawings_count}``
    where ``status`` is one of ``"approved" | "rejected" | None``.
    """
    con = _connect_ro()
    if con is None:
        return None
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT id FROM media WHERE filename LIKE ? LIMIT 1",
            (f"{stem}%",),
        ).fetchone()
        if not row:
            return None
        media_id = row["id"]
        favs = con.execute(
            "SELECT status, user_name FROM favorites WHERE media_id=?",
            (media_id,),
        ).fetchall()
        comment_count = con.execute(
            "SELECT COUNT(*) FROM comments WHERE media_id=?",
            (media_id,),
        ).fetchone()[0]
        drawing_count = con.execute(
            "SELECT COUNT(*) FROM drawings WHERE media_id=?",
            (media_id,),
        ).fetchone()[0]

        status = None
        reviewed_by = None
        favorite = False
        for f in favs:
            if f["status"] in ("approved", "rejected"):
                status = f["status"]
                reviewed_by = f["user_name"]
            if f["status"] == "favorite":
                favorite = True

        return {
            "status": status,
            "reviewed_by": reviewed_by,
            "favorite": favorite,
            "comments_count": comment_count,
            "drawings_count": drawing_count,
        }
    except Exception as e:
        _log(f"bridge_ro.get_review_info('{stem}'): {e}")
        return None
    finally:
        con.close()


def filename_to_thumbnail_id() -> dict[str, int]:
    """Return ``{filename: media_id}`` for all rows in the media table.

    The router side turns ``media_id`` into a URL like
    ``/thumbnails/{id}.jpg`` and checks the file exists. Keeping the
    URL construction out of this module keeps the contract narrow.
    """
    con = _connect_ro()
    if con is None:
        return {}
    try:
        rows = con.execute("SELECT id, filename FROM media").fetchall()
        return {filename: media_id for media_id, filename in rows}
    except Exception as e:
        _log(f"bridge_ro.filename_to_thumbnail_id: {e}")
        return {}
    finally:
        con.close()


def find_media_id_by_stem(stem: str) -> int | None:
    """Resolve a filename-stem (no extension) to its media_id."""
    con = _connect_ro()
    if con is None:
        return None
    try:
        row = con.execute(
            "SELECT id FROM media WHERE filename LIKE ? LIMIT 1",
            (f"{stem}%",),
        ).fetchone()
        return row[0] if row else None
    except Exception as e:
        _log(f"bridge_ro.find_media_id_by_stem('{stem}'): {e}")
        return None
    finally:
        con.close()


# ── References ─────────────────────────────────────────────────────────

def query_references(search: str = "", tag: str = "") -> list[dict]:
    """List reference rows, optionally filtered by free-text or tag.

    The ``[references]`` table name is bracketed because ``references``
    is a reserved word in SQLite.
    """
    con = _connect_ro()
    if con is None:
        return []
    try:
        con.row_factory = sqlite3.Row
        cur = con.cursor()

        params: list[str] = []
        where_clauses: list[str] = []

        if search:
            like = f"%{search}%"
            where_clauses.append(
                "(filename LIKE ? OR tags LIKE ? OR notes LIKE ?)"
            )
            params.extend([like, like, like])

        if tag:
            where_clauses.append("tags LIKE ?")
            params.append(f"%{tag}%")

        sql = "SELECT * FROM [references]"
        if where_clauses:
            sql += " WHERE " + " AND ".join(where_clauses)
        sql += " ORDER BY created_at DESC"

        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        _log(f"bridge_ro.query_references: {e}")
        return []
    finally:
        con.close()


def get_reference_thumbnail_path(ref_id: int) -> str | None:
    con = _connect_ro()
    if con is None:
        return None
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT thumbnail_path FROM [references] WHERE id = ?", (ref_id,),
        ).fetchone()
        return row["thumbnail_path"] if row else None
    except Exception as e:
        _log(f"bridge_ro.get_reference_thumbnail_path({ref_id}): {e}")
        return None
    finally:
        con.close()


def get_reference_image_paths(ref_id: int) -> tuple[str | None, str | None]:
    """Return ``(processed_path, original_path)`` — either or both can be None."""
    con = _connect_ro()
    if con is None:
        return None, None
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT processed_path, original_path FROM [references] WHERE id = ?",
            (ref_id,),
        ).fetchone()
        if row:
            return row["processed_path"], row["original_path"]
        return None, None
    except Exception as e:
        _log(f"bridge_ro.get_reference_image_paths({ref_id}): {e}")
        return None, None
    finally:
        con.close()


# ── Assets ─────────────────────────────────────────────────────────────

def list_assets_enriched(
    directory: str | None,
    *,
    assets_dir: Path,
    media_dir: Path,
    thumbnails_dir: Path,
) -> list[dict]:
    """Return assets rows plus linked-media rows from media_asset_links.

    URL construction is done here rather than in the router because the
    JOIN shape and the URL prefix conventions (``/assets/``,
    ``/media/``, ``/thumbnails/``) are both tightly coupled to this
    table set. The caller passes the filesystem bases so this module
    stays free of ``config.settings`` (easier to test in isolation).
    """
    con = _connect_ro()
    if con is None:
        return []
    try:
        con.row_factory = sqlite3.Row
        if directory is not None:
            rows = con.execute(
                "SELECT * FROM assets WHERE directory=? ORDER BY filename ASC",
                (directory,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM assets ORDER BY directory ASC, filename ASC"
            ).fetchall()

        result: list[dict] = []
        for row in rows:
            item = dict(row)
            fp = item.get("filepath")
            if fp:
                try:
                    rel = Path(fp).relative_to(assets_dir)
                    item["asset_url"] = "/assets/" + rel.as_posix()
                except (ValueError, TypeError):
                    item["asset_url"] = f"/assets/{item.get('filename', '')}"
            tp = item.get("thumbnail_path")
            if tp:
                try:
                    rel_thumb = Path(tp).relative_to(thumbnails_dir)
                    item["thumbnail_url"] = "/thumbnails/" + rel_thumb.as_posix()
                except (ValueError, TypeError):
                    item["thumbnail_url"] = None
            else:
                item["thumbnail_url"] = None
            result.append(item)

        # Linked media rows.
        if directory is not None:
            link_rows = con.execute(
                """SELECT l.id AS link_id, l.media_id, l.directory,
                          m.filename, m.filepath, m.thumbnail_path, m.mime_type,
                          m.file_size, m.width, m.height
                   FROM media_asset_links l
                   JOIN media m ON m.id = l.media_id
                   WHERE l.directory = ?
                   ORDER BY l.created_at DESC""",
                (directory,),
            ).fetchall()
        else:
            link_rows = con.execute(
                """SELECT l.id AS link_id, l.media_id, l.directory,
                          m.filename, m.filepath, m.thumbnail_path, m.mime_type,
                          m.file_size, m.width, m.height
                   FROM media_asset_links l
                   JOIN media m ON m.id = l.media_id
                   ORDER BY l.created_at DESC""",
            ).fetchall()

        for lr in link_rows:
            lnk = dict(lr)
            media_url: str | None = None
            fp = lnk.get("filepath")
            if fp:
                try:
                    media_url = "/media/" + Path(fp).relative_to(media_dir).as_posix()
                except (ValueError, TypeError):
                    media_url = f"/media/{lnk.get('filename', '')}"
            thumb_url: str | None = None
            tp = lnk.get("thumbnail_path")
            if tp:
                try:
                    thumb_url = "/thumbnails/" + Path(tp).relative_to(thumbnails_dir).as_posix()
                except (ValueError, TypeError):
                    pass
            result.append({
                "id": lnk["link_id"],
                "filename": lnk["filename"],
                "directory": lnk["directory"],
                "file_size": lnk.get("file_size"),
                "mime_type": lnk.get("mime_type"),
                "width": lnk.get("width"),
                "height": lnk.get("height"),
                "asset_url": media_url,
                "thumbnail_url": thumb_url,
                "is_link": True,
                "media_id": lnk["media_id"],
                "link_id": lnk["link_id"],
            })
        return result
    except Exception as e:
        _log(f"bridge_ro.list_assets_enriched({directory}): {e}")
        return []
    finally:
        con.close()


def get_asset_row(asset_id: int) -> dict | None:
    con = _connect_ro()
    if con is None:
        return None
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT filepath, mime_type, thumbnail_path FROM assets WHERE id=?",
            (asset_id,),
        ).fetchone()
        return dict(row) if row else None
    except Exception as e:
        _log(f"bridge_ro.get_asset_row({asset_id}): {e}")
        return None
    finally:
        con.close()
