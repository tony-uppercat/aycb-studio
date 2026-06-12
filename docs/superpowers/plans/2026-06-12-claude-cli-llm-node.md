# Claude CLI in LLM Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Claude via local CLI" path to the AYCB LLM node — picking a `(Local CLI)` Claude model shells out to the installed `claude` binary (subscription auth, no API key, cost read from its JSON output).

**Architecture:** New backend module `src/claude_cli.py` owns command-building, the STDIN-piped invocation (injectable `run_fn` seam), and JSON→node-shape parsing. `src/routers/llm.py` gains a dispatch branch `_chat_claude_cli` that writes uploaded media to a temp dir, calls the module via `asyncio.to_thread`, and returns the existing node shape. Frontend `LLMNode.tsx` adds 3 `cli-claude-*` models + a "Claude (Local CLI)" optgroup; `api.ts` guards that these require the backend.

**Tech Stack:** Python 3 / FastAPI / pytest (backend); React 19 / TypeScript / Vitest (frontend); `claude` CLI in headless `-p --output-format json` mode.

**Reference:** `C:\Users\upper\Documents\00_pao_batch\PAO-Pipeline\engine\producers\claude_cli.py` and `engine/jobs._win_exec`.

**Spec:** `docs/superpowers/specs/2026-06-12-claude-cli-llm-node-design.md`

**Routing convention:** CLI model ids are prefixed `cli-claude-…` (e.g. `cli-claude-opus-4-8`). They do NOT match the existing `startswith("claude-")` API check, so the Anthropic-API path is untouched. The module strips `cli-` → real `--model`.

**Verified JSON shape** (empirical, 2026-06-12): `claude -p --output-format json` emits one object `{"is_error":false,"result":"...","total_cost_usd":0.24,"usage":{"input_tokens":2,"output_tokens":4,...}}`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/claude_cli.py` | Command build, STDIN invocation seam, JSON→node-shape parse. ~100 lines. |
| Create | `tests/test_claude_cli.py` | Unit tests (fake `run_fn`) + one route-dispatch test. |
| Modify | `src/routers/llm.py` | Add `_chat_claude_cli` handler + dispatch branch. |
| Modify | `frontend/src/nodes/llm/LLMNode.tsx` | 3 `cli-claude-*` models, optgroup, `effectiveKey`. |
| Modify | `frontend/src/api.ts` | Guard: `cli-claude-*` requires backend. |

---

## Task 1: Backend module `src/claude_cli.py` (TDD)

**Files:**
- Create: `src/claude_cli.py`
- Test: `tests/test_claude_cli.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_claude_cli.py`:

```python
import json

from src import claude_cli


def _ok_payload(result="OK", cost=0.02, inp=3, out=4):
    return json.dumps({
        "type": "result", "subtype": "success", "is_error": False,
        "result": result, "total_cost_usd": cost,
        "usage": {"input_tokens": inp, "output_tokens": out},
    })


def test_is_claude_cli_model():
    assert claude_cli.is_claude_cli_model("cli-claude-opus-4-8")
    assert not claude_cli.is_claude_cli_model("claude-opus-4-6-20250620")
    assert not claude_cli.is_claude_cli_model("gemini-3-flash-preview")


def test_real_model_strips_prefix():
    assert claude_cli.real_model("cli-claude-opus-4-8") == "claude-opus-4-8"
    assert claude_cli.real_model("claude-opus-4-6") == "claude-opus-4-6"


def test_build_command_basics():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0)
    assert cmd[:2] == ["claude", "-p"]
    assert "--output-format" in cmd and "json" in cmd
    assert cmd[cmd.index("--model") + 1] == "claude-opus-4-8"
    assert cmd[cmd.index("--permission-mode") + 1] == "bypassPermissions"
    assert "--bare" not in cmd
    assert cmd[cmd.index("--max-turns") + 1] == "2"


