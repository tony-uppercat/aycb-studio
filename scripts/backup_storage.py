"""Storage backup script.

Snapshots server-side data at risk during the storage migration into
`shared/backups/<UTC_timestamp>/server/`:

- `.env`                — API keys + settings (repo root)
- `review-hub.db`       — Review Hub SQLite (consistent online backup)
- `canvas_backups/`     — Per-project canvas history

A sibling `browser/` directory is created as a drop-zone for the
DevTools dump (localStorage + IDB). The snippet to produce that dump
is documented in `BROWSER_DUMP.md` next to the manifest.

Shared media (`shared/Media/`, `shared/References/`) is NOT copied —
it lives on disk already and is not at risk from the planned cleanup.

Usage:
    python scripts/backup_storage.py
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import settings  # noqa: E402


CHUNK = 64 * 1024
MANIFEST_SCHEMA_VERSION = 1


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def dir_stats(path: Path) -> tuple[int, int]:
    total, count = 0, 0
    for f in path.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
            count += 1
    return total, count


def backup_sqlite_online(src: Path, dst: Path) -> None:
    """Use SQLite online backup API for a WAL-safe consistent snapshot."""
    src_conn = sqlite3.connect(str(src))
    try:
        dst_conn = sqlite3.connect(str(dst))
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
    finally:
        src_conn.close()


def write_text_lf(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def render_readme(timestamp_iso: str, source_root: Path, files: list[dict]) -> str:
    lines = [
        "# Storage backup snapshot",
        "",
        f"- **Created (UTC):** `{timestamp_iso}`",
        f"- **Source root:** `{source_root}`",
        "",
        "## Contents",
        "",
        "### `server/`",
        "",
        "Server-side filesystem snapshot:",
        "",
        "| File | Size | Notes |",
        "| --- | ---: | --- |",
    ]
    for f in files:
        size_kb = f.get("size_bytes", 0) / 1024
        lines.append(f"| `{f['name']}` | {size_kb:,.1f} KB | {f.get('notes', '')} |")
    lines.extend([
        "",
        "### `browser/`",
        "",
        "Drop-zone for the browser dump (initially empty). To populate:",
        "",
        "1. Open AYCB Studio (http://localhost:5100) in your browser.",
        "2. Open DevTools (F12) -> Console tab.",
        "3. Run the snippet from `BROWSER_DUMP.md` in this folder.",
        "4. Move the downloaded files into `browser/` here.",
        "",
        "## Restore",
        "",
        "- `.env` -> repo root.",
        "- `review-hub.db` -> `shared/data/review-hub.db` (**stop backend first**).",
        "- `canvas_backups/` -> `shared/data/canvas_backups/` (overwrite per project).",
        "- Browser JSON dumps -> see `BROWSER_DUMP.md` for restore script.",
        "",
        "## Integrity",
        "",
        "See `manifest.json` for per-file SHA256 (files only — not directories).",
        "",
    ]
    )
    return "\n".join(lines)


BROWSER_SNIPPET = r"""// AYCB Studio — Browser state dump
// Paste this into DevTools Console while AYCB Studio is open at :5100.
// Downloads three files; drop them into this backup folder's `browser/`.

