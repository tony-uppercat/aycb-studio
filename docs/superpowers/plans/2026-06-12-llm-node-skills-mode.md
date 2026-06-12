# LLM Node Skills Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a knowledge-skills mode to the Claude-CLI LLM node, with a per-skill picker, so the user enables exactly which Agent Skills the node may use.

**Architecture:** A backend scanner lists skills `claude -p` can discover; a new plugin endpoint serves them; `claude_cli` widens its tool pool + injects the allowed skill names when skills mode is on; the node shows a toggle + checkbox picker (caveman pre-selected) and forwards the selection.

**Tech Stack:** Python (FastAPI, pytest), React 19 + TypeScript (Vitest), `claude` CLI headless `-p`.

---

## File Structure

- **NEW** `src/skill_scanner.py` — discover skills + parse SKILL.md frontmatter (`name`, `description`). Pure, path-injectable.
- **NEW** `src/plugins/skill_list.py` — `GET /api/llm/skills`, auto-discovered.
- **MOD** `src/claude_cli.py` — `skills_enabled` / `skill_names` through `build_command` / `build_instruction` / `run`.
- **MOD** `src/routers/llm.py` — endpoint Form fields + `_chat_claude_cli` plumbing.
- **MOD** `frontend/src/api.ts` — `get` accepts `signal`; `listSkills`; `llmChat` extra args.
- **NEW** `frontend/src/nodes/llm/SkillPicker.tsx` — checkbox list, abortable fetch.
- **MOD** `frontend/src/nodes/llm/LLMNode.tsx` — toggle + picker wiring.
- **NEW** `tests/test_skill_scanner.py`, **MOD** `tests/test_claude_cli.py`, **NEW** endpoint test, **NEW** `frontend/src/nodes/llm/SkillPicker.test.tsx`.

---

## Task 1: Skill scanner — frontmatter parser

**Files:**
- Create: `src/skill_scanner.py`
- Test: `tests/test_skill_scanner.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_skill_scanner.py
from pathlib import Path

from src import skill_scanner


def _write_skill(root: Path, folder: str, body: str) -> None:
    d = root / folder
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(body, encoding="utf-8")


def test_parse_frontmatter_inline():
    text = "---\nname: caveman\ndescription: Talk short.\n---\nBody here.\n"
    fm = skill_scanner._parse_frontmatter(text)
    assert fm["name"] == "caveman"
    assert fm["description"] == "Talk short."


def test_parse_frontmatter_folded_description():
    text = (
        "---\n"
        "name: react-patterns\n"
        "description: >\n"
        "  Comprehensive React 19 patterns covering\n"
        "  Server Components and Actions.\n"
        "---\n"
        "Body.\n"
    )
    fm = skill_scanner._parse_frontmatter(text)
    assert fm["name"] == "react-patterns"
    assert fm["description"] == "Comprehensive React 19 patterns covering Server Components and Actions."


def test_parse_frontmatter_no_fence_returns_empty():
    assert skill_scanner._parse_frontmatter("no frontmatter here") == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_skill_scanner.py -v`
Expected: FAIL with `AttributeError: module 'src.skill_scanner' has no attribute '_parse_frontmatter'` (or ModuleNotFound).

- [ ] **Step 3: Write minimal implementation**

```python
# src/skill_scanner.py
"""Discover Agent Skills that headless `claude -p` can auto-load, and read each
SKILL.md's frontmatter (name + description) for the LLM node's skill picker.

Only the paths `claude -p` actually reads are scanned, so every listed skill is
one the node can fire: plugin marketplaces, ~/.claude/skills, <cwd>/.claude/skills.
No PyYAML dependency — a tiny line parser handles the name/description we need.
"""
from __future__ import annotations

import re
from pathlib import Path

from src.shared import _log

_KEY = re.compile(r"^([A-Za-z_][\w-]*):(.*)$")
_FOLD = {">", "|", ">-", "|-", ">+", "|+"}


def _parse_frontmatter(text: str) -> dict:
    """Read the leading `---`-fenced YAML block, returning top-level scalar keys.
    Handles folded (`>`) / literal (`|`) multi-line values by joining their
    indented continuation lines with a single space. Quotes are stripped."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}

    data: dict = {}
    key: str | None = None
    buf: list[str] = []
    folded = False

    def flush() -> None:
        if key is not None:
            data[key] = " ".join(b for b in buf if b).strip().strip("\"'")

    for ln in lines[1:end]:
        m = _KEY.match(ln)
        if m and not ln.startswith((" ", "\t")):
            flush()
            key = m.group(1)
            val = m.group(2).strip()
            if val in _FOLD:
                folded, buf = True, []
            else:
                folded, buf = False, [val]
        elif key is not None and (folded or ln.startswith((" ", "\t"))):
            buf.append(ln.strip())
    flush()
    return data
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_skill_scanner.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/skill_scanner.py tests/test_skill_scanner.py
git commit -m "[feat] skill_scanner: SKILL.md frontmatter parser"
```