def test_build_command_system_appended():
    cmd = claude_cli.build_command("claude-opus-4-8", "Be terse", 0)
    assert cmd[cmd.index("--append-system-prompt") + 1] == "Be terse"


def test_build_command_no_system_omits_flag():
    assert "--append-system-prompt" not in claude_cli.build_command("claude-opus-4-8", None, 0)


def test_max_turns_scales_with_images():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 3)
    assert cmd[cmd.index("--max-turns") + 1] == "5"  # 3 images + 2


def test_build_instruction_print_only_trailer():
    instr = claude_cli.build_instruction("Summarize", [])
    assert "Summarize" in instr
    assert "Do NOT write any files" in instr


def test_build_instruction_reads_each_image():
    instr = claude_cli.build_instruction("Describe", ["/tmp/a.png", "/tmp/b.png"])
    assert "Read and analyze the image at /tmp/a.png" in instr
    assert "Read and analyze the image at /tmp/b.png" in instr


def test_run_instruction_via_stdin_not_argv():
    captured = {}
    def fake(cmd, stdin):
        captured["cmd"], captured["stdin"] = cmd, stdin
        return (0, _ok_payload())
    claude_cli.run("my long prompt", "cli-claude-opus-4-8", None, [], run_fn=fake)
    assert "my long prompt" in captured["stdin"]
    assert "my long prompt" not in " ".join(captured["cmd"])


def test_run_parses_ok_result():
    r = claude_cli.run("hi", "cli-claude-sonnet-4-6", None, [],
                       run_fn=lambda cmd, stdin: (0, _ok_payload("hello", 0.02, 3, 4)))
    assert r["status"] == "OK"
    assert r["text"] == "hello"
    assert r["usage"] == {"input_tokens": 3, "output_tokens": 4, "cost_usd": 0.02}


def test_run_nonzero_rc_is_error():
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (1, ""))
    assert r["status"] == "ERROR"
    assert r["text"] == ""


def test_run_is_error_true():
    payload = json.dumps({"is_error": True, "subtype": "error_max_turns", "result": "", "usage": {}})
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (0, payload))
    assert r["status"] == "ERROR"


def test_run_empty_result_is_error():
    payload = json.dumps({"is_error": False, "result": "  ", "total_cost_usd": 0, "usage": {}})
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (0, payload))
    assert r["status"] == "ERROR"


def test_run_non_json_is_error():
    r = claude_cli.run("hi", "cli-claude-opus-4-8", None, [], run_fn=lambda cmd, stdin: (0, "boom"))
    assert r["status"] == "ERROR"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_claude_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.claude_cli'` (or AttributeError).

- [ ] **Step 3: Write `src/claude_cli.py`**

```python
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
    subscription/OAuth session)."""
    max_turns = max(2, n_images + 2)
    cmd = ["claude", "-p", "--output-format", "json",
           "--max-turns", str(max_turns),
           "--model", model,
           "--permission-mode", "bypassPermissions"]
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


def _default_run(cmd: list[str], stdin: str) -> tuple[int, str]:
    """Production seam: resolve the shim on Windows, run with the instruction piped to
    STDIN, capture stdout. Returns (returncode, stdout_str)."""
    if sys.platform == "win32":
        cmd = _win_exec(cmd)
    proc = subprocess.run(cmd, input=stdin, capture_output=True, text=True,
                          encoding="utf-8", timeout=_TIMEOUT)
    return proc.returncode, (proc.stdout or "")


def parse_result(rc: int, stdout: str) -> dict:
    """Map claude's JSON result envelope to the AYCB node shape
    {text, status, usage{input_tokens, output_tokens, cost_usd}}. A non-zero rc, invalid
    JSON, is_error, or empty result => status 'ERROR' (with an `error` message)."""
    err = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    if rc != 0:
        return {"text": "", "status": "ERROR", "error": f"claude exited {rc}", "usage": err}
    try:
        obj = json.loads(stdout)
    except (ValueError, TypeError):
        return {"text": "", "status": "ERROR", "error": "claude returned non-JSON output", "usage": err}
    if obj.get("is_error") or not (obj.get("result") or "").strip():
        msg = obj.get("subtype") or obj.get("result") or "claude reported an error"
        return {"text": "", "status": "ERROR", "error": msg, "usage": err}
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


def run(prompt: str, model_id: str, system: str | None,
        image_paths: list[str], run_fn=None) -> dict:
    """Invoke claude once for a prompt (+ optional images already on disk) and return the
    AYCB node-shape dict. `run_fn(cmd, stdin) -> (rc, stdout)` is injected in tests so no
    real claude is spawned."""
    if run_fn is None:
        run_fn = _default_run
    cmd = build_command(real_model(model_id), (system or "").strip() or None, len(image_paths))
    instruction = build_instruction(prompt, image_paths)
    rc, stdout = run_fn(cmd, instruction)
    return parse_result(rc, stdout)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_claude_cli.py -v`
