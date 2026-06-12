"""Claude local-CLI LLM path — invoke the installed `claude` binary in headless
print mode (subscription auth, no API key). Mirrors PAO-Pipeline's
engine/producers/claude_cli.py, adapted to AYCB's node-shape return.

The single network seam is `run_fn(cmd, stdin) -> (returncode, stdout_str)`; tests
inject a fake so no real claude is ever spawned. The instruction is piped via STDIN
(not argv) — a large prompt as a CLI arg blows Windows' ~8191-char command-line limit.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys

_TIMEOUT = 600   # seconds; one blocking `claude -p` invocation
_CLI_PREFIX = "cli-"


def is_claude_cli_model(model_id: str) -> bool:
    """A CLI-routed model id, e.g. 'cli-claude-opus-4-8'. Deliberately narrower than the
    API check (startswith 'claude-') so the two paths never collide."""
    return model_id.startswith("cli-claude-")


def real_model(model_id: str) -> str:
    """Strip the routing prefix: 'cli-claude-opus-4-8' -> 'claude-opus-4-8'."""
    return model_id[len(_CLI_PREFIX):] if model_id.startswith(_CLI_PREFIX) else model_id


def build_command(model: str, system: str | None, n_images: int) -> list[str]:
    """`claude -p` invocation. JSON output so we can read usage + cost. --max-turns scales
    with image count: each Read of an image consumes one agentic turn, plus one for the
    final response. --bare is omitted (it forces ANTHROPIC_API_KEY-only auth, breaking the
    subscription/OAuth session).

    --tools restricts the available tool pool: this is a GENERATION node, not an agent. With
    no images the model gets NO tools ('') so it answers directly and cannot wander into
    tool calls (which exhaust --max-turns -> error_max_turns) or auto-fire discovered skills.
    With images it gets ONLY Read, to load each image before responding."""
    max_turns = max(2, n_images + 2)
    cmd = ["claude", "-p", "--output-format", "json",
           "--max-turns", str(max_turns),
           "--model", model,
           "--permission-mode", "bypassPermissions",
           "--tools", ("Read" if n_images > 0 else "")]
    if system:
        cmd += ["--append-system-prompt", system]
    return cmd


def build_instruction(prompt: str, image_paths: list[str]) -> str:
    """PRINT-ONLY instruction piped to claude via STDIN. A per-image Read directive makes
    the agent load each image before responding; the trailer forbids file writes."""
    parts = [prompt or ""]
    for p in image_paths:
        parts.append(f"\n\nRead and analyze the image at {p}.")
    parts.append("\n\nRespond with ONLY the result text. Do NOT write any files.")
    return "".join(parts)


def _win_exec(cmd: list[str]) -> list[str]:
    """Resolve the Windows npm shim (claude.cmd/.ps1) via PATH and wrap so Popen launches
    it. Unresolved -> returned unchanged (the run then raises a clear error)."""
    if not cmd:
        return cmd
    exe = shutil.which(cmd[0])
    if not exe:
        return cmd
    low = exe.lower()
    if low.endswith((".cmd", ".bat")):
        return ["cmd", "/c", exe, *cmd[1:]]
    if low.endswith(".ps1"):
        return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", exe, *cmd[1:]]
    return [exe, *cmd[1:]]


def _default_run(cmd: list[str], stdin: str) -> tuple[int, str, str]:
    """Production seam: resolve the shim on Windows, run with the instruction piped to
    STDIN, capture stdout + stderr. Returns (returncode, stdout_str, stderr_str). stderr is
    the only diagnostic when claude fails before emitting its JSON envelope."""
    if sys.platform == "win32":
        cmd = _win_exec(cmd)
    proc = subprocess.run(cmd, input=stdin, capture_output=True, text=True,
                          encoding="utf-8", timeout=_TIMEOUT)
    return proc.returncode, (proc.stdout or ""), (proc.stderr or "")


def parse_result(rc: int, stdout: str, stderr: str = "") -> dict:
    """Map claude's JSON result envelope to the AYCB node shape
    {text, status, usage{input_tokens, output_tokens, cost_usd}}.

    claude prints its JSON envelope even when it exits non-zero (e.g. error_max_turns
    emits is_error=true on stdout AND exits 1). So we parse the envelope FIRST regardless
    of rc and surface its real reason (subtype + errors[]) — masking that as a generic
    'claude exited 1' was the original blind-spot bug. Only when there is no parseable
    JSON do we fall back to rc + stderr."""
    err = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    try:
        obj = json.loads(stdout)
    except (ValueError, TypeError):
        obj = None

    if isinstance(obj, dict):
        if obj.get("is_error") or not (obj.get("result") or "").strip():
            reason = obj.get("subtype") or "error"
            errs = obj.get("errors") or []
            detail = "; ".join(errs) if errs else (obj.get("result") or "claude reported an error")
            return {"text": "", "status": "ERROR", "error": f"Claude CLI {reason}: {detail}", "usage": err}
        u = obj.get("usage") or {}
        return {
            "text": obj["result"],
            "status": "OK",
            "usage": {
                "input_tokens": u.get("input_tokens", 0),
                "output_tokens": u.get("output_tokens", 0),
                "cost_usd": round(obj.get("total_cost_usd", 0.0), 6),
            },
        }

    # No parseable JSON: claude died before emitting its envelope. Use rc + stderr tail.
    tail = (stderr or "").strip()[-400:]
    msg = f"claude exited {rc}" if rc != 0 else "claude returned non-JSON output"
    if tail:
        msg += f": {tail}"
    return {"text": "", "status": "ERROR", "error": msg, "usage": err}


def run(prompt: str, model_id: str, system: str | None,
        image_paths: list[str], run_fn=None) -> dict:
    """Invoke claude once for a prompt (+ optional images already on disk) and return the
    AYCB node-shape dict. `run_fn(cmd, stdin) -> (rc, stdout, stderr)` is injected in tests
    so no real claude is spawned."""
    if run_fn is None:
        run_fn = _default_run
    cmd = build_command(real_model(model_id), (system or "").strip() or None, len(image_paths))
    instruction = build_instruction(prompt, image_paths)
    rc, stdout, stderr = run_fn(cmd, instruction)
    return parse_result(rc, stdout, stderr)