---

## Task 2: Skill scanner — scan + default paths

**Files:**
- Modify: `src/skill_scanner.py`
- Test: `tests/test_skill_scanner.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_skill_scanner.py
def test_scan_skills_lists_name_and_description(tmp_path):
    base = tmp_path / "skills"
    _write_skill(base, "caveman", "---\nname: caveman\ndescription: Talk short.\n---\n")
    _write_skill(base, "react", "---\nname: react-patterns\ndescription: React 19.\n---\n")
    out = skill_scanner.scan_skills([base])
    names = {s["name"] for s in out}
    assert names == {"caveman", "react-patterns"}
    cave = next(s for s in out if s["name"] == "caveman")
    assert cave["description"] == "Talk short."
    assert "source" in cave


def test_scan_skills_dedups_by_name(tmp_path):
    b1, b2 = tmp_path / "a", tmp_path / "b"
    _write_skill(b1, "caveman", "---\nname: caveman\ndescription: First.\n---\n")
    _write_skill(b2, "caveman2", "---\nname: caveman\ndescription: Second.\n---\n")
    out = skill_scanner.scan_skills([b1, b2])
    assert [s["name"] for s in out] == ["caveman"]
    assert out[0]["description"] == "First."  # first occurrence wins


def test_scan_skills_skips_missing_name(tmp_path):
    base = tmp_path / "skills"
    _write_skill(base, "bad", "---\ndescription: no name.\n---\n")
    assert skill_scanner.scan_skills([base]) == []


def test_scan_skills_ignores_nonexistent_path(tmp_path):
    assert skill_scanner.scan_skills([tmp_path / "nope"]) == []


def test_default_skill_paths_includes_user_and_cwd():
    paths = skill_scanner.default_skill_paths()
    strs = [str(p) for p in paths]
    assert any(p.endswith(".claude/skills") or p.endswith(".claude\\skills") for p in strs)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_skill_scanner.py -v`