Expected: PASS (14 tests).

---

## Task 2: Wire dispatch into `src/routers/llm.py` (TDD)

**Files:**
- Modify: `src/routers/llm.py` (imports L8-13, endpoint L22-37; add handler after `_chat_claude` ~L100)
- Test: `tests/test_claude_cli.py` (append route test)

- [ ] **Step 1: Write the failing route test**

Append to `tests/test_claude_cli.py`:

```python
def test_route_dispatches_to_cli(monkeypatch):
    from fastapi.testclient import TestClient
    from src.api import app
    import src.routers.llm as llm

    captured = {}
    def fake_run(prompt, model_id, system, image_paths, run_fn=None):
        captured["model_id"] = model_id
        captured["prompt"] = prompt
        captured["images"] = image_paths
        return {"text": "hi", "status": "OK",
                "usage": {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.0}}

    monkeypatch.setattr(llm.claude_cli, "run", fake_run)
    client = TestClient(app)
    r = client.post("/api/llm/chat", data={"prompt": "yo", "model": "cli-claude-opus-4-8"})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "hi"
    assert body["status"] == "OK"
    assert captured["model_id"] == "cli-claude-opus-4-8"
    assert captured["prompt"] == "yo"
    assert captured["images"] == []


def test_route_cli_error_returns_422(monkeypatch):
    from fastapi.testclient import TestClient
    from src.api import app
    import src.routers.llm as llm

    def fake_run(prompt, model_id, system, image_paths, run_fn=None):
        return {"text": "", "status": "ERROR", "error": "claude exited 1",
                "usage": {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}}

    monkeypatch.setattr(llm.claude_cli, "run", fake_run)
    client = TestClient(app)
    r = client.post("/api/llm/chat", data={"prompt": "yo", "model": "cli-claude-opus-4-8"})
    assert r.status_code == 422
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_claude_cli.py::test_route_dispatches_to_cli -v`
Expected: FAIL — `AttributeError: module 'src.routers.llm' has no attribute 'claude_cli'` (CLI model falls through to `_chat_gemini`).

- [ ] **Step 3: Add the import**

In `src/routers/llm.py`, extend the `src.shared` import block (L8-13) by adding a module import directly below it:

```python
from src.shared import (
    _log, _read_upload,
    _require_key, _require_prompt,
    _estimate_cost, _classify_error,
    MODELS, MAX_IMAGE_BYTES,
)
from src import claude_cli
```

- [ ] **Step 4: Add the dispatch branch**

In `llm_chat_endpoint` (L35-37), add the CLI check **before** the existing claude/gemini branches:

```python
    if claude_cli.is_claude_cli_model(model_id):
        return await _chat_claude_cli(clean_prompt, system_prompt, model_id, media_files, time.time())
    if _is_claude_model(model_id):
        return await _chat_claude(clean_prompt, system_prompt, api_key, model_id, media_files, time.time())
    return await _chat_gemini(clean_prompt, system_prompt, api_key, model_id, media_files, time.time())
```

