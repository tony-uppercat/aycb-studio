"""Dump a canvas backup as a compact, structural summary (no big text blobs)."""
import json
import sys
from collections import Counter
from pathlib import Path

CANVAS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:/Users/upper/Documents/shared/data/canvas_backups/proj-1779207005835-ik3jy4/canvas_20260519_162506.json"
)
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
    r"C:/Users/upper/Documents/00_aycb_v2/reports/_canvas_inspect.txt"
)

OUT.parent.mkdir(parents=True, exist_ok=True)
data = json.loads(CANVAS.read_text(encoding="utf-8"))
canvas = data["canvas"]
nodes = canvas["nodes"]
edges = canvas.get("edges", [])
by_id = {n["id"]: n for n in nodes}

lines: list[str] = []
lines.append(f"PROJECT: {data['project_id']}")
lines.append(f"TIMESTAMP: {data['timestamp']}")
lines.append(f"NODES: {len(nodes)}   EDGES: {len(edges)}")
lines.append("")

types = Counter(n["type"] for n in nodes)
lines.append("=== TYPE COUNTS ===")
for t, c in types.most_common():
    lines.append(f"  {c:3d} x {t}")
lines.append("")

lines.append("=== NODES ===")
for n in nodes:
    d = n.get("data", {}) or {}
    name = n["id"]
    label = f"{name} [{n['type']}]"
    custom = d.get("_customName")
    if custom:
        label += f"  name={custom!r}"
    lines.append(label)
    pos = n.get("position", {})
    lines.append(f"    pos=({pos.get('x',0):.0f},{pos.get('y',0):.0f})")
    for k, v in d.items():
        if k.startswith("_") and k != "_customName":
            continue
        if k == "_customName":
            continue
        if k in ("prompt", "text", "outputText", "systemPrompt"):
            if isinstance(v, str) and v:
                preview = v.replace("\n", " | ")[:90]
                lines.append(f"    {k}=<{len(v)} chars> {preview}")
            continue
        if isinstance(v, dict):
            lines.append(f"    {k}={{{len(v)} keys}}: {list(v.keys())[:6]}")
            continue
        if isinstance(v, list):
            lines.append(f"    {k}=[{len(v)} items]")
            continue
        if isinstance(v, str) and len(v) > 90:
            lines.append(f"    {k}={v[:90]}...")
            continue
        lines.append(f"    {k}={v!r}")
    lines.append("")

lines.append("=== EDGES ===")
for e in edges:
    s = by_id.get(e["source"], {}).get("type", "?")
    t = by_id.get(e["target"], {}).get("type", "?")
    sh = e.get("sourceHandle", "")
    th = e.get("targetHandle", "")
    lines.append(f"  {e['source']}[{s}]:{sh}  ->  {e['target']}[{t}]:{th}")

OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
print(f"Wrote {OUT} ({len(lines)} lines)")
