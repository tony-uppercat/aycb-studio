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


_EFFORT_LEVELS = {"low", "medium", "high", "xhigh", "max"}


def build_command(model: str, system_file: str | None, n_images: int,
                  skills_enabled: bool = False,
                  effort: str | None = None) -> list[str]:
    """`claude -p` invocation. JSON output so we can read usage + cost.

    Default (generation node): NO tools ('' / 'Read' for images), --max-turns
    scales with image count, so the model answers directly without wandering
    into tool calls or auto-firing skills.

    skills_enabled (knowledge-skills mode): the pool gains Skill + read-only
    helpers ('Skill Read Glob Grep WebSearch') so the model can discover and
    load Agent Skills, and --max-turns rises to leave room for skill load + a
    couple of reads + the final answer. Still NO Bash/Write/Edit — knowledge
    skills only, no shell, no file writes.

    effort: forwarded to `claude --effort <level>` when set to one of
    low|medium|high|xhigh|max. None / "auto" / unknown values → no flag, so
    the CLI uses its own default (the user's claude config). This is the
    canonical 'auto' behavior — claude picks its own depth.

    --bare is omitted (it forces ANTHROPIC_API_KEY-only auth, breaking the
    subscription session). System prompt passed as a FILE; user prompt via
    STDIN — both off argv (Windows ~8191-char command-line limit)."""
    if skills_enabled:
        max_turns = max(8, n_images + 4)
        tools = "Skill Read Glob Grep WebSearch"
    else:
        max_turns = max(2, n_images + 2)
        tools = "Read" if n_images > 0 else ""
    cmd = ["claude", "-p", "--output-format", "json",
           "--max-turns", str(max_turns),
           "--model", model,
           "--permission-mode", "bypassPermissions",
           "--tools", tools]
    if effort and effort in _EFFORT_LEVELS:
        cmd += ["--effort", effort]
    if system_file:
        cmd += ["--append-system-prompt-file", system_file]
    return cmd


def build_instruction(prompt: str, image_paths: list[str],
                      skill_names: list[str] | None = None) -> str:
    """PRINT-ONLY instruction piped to claude via STDIN. Per-image Read directive
    loads each image before responding. When skill_names is non-empty, the trailer
    restricts the model to those Agent Skills (soft allowlist — the CLI has no hard
    per-skill flag). Both trailers forbid file writes (knowledge-only)."""
    parts = [prompt or ""]
    for p in image_paths:
        parts.append(f"\n\nRead and analyze the image at {p}.")
    if skill_names:
        names = ", ".join(skill_names)
        parts.append(f"\n\nUse only these Agent Skills if relevant: {names}. "
                     "Then respond with ONLY the result text. Do NOT write any files.")
    else:
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


def run(prompt: str, model_id: str, system_file: str | None,
        image_paths: list[str], run_fn=None,
        skills_enabled: bool = False, skill_names: list[str] | None = None,
        effort: str | None = None) -> dict:
    """Invoke claude once and return the AYCB node-shape dict. `system_file` is a
    path or None. `run_fn(cmd, stdin) -> (rc, stdout, stderr)` is injected in tests.
    skills_enabled widens the tool pool; skill_names soft-restricts which skills.
    effort forwards `--effort` to the CLI (low|medium|high|xhigh|max); None/auto
    omits the flag so the CLI default applies."""
    if run_fn is None:
        run_fn = _default_run
    cmd = build_command(real_model(model_id), system_file, len(image_paths), skills_enabled, effort)
    instruction = build_instruction(prompt, image_paths, skill_names)
    rc, stdout, stderr = run_fn(cmd, instruction)
    return parse_result(rc, stdout, stderr)