Expected: FAIL with `AttributeError: ... has no attribute 'scan_skills'`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to src/skill_scanner.py
def scan_skills(base_paths: list[Path]) -> list[dict]:
    """Return [{name, description, source}] for every SKILL.md under each base
    (`<base>/*/SKILL.md`). Dedups by name (first wins). A base that does not
    exist is skipped; an unreadable/malformed SKILL.md is logged and skipped —
    never raised (rule 12)."""
    seen: set[str] = set()
    out: list[dict] = []
    for base in base_paths:
        if not base.exists():
            continue
        for skill_md in sorted(base.glob("*/SKILL.md")):
            try:
                text = skill_md.read_text(encoding="utf-8")
            except OSError as exc:
                _log(f"skill_scanner: cannot read {skill_md}: {exc}")
                continue
            fm = _parse_frontmatter(text)
            name = (fm.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            out.append({
                "name": name,
                "description": (fm.get("description") or "").strip(),
                "source": base.parent.name or str(base),
            })
    return out


def default_skill_paths() -> list[Path]:
    """The skill roots headless `claude -p` actually discovers: every plugin
    marketplace's `skills/` dir, the user skills dir, and the cwd project skills
    dir. cwd = backend process cwd = repo root."""
    home = Path.home()
    paths: list[Path] = []
    marketplaces = home / ".claude" / "plugins" / "marketplaces"
    if marketplaces.exists():
        paths.extend(sorted(marketplaces.glob("*/skills")))
    paths.append(home / ".claude" / "skills")
    paths.append(Path.cwd() / ".claude" / "skills")
    return paths
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_skill_scanner.py -v`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/skill_scanner.py tests/test_skill_scanner.py
git commit -m "[feat] skill_scanner: scan_skills + default_skill_paths"
```

---

## Task 3: Skill list endpoint plugin

**Files:**
- Create: `src/plugins/skill_list.py`
- Test: `tests/test_skill_list.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_skill_list.py
from fastapi.testclient import TestClient

from src.api import app
from src.plugins import skill_list


def test_get_skills_returns_list(monkeypatch):
    monkeypatch.setattr(
        skill_list, "_collect",
        lambda: [{"name": "caveman", "description": "Talk short.", "source": "caveman"}],
    )
    client = TestClient(app)
    r = client.get("/api/llm/skills")
    assert r.status_code == 200
    body = r.json()
    assert body["skills"][0]["name"] == "caveman"


def test_get_skills_error_is_surfaced(monkeypatch):
    def boom():
        raise RuntimeError("scan failed")
    monkeypatch.setattr(skill_list, "_collect", boom)
    client = TestClient(app)
    r = client.get("/api/llm/skills")
    assert r.status_code == 500
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_skill_list.py -v`
Expected: FAIL (404 — route not registered, or import error).

- [ ] **Step 3: Write minimal implementation**

```python
# src/plugins/skill_list.py
"""GET /api/llm/skills — list Agent Skills the Claude-CLI LLM node can fire.
Auto-discovered plugin router (rule 3). Thin wrapper over src.skill_scanner."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src import skill_scanner
from src.shared import _log

router = APIRouter(prefix="/api/llm", tags=["llm"])


def _collect() -> list[dict]:
    return skill_scanner.scan_skills(skill_scanner.default_skill_paths())


@router.get("/skills")
async def list_skills_endpoint():
    try:
        return {"skills": _collect()}
    except Exception as exc:  # surfaced, not swallowed (rule 12)
        _log(f"skill_list: scan failed — {exc}")
        raise HTTPException(500, detail=f"Skill scan failed: {exc}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_skill_list.py -v`
Expected: PASS (2 tests).

Note: confirm plugins are auto-discovered. If `src/plugins/` is loaded by package path, ensure `_collect` is patchable (it is — module-level function).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/skill_list.py tests/test_skill_list.py
git commit -m "[feat] GET /api/llm/skills — list discoverable skills"
```

---

## Task 4: claude_cli — skills_enabled tool pool + max-turns

**Files:**
- Modify: `src/claude_cli.py:31-55` (`build_command`)
- Test: `tests/test_claude_cli.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_claude_cli.py
def test_build_command_skills_enabled_widens_tools_and_turns():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0, skills_enabled=True)
    assert cmd[cmd.index("--tools") + 1] == "Skill Read Glob Grep WebSearch"
    assert cmd[cmd.index("--max-turns") + 1] == "8"


def test_build_command_skills_with_images_keeps_min_turns():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 6, skills_enabled=True)
    # max(8, n_images + 4) = max(8, 10) = 10
    assert cmd[cmd.index("--max-turns") + 1] == "10"


def test_build_command_skills_disabled_unchanged():
    cmd = claude_cli.build_command("claude-opus-4-8", None, 0, skills_enabled=False)
    assert cmd[cmd.index("--tools") + 1] == ""
    assert cmd[cmd.index("--max-turns") + 1] == "2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_claude_cli.py -k skills -v`
Expected: FAIL with `TypeError: build_command() got an unexpected keyword argument 'skills_enabled'`.

- [ ] **Step 3: Write minimal implementation**

Replace `build_command` body (`src/claude_cli.py`) with:

