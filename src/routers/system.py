"""System router — health, restart, logs, reports."""
from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter

from src.shared import (
    _log, _log_buffer,
    ReportCostEntry, ReportFeedbackEntry, SessionReportPayload,
    REPORTS_DIR,
)
from config.settings import settings

router = APIRouter(prefix="/api", tags=["system"])


# ── Endpoints ─────────────────────────────────────────────────────────────────

_START_TIME = time.time()

def _detect_lan_ips() -> list[str]:
    """Return all non-loopback LAN IPv4 addresses. Prefers 192.168/10/172.16 prefixes."""
    import socket as _socket
    ips: list[str] = []
    try:
        hostname = _socket.gethostname()
        all_addrs = _socket.getaddrinfo(hostname, None, _socket.AF_INET)
        for info in all_addrs:
            ip = info[4][0]
            if ip.startswith(("192.168.", "10.", "172.")):
                ips.append(ip)
    except Exception:
        pass
    # Fallback: default-route interface
    if not ips:
        try:
            s = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
            s.close()
        except Exception as e:
            _log(f"LAN IP detection failed: {e}")
    return list(dict.fromkeys(ips))  # deduplicate preserving order


@router.get("/health")
def health():
    lan_ips = _detect_lan_ips()
    return {
        "status": "ok",
        "local_ip": lan_ips[0] if lan_ips else "",
        "lan_ips": lan_ips,
        "started_at": _START_TIME,
    }


@router.post("/restart")
def restart_backend():
    """Touch a .py file to trigger uvicorn's --reload file watcher."""
    sentinel = Path(__file__).resolve().parent / "_reload_trigger.py"
    sentinel.write_text(f"# Reload trigger — {time.time()}\n", encoding="utf-8", newline="\n")
    _log("Restart requested — reload trigger touched")
    return {"status": "restarting"}


@router.get("/logs")
def get_logs():
    return {"logs": list(_log_buffer)}


@router.delete("/logs")
def clear_logs():
    _log_buffer.clear()
    return {"ok": True}


@router.post("/report/session")
def save_session_report(payload: SessionReportPayload):
    """Generate a markdown daily report from costs + feedback data."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    today = datetime.now().strftime("%Y-%m-%d")
    report_path = REPORTS_DIR / f"{today}.md"

    # ── Parse session times ────────────────────────────────────────────────
    try:
        t_start = datetime.fromisoformat(payload.sessionStart.replace("Z", "+00:00"))
        t_end = datetime.fromisoformat(payload.sessionEnd.replace("Z", "+00:00"))
        duration_s = (t_end - t_start).total_seconds()
        hours = int(duration_s // 3600)
        minutes = int((duration_s % 3600) // 60)
        duration_str = f"{hours}h {minutes}m" if hours else f"{minutes}m"
        duration_hours = duration_s / 3600 if duration_s > 0 else 0
    except Exception as e:
        _log(f"Session report time parse error: {e}")
        duration_str = "unknown"
        duration_hours = 0

    session_time = datetime.now().strftime("%H:%M:%S")

    # ── Cost summary ───────────────────────────────────────────────────────
    total_cost = sum(c.costUsd for c in payload.costs)
    cost_count = len(payload.costs)

    model_stats: dict[str, dict] = {}
    for c in payload.costs:
        if c.model not in model_stats:
            model_stats[c.model] = {"count": 0, "total": 0.0}
        model_stats[c.model]["count"] += 1
        model_stats[c.model]["total"] += c.costUsd

    node_costs: dict[str, dict] = {}
    for c in payload.costs:
        key = c.nodeId
        if key not in node_costs:
            node_costs[key] = {"name": c.nodeName, "total": 0.0}
        node_costs[key]["total"] += c.costUsd
    top_nodes = sorted(node_costs.items(), key=lambda x: x[1]["total"], reverse=True)[:5]

    # ── Feedback summary ───────────────────────────────────────────────────
    fb_total = len(payload.feedback)
    fb_by_cat: dict[str, int] = {}
    fb_urgent: list[ReportFeedbackEntry] = []
    fb_resolved = 0
    fb_by_node: dict[str, int] = {}

    for f in payload.feedback:
        fb_by_cat[f.category] = fb_by_cat.get(f.category, 0) + 1
        if f.resolved:
            fb_resolved += 1
        elif f.category == "bug" or f.text.startswith("!!!"):
            fb_urgent.append(f)
        node_key = f.nodeId or "overall"
        fb_by_node[node_key] = fb_by_node.get(node_key, 0) + 1

    # ── Build markdown ─────────────────────────────────────────────────────
    lines: list[str] = []

    if report_path.exists():
        lines.append("")
        lines.append("---")
        lines.append("")

    lines.append(f"## Session {session_time}")
    lines.append("")

    lines.append("### Cost Summary")
    lines.append("")
    lines.append(f"**Total spent:** ${total_cost:.4f} ({cost_count} generations)")
    lines.append("")

    if model_stats:
        lines.append("| Model | Count | Total Cost | Avg Cost |")
        lines.append("|---|---|---|---|")
        for model, stats in sorted(model_stats.items(), key=lambda x: x[1]["total"], reverse=True):
            avg = stats["total"] / stats["count"] if stats["count"] > 0 else 0
            lines.append(f"| {model} | {stats['count']} | ${stats['total']:.4f} | ${avg:.4f} |")
        lines.append("")

    if top_nodes:
        lines.append("**Top 5 most expensive nodes:**")
        lines.append("")
        for node_id, info in top_nodes:
            lines.append(f"- `{node_id}` ({info['name']}) — ${info['total']:.4f}")
        lines.append("")

    lines.append("### Feedback Summary")
    lines.append("")
    cats_str = ", ".join(f"{cat}: {count}" for cat, count in sorted(fb_by_cat.items()))
    lines.append(f"**Total:** {fb_total} ({cats_str})" if cats_str else f"**Total:** {fb_total}")
    lines.append(f"**Resolved this session:** {fb_resolved}")
    lines.append("")

    if fb_urgent:
        lines.append("**Urgent (unresolved):**")
        lines.append("")
        for f in fb_urgent:
            lines.append(f"- [{f.category}] {f.text}")
        lines.append("")

    if fb_by_node:
        top_fb_nodes = sorted(fb_by_node.items(), key=lambda x: x[1], reverse=True)[:5]
        lines.append("**By node:**")
        lines.append("")
        for node_id, count in top_fb_nodes:
            lines.append(f"- `{node_id}` — {count} feedback")
        lines.append("")

    lines.append("### Session Stats")
    lines.append("")
    lines.append(f"- **Duration:** {duration_str}")
    lines.append(f"- **Generations:** {cost_count}")
    if duration_hours > 0:
        lines.append(f"- **Cost per hour:** ${total_cost / duration_hours:.4f}")
    lines.append("")

    # ── Write file ─────────────────────────────────────────────────────────
    content = "\n".join(lines)

    if report_path.exists():
        existing = report_path.read_text(encoding="utf-8", newline="").rstrip("\n")
        report_path.write_text(existing + "\n" + content, encoding="utf-8", newline="\n")
    else:
        header = f"# Daily Report — {today}\n\n"
        report_path.write_text(header + content, encoding="utf-8", newline="\n")

    _log(f"Session report saved: {report_path.name} (${total_cost:.4f}, {fb_total} feedback)")
    return {
        "status": "ok",
        "path": str(report_path),
        "totalCost": total_cost,
        "feedbackCount": fb_total,
    }