- [ ] **Step 5: Add the handler**

Insert after `_chat_claude` ends (after L99, before `_chat_gemini`):

```python
async def _chat_claude_cli(
    prompt: str, system_prompt: str, model_id: str,
    media_files: list[UploadFile] | None, t0: float,
):
    """Handle Claude via the local `claude` CLI — subscription auth, no API key. Uploaded
    media are written to a temp dir so claude can Read them; the dir is removed after."""
    import time
    import tempfile
    from pathlib import Path

    media_count = len(media_files) if media_files else 0
    _log(f"LLM chat (Claude CLI) — model={model_id}, {media_count} media, prompt={prompt[:80]}...")

    try:
        with tempfile.TemporaryDirectory(prefix="aycb_claude_") as tmp:
            image_paths: list[str] = []
            if media_files:
                for i, f in enumerate(media_files):
                    raw = await _read_upload(f, MAX_IMAGE_BYTES, "Media")
                    name = f.filename or ""
                    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
                    p = Path(tmp) / f"media_{i}.{ext}"
                    p.write_bytes(raw)
                    image_paths.append(str(p))
            result = await asyncio.to_thread(
                claude_cli.run, prompt, model_id, system_prompt, image_paths
            )
        dt = time.time() - t0
        if result.get("status") != "OK":
            _log(f"LLM chat (Claude CLI) FAILED — {result.get('error')} ({dt:.1f}s)")
            raise HTTPException(422, detail=result.get("error") or "Claude CLI failed")
        _log(f"LLM chat (Claude CLI) complete — {len(result['text'])} chars ({dt:.1f}s)")
        return {"text": result["text"], "status": "OK", "usage": result["usage"]}
    except HTTPException:
        raise
    except Exception as exc:
        dt = time.time() - t0
        _log(f"LLM chat (Claude CLI) FAILED — {exc} ({dt:.1f}s)")
        code, detail = _classify_error(exc)
        raise HTTPException(code, detail=detail)
```

Note: 422 (not 502) for CLI failures — frontend masks 502 as "backend down" (project rule).

- [ ] **Step 6: Run the full backend test file**

Run: `python -m pytest tests/test_claude_cli.py -v`
Expected: PASS (16 tests).

- [ ] **Step 7: Confirm no regression in the LLM suite**

Run: `python -m pytest -q`
Expected: full suite green (99+ tests). Confirm `src/routers/llm.py` is still under 300 lines (`wc -l src/routers/llm.py` → ~215).

---

## Task 3: Frontend — models, optgroup, key, backend guard

**Files:**
- Modify: `frontend/src/nodes/llm/LLMNode.tsx` (L18-27 array, L120 effectiveKey, L178-181 groups)
- Modify: `frontend/src/api.ts` (L264-283 `llmChat`)

- [ ] **Step 1: Add the 3 CLI models**

In `LLMNode.tsx`, inside `LLM_MODELS` (after L26, before the closing `] as const`), add:

```tsx
  { id: 'cli-claude-opus-4-8', name: 'Opus 4.8 (Local CLI)', api: 'claude-cli', tooltip: 'Runs via the local claude CLI — subscription auth, no API key', price: 'sub', cost: 0, deprecated: false },
  { id: 'cli-claude-opus-4-6', name: 'Opus 4.6 (Local CLI)', api: 'claude-cli', tooltip: 'Runs via the local claude CLI — subscription auth, no API key', price: 'sub', cost: 0, deprecated: false },
  { id: 'cli-claude-sonnet-4-6', name: 'Sonnet 4.6 (Local CLI)', api: 'claude-cli', tooltip: 'Runs via the local claude CLI — subscription auth, no API key', price: 'sub', cost: 0, deprecated: false },
```

- [ ] **Step 2: Add the optgroup**

In the dropdown groups array (L178-181), add a third entry after the Anthropic line:

```tsx
          {[
            { label: 'Gemini (Google)', items: LLM_MODELS.filter(m => m.api === 'gemini') },
            { label: 'Claude (Anthropic)', items: LLM_MODELS.filter(m => m.api === 'anthropic') },
            { label: 'Claude (Local CLI)', items: LLM_MODELS.filter(m => m.api === 'claude-cli') },
          ].map(g => (
```

- [ ] **Step 3: No key for the CLI path**

Replace the `effectiveKey` line (L120) inside `run`:

```tsx
      const effectiveKey =
        modelInfo.api === 'anthropic' ? (anthropicKey || '')
        : modelInfo.api === 'claude-cli' ? ''
        : (apiKey || '')
```

- [ ] **Step 4: Guard the backend requirement in `api.ts`**

In `llmChat` (`frontend/src/api.ts`), add a guard immediately after the Ollama block (after L270, before the `if (!isBackendAvailable())` cloud fallback):

```tsx
    if (model.startsWith('cli-claude-')) {
      if (!isBackendAvailable()) throw new Error('Claude (Local CLI) requires the local backend to be running')
      // fall through to the FormData backend POST below
    }
```

This stops a `cli-claude-*` model from being silently rerouted to the Gemini cloud-fallback provider.

- [ ] **Step 5: Typecheck + frontend tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: tsc clean (the `api` union now includes `'claude-cli'`); existing vitest suite (115 tests) still green.

---

## Task 4: Empirical end-to-end verification + commit

**Files:** none (verification), then one feature commit.

- [ ] **Step 1: Live CLI smoke (real binary, text-only)**

Run:
```bash
echo "reply with just the word PONG" | claude -p --output-format json --max-turns 2 --model claude-opus-4-8 --permission-mode bypassPermissions
```
Expected: JSON with `"is_error":false` and `"result":"PONG"`. Confirms the exact flags the module emits work against the installed binary for the newest model id.

- [ ] **Step 2: Start backend + frontend, manual node smoke**

Backend: `python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload`
Frontend: `cd frontend && npm run dev`
In the graph: add an LLM node → pick **Opus 4.8 (Local CLI)** → prompt "Say hi in 3 words" → Run.
Expected: output populates; cost chip shows the `total_cost_usd` value; no API-key error. (Visual check — Antonio.)

- [ ] **Step 3: Verify the full test matrix once more**

Run: `python -m pytest -q` and `cd frontend && npx vitest run`
Expected: both green. Record counts.

- [ ] **Step 4: Commit the feature (single commit — project no-micro-commit rule)**

```bash
git add src/claude_cli.py tests/test_claude_cli.py src/routers/llm.py \
        frontend/src/nodes/llm/LLMNode.tsx frontend/src/api.ts \
        docs/superpowers/specs/2026-06-12-claude-cli-llm-node-design.md \
        docs/superpowers/plans/2026-06-12-claude-cli-llm-node.md
git commit -m "$(cat <<'EOF'
[feat] Claude via local CLI in LLM node — subscription auth, no API key

New cli-claude-* models route to a `claude -p --output-format json` subprocess
(src/claude_cli.py) instead of the Anthropic SDK. Text + image input (media
written to a temp dir, claude Reads them), usage/cost parsed from the CLI JSON.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec coverage:** routing prefix (T1 `is_claude_cli_model`/`real_model`), module command/instruction/parse (T1), temp-dir image write (T2 handler), dispatch order (T2), JSON usage→cost mapping (T1 `parse_result`), frontend models+optgroup+key (T3), backend guard (T3 api.ts), tests incl. failure paths (T1/T2), empirical JSON verify (T4). All spec sections mapped.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `run(prompt, model_id, system, image_paths, run_fn=None)` signature identical across module def (T1), unit tests (T1), route fake (T2). Return keys `text`/`status`/`usage{input_tokens,output_tokens,cost_usd}` identical to the existing `_chat_claude` shape. Frontend `api: 'claude-cli'` used consistently in array, optgroup filter, and `effectiveKey`.