(async () => {
  const out = {};
  const start = performance.now();

  // ── 1. localStorage ────────────────────────────────────────────────
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) ls[k] = localStorage.getItem(k);
  }
  out.localStorage = { entries: ls, key_count: Object.keys(ls).length };

  function download(name, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  download("localStorage.json", out.localStorage);
  console.log(`[backup] localStorage -> ${Object.keys(ls).length} keys`);

  // ── 2. geminishot_projects (canvases + meta) ───────────────────────
  async function dumpIDB(dbName, storeNames) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const result = { db: dbName, version: db.version, stores: {} };
        const stores = storeNames.filter(s => db.objectStoreNames.contains(s));
        if (stores.length === 0) { db.close(); return resolve(result); }
        const tx = db.transaction(stores, "readonly");
        let pending = stores.length;
        stores.forEach(s => {
          const r = tx.objectStore(s).getAll();
          const k = tx.objectStore(s).getAllKeys();
          let dataR, keysR;
          r.onsuccess = () => { dataR = r.result; if (keysR) finish(s, keysR, dataR); };
          k.onsuccess = () => { keysR = k.result; if (dataR !== undefined) finish(s, keysR, dataR); };
          function finish(name, keys, values) {
            result.stores[name] = keys.map((kk, i) => ({ key: kk, value: values[i] }));
            if (--pending === 0) { db.close(); resolve(result); }
          }
        });
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }

  const projects = await dumpIDB("geminishot_projects", ["projects", "meta"]);
  download("idb_projects.json", projects);
  const projCount = (projects.stores.projects ?? []).length;
  console.log(`[backup] geminishot_projects -> ${projCount} projects`);

  // ── 3. geminishot_media (blobs + thumbs, base64-encoded) ───────────
  async function blobToB64(b) {
    if (!(b instanceof Blob)) return null;
    const buf = await b.arrayBuffer();
    let bin = ""; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { type: b.type, size: b.size, b64: btoa(bin) };
  }

  const mediaRaw = await dumpIDB("geminishot_media", ["blobs", "thumbs"]);
  const media = { db: mediaRaw.db, version: mediaRaw.version, stores: {} };
  for (const [storeName, items] of Object.entries(mediaRaw.stores)) {
    media.stores[storeName] = [];
    for (const { key, value } of items) {
      let encoded = value;
      if (value instanceof Blob) encoded = await blobToB64(value);
      else if (value && typeof value === "object" && "type" in value && "size" in value) {
        // File object
        encoded = await blobToB64(value);
      }
      media.stores[storeName].push({ key, value: encoded });
    }
  }
  download("idb_media.json", media);
  const blobCount = (media.stores.blobs ?? []).length;
  const thumbCount = (media.stores.thumbs ?? []).length;
  console.log(`[backup] geminishot_media -> ${blobCount} blobs, ${thumbCount} thumbs`);

  console.log(`[backup] done in ${((performance.now() - start) / 1000).toFixed(1)}s`);
})();
"""


def render_browser_dump_md(backup_dir: Path) -> str:
    return (
        "# Browser dump snippet\n"
        "\n"
        "Run this in DevTools Console while AYCB Studio is open at "
        "http://localhost:5100.\n"
        "\n"
        "It triggers 3 downloads:\n"
        "- `localStorage.json` — every `aycb_*` key.\n"
        "- `idb_projects.json` — `geminishot_projects` IDB (projects + meta).\n"
        "- `idb_media.json` — `geminishot_media` IDB (blobs + thumbs, "
        "base64-encoded).\n"
        "\n"
        "Move the 3 files into this folder's `browser/` subdirectory.\n"
        "\n"
        "## Snippet\n"
        "\n"
        "```js\n"
        f"{BROWSER_SNIPPET}\n"
        "```\n"
        "\n"
        "## Notes\n"
        "\n"
        "- `idb_media.json` can be large (potentially hundreds of MB) "
        "because it includes base64-encoded blobs. If the download fails or "
        "the browser hangs, you can skip the media store — re-run the snippet "
        "after editing it to comment out the `geminishot_media` block.\n"
        "- The dump is read-only; no IDB mutation occurs.\n"
        f"- Target backup folder: `{backup_dir}`\n"
    )


def main() -> None:
    ts_utc = datetime.now(timezone.utc)
    ts_dir = ts_utc.strftime("%Y-%m-%d_%H%M%S")
    backups_root = settings.shared_root / "backups"
    snapshot_dir = backups_root / ts_dir
    server_dir = snapshot_dir / "server"
    browser_dir = snapshot_dir / "browser"
    server_dir.mkdir(parents=True, exist_ok=True)
    browser_dir.mkdir(parents=True, exist_ok=True)

    files_meta: list[dict] = []

    print(f"[backup] target: {snapshot_dir}")

    # 1. .env
    env_src = settings.project_root / ".env"
    if env_src.exists():
        env_dst = server_dir / ".env"
        shutil.copy2(env_src, env_dst)
        files_meta.append({
            "name": ".env",
            "source": str(env_src),
            "size_bytes": env_dst.stat().st_size,
            "sha256": sha256_of(env_dst),
            "notes": "API keys + settings",
        })
        print(f"[ok]   .env ({env_dst.stat().st_size:,} bytes)")
    else:
        print(f"[skip] .env not found at {env_src}")

    # 2. review-hub.db — pick the largest of the candidate locations.
    # CLAUDE.md flags this: src/review_hub/db.py uses a repo-local path
    # (`<project_root>/shared/data/review-hub.db`) while settings.db_path
    # points outside the repo. Until that is unified, snapshot whichever
    # file is non-empty.
    db_candidates = [
        settings.db_path,
        settings.project_root / "shared" / "data" / "review-hub.db",
    ]
    db_src = max(
        (p for p in db_candidates if p.exists()),
        key=lambda p: p.stat().st_size,
        default=None,
    )
    if db_src is not None and db_src.stat().st_size > 0:
        db_dst = server_dir / "review-hub.db"
        backup_sqlite_online(db_src, db_dst)
        files_meta.append({
            "name": "review-hub.db",
            "source": str(db_src),
            "size_bytes": db_dst.stat().st_size,
            "sha256": sha256_of(db_dst),
            "notes": "Review Hub SQLite (consistent snapshot via .backup())",
        })
        print(f"[ok]   review-hub.db <- {db_src} ({db_dst.stat().st_size:,} bytes, WAL-safe)")
    else:
        print(f"[skip] no non-empty review-hub.db found in {db_candidates}")

    # 3. canvas_backups/
    canvas_src = settings.shared_root / "data" / "canvas_backups"
    if canvas_src.exists():
        canvas_dst = server_dir / "canvas_backups"
        shutil.copytree(canvas_src, canvas_dst)
        size, count = dir_stats(canvas_dst)
        files_meta.append({
            "name": "canvas_backups/",
            "source": str(canvas_src),
            "size_bytes": size,
            "file_count": count,
            "notes": f"{count} per-project canvas snapshots",
        })
        print(f"[ok]   canvas_backups/ ({count} files, {size:,} bytes)")
    else:
        print(f"[skip] canvas_backups/ not found at {canvas_src}")

    # 4. manifest.json
    manifest = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "timestamp_utc": ts_utc.isoformat(),
        "source_root": str(settings.shared_root),
        "project_root": str(settings.project_root),
        "files": files_meta,
        "browser_dump": {
            "status": "pending",
            "expected_files": [
                "browser/localStorage.json",
                "browser/idb_projects.json",
                "browser/idb_media.json",
            ],
            "instructions": "BROWSER_DUMP.md",
        },
    }
    manifest_path = snapshot_dir / "manifest.json"
    write_text_lf(
        manifest_path,
        json.dumps(manifest, indent=2, ensure_ascii=False),
    )

    # 5. README.md
    write_text_lf(
        snapshot_dir / "README.md",
        render_readme(manifest["timestamp_utc"], settings.shared_root, files_meta),
    )

    # 6. BROWSER_DUMP.md (with snippet)
    write_text_lf(
        snapshot_dir / "BROWSER_DUMP.md",
        render_browser_dump_md(snapshot_dir),
    )

    total = sum(f.get("size_bytes", 0) for f in files_meta)
    print()
    print(f"=== Server backup complete ===")
    print(f"Folder:      {snapshot_dir}")
    print(f"Server size: {total:,} bytes ({total / 1024:,.1f} KB)")
    print(f"Files:       {len(files_meta)} entries")
    print()
    print(f"Next: open {snapshot_dir / 'BROWSER_DUMP.md'} and run the")
    print(f"snippet in DevTools to capture browser state.")


if __name__ == "__main__":
    main()
