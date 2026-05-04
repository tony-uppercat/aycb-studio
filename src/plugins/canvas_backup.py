"""Canvas backup plugin — saves canvas state to shared/data/canvas_backups/ on disk."""
from __future__ import annotations

import json as _json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config.settings import settings
from src.shared import _log

router = APIRouter(prefix="/api/canvas", tags=["canvas"])

MAX_BACKUPS_PER_PROJECT = 20
_BACKUP_DIR_NAME = "canvas_backups"


class CanvasBackupRequest(BaseModel):
    project_id: str
    nodes: list[Any]
    edges: list[Any]
    viewport: dict[str, Any] | None = None


@router.post("/backup")
def save_canvas_backup(req: CanvasBackupRequest):
    backup_dir = settings.shared_root / "data" / _BACKUP_DIR_NAME / req.project_id
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"canvas_{ts}.json"
    filepath = backup_dir / filename

    payload = {
        "version": 2,
        "project_id": req.project_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "canvas": {
            "nodes": req.nodes,
            "edges": req.edges,
            "viewport": req.viewport,
        },
    }
    filepath.write_text(
        _json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
        newline="\n",
    )

    # Rotation: keep only the last MAX_BACKUPS_PER_PROJECT files
    existing = sorted(backup_dir.glob("canvas_*.json"))
    for old in existing[:-MAX_BACKUPS_PER_PROJECT]:
        try:
            old.unlink()
        except OSError as e:
            _log(f"canvas_backup: could not remove old backup {old.name}: {e}")

    remaining = len(existing)
    _log(f"canvas_backup: saved {filename} for {req.project_id} ({remaining} total)")
    return {"status": "ok", "file": filename, "total": remaining}


@router.get("/backup/latest")
def get_latest_backup(project_id: str = Query(...)):
    """Return the most recent backup for a project (for restore)."""
    backup_dir = settings.shared_root / "data" / _BACKUP_DIR_NAME / project_id
    if not backup_dir.exists():
        raise HTTPException(status_code=404, detail="No backups found")
    files = sorted(backup_dir.glob("canvas_*.json"))
    if not files:
        raise HTTPException(status_code=404, detail="No backups found")
    latest = files[-1]
    data = _json.loads(latest.read_text(encoding="utf-8"))
    _log(f"canvas_backup: serving {latest.name} for restore ({len(data.get('canvas', {}).get('nodes', []))} nodes)")
    return data


@router.get("/restore")
def restore_page(project_id: str = Query(...), name: str = Query("restored")):
    """Serve a self-contained HTML page that restores a backup into a new IDB project."""
    from fastapi.responses import HTMLResponse

    backup_dir = settings.shared_root / "data" / _BACKUP_DIR_NAME / project_id
    if not backup_dir.exists():
        raise HTTPException(status_code=404, detail="No backups found")
    files = sorted(backup_dir.glob("canvas_*.json"))
    if not files:
        raise HTTPException(status_code=404, detail="No backups found")
    latest = files[-1]
    data = _json.loads(latest.read_text(encoding="utf-8"))
    nodes = data.get("canvas", {}).get("nodes", [])
    edges = data.get("canvas", {}).get("edges", [])
    viewport = data.get("canvas", {}).get("viewport")
    node_count = len(nodes)
    edge_count = len(edges)

    canvas_json = _json.dumps({"nodes": nodes, "edges": edges, "viewport": viewport}, ensure_ascii=False)
    safe_name = name.replace("'", "\\'").replace('"', "&quot;")

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Restore — {safe_name}</title>
<style>body{{font-family:system-ui;background:#0a0a0b;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
.box{{text-align:center;max-width:400px}}h2{{color:#F52776}}#status{{margin-top:1em;color:#a1a1aa}}</style></head>
<body><div class="box"><h2>Restore</h2>
<p>Creating <b>{safe_name}</b> ({node_count} nodes, {edge_count} edges)</p>
<div id="status">Working...</div></div>
<script>
(async()=>{{
  const S=document.getElementById('status');
  try{{
    const canvas={canvas_json};
    const nodes=canvas.nodes, edges=canvas.edges, viewport=canvas.viewport;
    const db=await new Promise((res,rej)=>{{const r=indexedDB.open('geminishot_projects');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}});
    const newId='proj-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const now=new Date().toISOString();
    const mids=nodes.flatMap(n=>{{const d=n.data||{{}};const a=[];if(d.mediaId)a.push(d.mediaId);if(d.historyIds)a.push(...d.historyIds);return a}});
    const rec={{id:newId,name:'{safe_name}',createdAt:now,updatedAt:now,canvas:{{nodes,edges,viewport}},settings:{{model:'Gemini 3 Flash',doEmbed:false}},mediaIds:mids}};
    await new Promise((res,rej)=>{{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(rec);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)}});
    localStorage.setItem('activeProjectId',newId);
    await new Promise((res,rej)=>{{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({{key:'activeProjectId',value:newId}});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)}});
    S.textContent='Done! Redirecting...';
    setTimeout(()=>window.location.href='/',500);
  }}catch(e){{S.textContent='Error: '+e.message;S.style.color='#ef4444'}}
}})();
</script></body></html>"""
    return HTMLResponse(content=html)


@router.get("/backup/open")
def open_backup_folder(project_id: str = Query(...)):
    backup_dir = settings.shared_root / "data" / _BACKUP_DIR_NAME / project_id
    backup_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.startfile(str(backup_dir))
    except Exception as e:
        _log(f"canvas_backup: could not open folder for {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok"}