```python
def build_command(model: str, system_file: str | None, n_images: int,
                  skills_enabled: bool = False) -> list[str]:
    """`claude -p` invocation. JSON output so we can read usage + cost.

    Default (generation node): NO tools ('' / 'Read' for images), --max-turns
    scales with image count, so the model answers directly without wandering
    into tool calls or auto-firing skills.

    skills_enabled (knowledge-skills mode): the pool gains Skill + read-only
    helpers ('Skill Read Glob Grep WebSearch') so the model can discover and
    load Agent Skills, and --max-turns rises to leave room for skill load + a
    couple of reads + the final answer. Still NO Bash/Write/Edit — knowledge
    skills only, no shell, no file writes.

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
    if system_file:
        cmd += ["--append-system-prompt-file", system_file]
    return cmd
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_claude_cli.py -v`
Expected: PASS (all, including the 3 new + existing unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/claude_cli.py tests/test_claude_cli.py
git commit -m "[feat] claude_cli: skills_enabled tool pool + max-turns"
```

---

## Task 5: claude_cli — skill_names instruction trailer + run plumbing

**Files:**
- Modify: `src/claude_cli.py:58-65` (`build_instruction`), `:135-146` (`run`)
- Test: `tests/test_claude_cli.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_claude_cli.py
def test_build_instruction_with_skill_names_lists_them():
    instr = claude_cli.build_instruction("Hi", [], skill_names=["caveman", "react-patterns"])
    assert "Use only these Agent Skills if relevant: caveman, react-patterns." in instr
    assert "Do NOT write any files." in instr


def test_build_instruction_no_skill_names_unchanged():
    instr = claude_cli.build_instruction("Hi", [])
    assert "Respond with ONLY the result text. Do NOT write any files." in instr
    assert "Agent Skills" not in instr


def test_run_plumbs_skill_flags():
    captured = {}

    def fake_run(cmd, stdin):
        captured["cmd"] = cmd
        captured["stdin"] = stdin
        return 0, _ok_payload(), ""

    claude_cli.run("Hi", "cli-claude-opus-4-8", None, [],
                   run_fn=fake_run, skills_enabled=True, skill_names=["caveman"])
    assert captured["cmd"][captured["cmd"].index("--tools") + 1] == "Skill Read Glob Grep WebSearch"
    assert "caveman" in captured["stdin"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_claude_cli.py -k "skill" -v`
Expected: FAIL with `TypeError: build_instruction() got an unexpected keyword argument 'skill_names'`.

- [ ] **Step 3: Write minimal implementation**

Replace `build_instruction` and `run` in `src/claude_cli.py`:

```python
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
```

```python
def run(prompt: str, model_id: str, system_file: str | None,
        image_paths: list[str], run_fn=None,
        skills_enabled: bool = False, skill_names: list[str] | None = None) -> dict:
    """Invoke claude once and return the AYCB node-shape dict. `system_file` is a
    path or None. `run_fn(cmd, stdin) -> (rc, stdout, stderr)` is injected in tests.
    skills_enabled widens the tool pool; skill_names soft-restricts which skills."""
    if run_fn is None:
        run_fn = _default_run
    cmd = build_command(real_model(model_id), system_file, len(image_paths), skills_enabled)
    instruction = build_instruction(prompt, image_paths, skill_names)
    rc, stdout, stderr = run_fn(cmd, instruction)
    return parse_result(rc, stdout, stderr)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_claude_cli.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/claude_cli.py tests/test_claude_cli.py
git commit -m "[feat] claude_cli: skill_names allowlist trailer + run plumbing"
```

---

## Task 6: llm.py — endpoint Form fields + dispatch

**Files:**
- Modify: `src/routers/llm.py:23-40` (endpoint), `:105-151` (`_chat_claude_cli`)
- Test: `tests/test_llm_skills_dispatch.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_llm_skills_dispatch.py
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.api import app


def test_chat_forwards_skills_to_claude_cli():
    client = TestClient(app)
    captured = {}

    def fake_run(prompt, model_id, system_file, image_paths,
                 skills_enabled=False, skill_names=None):
        captured["skills_enabled"] = skills_enabled
        captured["skill_names"] = skill_names
        return {"text": "ok", "status": "OK",
                "usage": {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.0}}

    with patch("src.routers.llm.claude_cli.run", side_effect=fake_run):
        r = client.post("/api/llm/chat", data={
            "prompt": "hi", "model": "cli-claude-opus-4-8",
            "skills_mode": "true", "skills": "caveman, react-patterns",
        })
    assert r.status_code == 200
    assert captured["skills_enabled"] is True
    assert captured["skill_names"] == ["caveman", "react-patterns"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_llm_skills_dispatch.py -v`
Expected: FAIL (skills_enabled False / skill_names None — fields not wired).

- [ ] **Step 3: Write minimal implementation**

In `src/routers/llm.py`, update the endpoint signature + dispatch (lines 23-40):

```python
@router.post("/chat")
async def llm_chat_endpoint(
    prompt: str = Form(...),
    system_prompt: str = Form(""),
    api_key: str = Form(""),
    model: str = Form("Gemini 3 Flash"),
    skills_mode: bool = Form(False),
    skills: str = Form(""),
    media_files: list[UploadFile] | None = File(default=None),
):
    import time

    clean_prompt = _require_prompt(prompt)
    model_id = MODELS.get(model, model)

    if claude_cli.is_claude_cli_model(model_id):
        skill_names = [s.strip() for s in skills.split(",") if s.strip()]
        return await _chat_claude_cli(
            clean_prompt, system_prompt, model_id, media_files,
            time.time(), skills_mode, skill_names,
        )
    if _is_claude_model(model_id):
        return await _chat_claude(clean_prompt, system_prompt, api_key, model_id, media_files, time.time())
    return await _chat_gemini(clean_prompt, system_prompt, api_key, model_id, media_files, time.time())
```

Update `_chat_claude_cli` signature (line 105) and the `claude_cli.run` call (line 136-138):

```python
async def _chat_claude_cli(
    prompt: str, system_prompt: str, model_id: str,
    media_files: list[UploadFile] | None, t0: float,
    skills_mode: bool = False, skill_names: list[str] | None = None,
):
```

```python
            result = await asyncio.to_thread(
                claude_cli.run, prompt, model_id, system_file, image_paths,
                None, skills_mode, skill_names,
            )
```

(`None` is the `run_fn` positional arg; `skills_mode` -> `skills_enabled`, `skill_names` -> `skill_names`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_llm_skills_dispatch.py tests/test_claude_cli.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routers/llm.py tests/test_llm_skills_dispatch.py
git commit -m "[feat] llm chat: forward skills_mode + skills to claude_cli"
```

---

## Task 7: api.ts — abortable get, listSkills, llmChat args

**Files:**
- Modify: `frontend/src/api.ts:77-78` (`get`), `:264-286` (`llmChat`), add `listSkills`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api.skills.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './api'

describe('api.listSkills', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ skills: [{ name: 'caveman', description: 'd', source: 's' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
  })
  it('fetches the skills list', async () => {
    const r = await api.listSkills()
    expect(r.skills[0].name).toBe('caveman')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api.skills.test.ts`
Expected: FAIL (`api.listSkills is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api.ts`, make `get` accept an optional signal:

```typescript
const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  request<T>(path, 'GET', signal ? { signal } : undefined)
```

Add a `listSkills` method and extend `llmChat` (inside the `api` object). `listSkills`:

```typescript
  listSkills(signal?: AbortSignal): Promise<{ skills: { name: string; description: string; source: string }[] }> {
    return get('/llm/skills', signal)
  },
```

Replace `llmChat` signature + body tail:

```typescript
  llmChat(prompt: string, model: string, apiKey: string, mediaFiles?: File[], systemPrompt?: string, skillsMode?: boolean, skills?: string[]): Promise<{ text: string; status: string; usage?: UsageInfo }> {
    // Route Ollama models directly to client-side provider (no backend proxy needed)
    if (model.startsWith('ollama/')) {
      const llm = getLLMProvider('ollama')
      if (!llm) throw new Error('Ollama provider not available')
      return llm.chat(prompt, model, apiKey, mediaFiles)
    }
    // Local-CLI Claude models run a backend subprocess — never reroute to the cloud fallback
    if (model.startsWith('cli-claude-')) {
      if (!isBackendAvailable()) throw new Error('Claude (Local CLI) requires the local backend to be running')
    } else if (!isBackendAvailable()) {
      const llm = getLLMProvider('gemini')
      if (!llm) throw new Error('Cloud mode: Gemini LLM provider not available')
      return llm.chat(prompt, model, apiKey, mediaFiles)
    }
    const fd = new FormData()
    fd.append('prompt', prompt)
    fd.append('model', model)
    fd.append('api_key', apiKey)
    if (systemPrompt) fd.append('system_prompt', systemPrompt)
    if (skillsMode) {
      fd.append('skills_mode', 'true')
      if (skills && skills.length) fd.append('skills', skills.join(','))
    }
    mediaFiles?.forEach(f => fd.append('media_files', f))
    return post('/llm/chat', fd)
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api.skills.test.ts && npx tsc --noEmit`
Expected: PASS + clean tsc.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.skills.test.ts
git commit -m "[feat] api: listSkills + abortable get + llmChat skills args"
```

---

## Task 8: SkillPicker component

**Files:**
- Create: `frontend/src/nodes/llm/SkillPicker.tsx`
- Test: `frontend/src/nodes/llm/SkillPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/nodes/llm/SkillPicker.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SkillPicker } from './SkillPicker'
import { api } from '../../api'

describe('SkillPicker', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listSkills').mockResolvedValue({
      skills: [
        { name: 'caveman', description: 'Talk short.', source: 'caveman' },
        { name: 'react-patterns', description: 'React 19.', source: 'sp' },
      ],
    })
  })

  it('renders fetched skills and toggles selection', async () => {
    const onChange = vi.fn()
    render(<SkillPicker value={['caveman']} onChange={onChange} />)
    await waitFor(() => screen.getByText('react-patterns'))
    fireEvent.click(screen.getByLabelText('react-patterns'))
    expect(onChange).toHaveBeenCalledWith(['caveman', 'react-patterns'])
  })

  it('unchecks a selected skill', async () => {
    const onChange = vi.fn()
    render(<SkillPicker value={['caveman']} onChange={onChange} />)
    await waitFor(() => screen.getByLabelText('caveman'))
    fireEvent.click(screen.getByLabelText('caveman'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/nodes/llm/SkillPicker.test.tsx`
Expected: FAIL (`Cannot find module './SkillPicker'`).

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/nodes/llm/SkillPicker.tsx
import { useEffect, useState } from 'react'
import { api } from '../../api'

interface SkillInfo { name: string; description: string; source: string }

interface Props {
  value: string[]
  onChange: (next: string[]) => void
}

/** Checkbox list of Agent Skills the Claude-CLI LLM node can fire. Fetches the
 *  discoverable set once on mount (abortable). Knowledge-skills only — the
 *  backend pool excludes Bash/Write. */
export function SkillPicker({ value, onChange }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    api.listSkills(ctrl.signal)
      .then(r => setSkills(r.skills))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load skills')
      })
    return () => ctrl.abort()
  }, [])

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter(n => n !== name) : [...value, name])
  }

  if (error) return <div style={{ fontSize: 10, opacity: 0.6 }}>Skills unavailable: {error}</div>
  if (!skills.length) return <div style={{ fontSize: 10, opacity: 0.6 }}>No skills found</div>

  return (
    <div className="nodrag nowheel" style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
      {skills.map(s => (
        <label key={s.name} title={s.description} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label={s.name}
            checked={value.includes(s.name)}
            onChange={() => toggle(s.name)}
          />
          <span>{s.name}</span>
        </label>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/nodes/llm/SkillPicker.test.tsx && npx tsc --noEmit`
Expected: PASS + clean tsc.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/llm/SkillPicker.tsx frontend/src/nodes/llm/SkillPicker.test.tsx
git commit -m "[feat] SkillPicker: checkbox list of discoverable skills"
```

---

## Task 9: LLMNode — toggle + picker wiring

**Files:**
- Modify: `frontend/src/nodes/llm/LLMNode.tsx` (state ~56-77, toggles row ~206-231, llmChat call ~127, import)

- [ ] **Step 1: Add state + import (no test-first; UI wiring verified by build + existing LLMNode tests)**

At top imports (after line 5):

```typescript
import { SkillPicker } from './SkillPicker'
```

Add state alongside the other `useState`s (after `prependMode`, ~line 77):

```typescript
  const [skillsMode, setSkillsMode] = useState(
    typeof data.skillsMode === 'boolean' ? data.skillsMode : false
  )
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    Array.isArray(data.selectedSkills) ? data.selectedSkills as string[] : []
  )
```

- [ ] **Step 2: Wire the toggle + picker into the toggles row**

`isClaudeCli` derived value (near `isThinkingModel`, ~line 89):

```typescript
  const isClaudeCli = modelInfo.api === 'claude-cli'
```

In the toggles row (`<div className={styles.row}>`, after the prepend button, before `</div>` at ~line 231) add:

```tsx
          {isClaudeCli && (
            <button
              className={`${styles.subtleToggle} ${skillsMode ? styles.subtleToggleOn : ''}`}
              onClick={() => {
                const next = !skillsMode
                const seeded = next && selectedSkills.length === 0 ? ['caveman'] : selectedSkills
                setSkillsMode(next)
                if (seeded !== selectedSkills) setSelectedSkills(seeded)
                updateNodeData(id, { skillsMode: next, selectedSkills: seeded })
              }}
              title={skillsMode ? 'Skills ON' : 'Skills OFF'}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h13a3 3 0 0 1 3 3v13l-3-2-3 2-3-2-3 2-3-2V4zm3 4h9v2H7V8zm0 4h7v2H7v-2z"/></svg>
            </button>
          )}
```

After the toggles row `</div>` (before the system-prompt textarea, ~line 232) add:

```tsx
        {isClaudeCli && skillsMode && (
          <SkillPicker
            value={selectedSkills}
            onChange={next => {
              setSelectedSkills(next)
              updateNodeData(id, { selectedSkills: next })
            }}
          />
        )}
```

- [ ] **Step 3: Pass selection into the llmChat call**

Replace the `api.llmChat(...)` call (~line 127):

```typescript
      const r = await api.llmChat(
        prompt, modelInfo.id, effectiveKey,
        files.length ? files : undefined, systemPrompt,
        isClaudeCli && skillsMode,
        isClaudeCli && skillsMode ? selectedSkills : undefined,
      )
```

Add `skillsMode`, `selectedSkills`, `isClaudeCli` to the `useCallback` dependency array (~line 154).

- [ ] **Step 4: Verify build + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/nodes/llm`
Expected: clean tsc + PASS (existing LLMNode tests + SkillPicker).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/llm/LLMNode.tsx
git commit -m "[feat] LLMNode: Skills toggle + picker for Local CLI models"
```

---

## Task 10: Full suite + live smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Run full backend + frontend suites**

Run: `python -m pytest` then `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all green (backend was 318, +new; frontend 431, +new).

- [ ] **Step 2: Live — endpoint lists caveman**

Start backend (`python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload`), then:

Run: `curl -s http://localhost:5101/api/llm/skills | python -m json.tool`
Expected: JSON `{"skills": [...]}` containing an entry with `"name": "caveman"`.

- [ ] **Step 3: Live — caveman fires through the node**

Run:
```bash
curl -s -X POST http://localhost:5101/api/llm/chat \
  -F "prompt=Explain what database indexing is." \
  -F "model=cli-claude-opus-4-8" \
  -F "skills_mode=true" \
  -F "skills=caveman"
```
Expected: HTTP 200, `text` in caveman style (terse, dropped articles) — proves the skill loaded via the node under subscription auth, no API key.

If it instead returns `error_max_turns`: raise the skills-mode `--max-turns` floor (Task 4) and re-test. If caveman is absent from `/api/llm/skills`: the node's `claude -p` is not discovering plugin skills — check it runs without `--bare` and inherits `~/.claude` (do NOT add `--bare`).

- [ ] **Step 4: Commit (if any tuning applied)**

```bash
git add -A
git commit -m "[test] skills mode: live smoke verification + turn-floor tuning"
```

---

## Self-Review Notes

- **Spec coverage:** scanner (T1-2) · endpoint (T3) · tool pool + turns (T4) · allowlist trailer + run (T5) · endpoint plumbing (T6) · api client (T7) · picker (T8) · node toggle + caveman seed (T9) · live caveman verify (T10). All spec sections mapped.
- **Type consistency:** `skills_enabled`/`skill_names` (Python) and `skillsMode`/`selectedSkills`/`skills` (TS) used identically across tasks. `scan_skills` returns `{name, description, source}` consumed unchanged by endpoint + `SkillPicker`/`listSkills`.
- **Knowledge-only invariant:** tool pool never includes Bash/Write/Edit; both instruction trailers keep "Do NOT write any files".
- **File-size:** picker UI lives in `SkillPicker.tsx`; endpoint in its own plugin — `LLMNode.tsx` and `llm.py` stay under 300.
