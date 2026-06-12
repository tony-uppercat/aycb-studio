# LLM Node — Skills Mode (knowledge skills, per-skill picker)

Date: 2026-06-12
Status: Design — approved shape, pending spec review
Follows: `2026-06-12-claude-cli-llm-node-design.md` (basic Claude-CLI path shipped `fc97f3d`)

## Goal

Let the Claude-CLI LLM node (`cli-claude-*` models) deliberately use **Agent
Skills** to process inputs, with the user choosing **which** skills are allowed
per node. Scope is intentionally narrow: **knowledge skills only** — skills that
inject expertise and answer in text. No shell, no file writes.

The node is an in-workflow text processor for AYCB creative work, not an
AYCB-builder agent.

## Decisions (locked)

- **Tool pool when ON:** `Skill Read Glob Grep WebSearch`. No `Bash`/`Write`/
  `Edit`. A picked skill that wants shell/write silently cannot act — accepted,
  this is the knowledge-only guarantee.
- **Per-skill picker:** the user ticks which discovered skills are allowed. The
  CLI has no hard per-skill allowlist flag, so enforcement is **soft** — the
  selected names are injected into the instruction ("Use only these Agent
  Skills: …"). `Skill` tool is in the pool; the model picks among the allowed.
- **Default on first enable:** `caveman` pre-selected. User can untick / add.
- **Repo `skills/aycb-*` deferred:** they are action skills (need Write/Bash) and
  live in `skills/`, outside a `claude -p` discovery path. Not in scope.
- **caveman install:** already present as a user-level plugin
  (`~/.claude/plugins/marketplaces/caveman/skills/`). A fresh `claude -p` spawned
  by the node inherits the same `~/.claude` config and is launched **without**
  `--bare`, so caveman is discoverable already. Confirm with a live smoke test
  during implementation; no install step expected. Repo-copy for cross-machine
  portability is out of scope.

## Skill discovery (what the node's `claude -p` actually reads)

`claude -p` (no `--bare`) auto-discovers skills from:
- plugin marketplaces — `~/.claude/plugins/marketplaces/*/skills/*/SKILL.md`
  (caveman, superpowers, …)
- user skills — `~/.claude/skills/*/SKILL.md`
- project skills — `<cwd>/.claude/skills/*/SKILL.md` (cwd = backend process cwd =
  repo root; currently empty)

The picker must offer **only** skills from these paths, so a ticked skill is
always one the node can actually fire.

## Architecture

### Backend

**NEW `src/skill_scanner.py`** (~80 lines)
- `scan_skills(base_paths: list[Path]) -> list[dict]` → `[{name, description,
  source}]`.
- For each base path, glob `*/SKILL.md`, read frontmatter, extract `name` and
  `description` (handle YAML folded `>` scalars — simple line parser, no PyYAML
  dependency required; if PyYAML already a backend dep, may use it).
- Dedup by `name` (first occurrence wins). Skip files with no `name`. Never
  raise on a malformed SKILL.md — log and skip (rule 12: no `except: pass`).
- `default_skill_paths() -> list[Path]` builds the three discovery roots from
  `Path.home()` and the cwd. Kept separate so tests inject fake roots.

**NEW `src/plugins/skill_list.py`** (~30 lines) — auto-discovered (rule 3)
- `GET /api/llm/skills` → `{skills: [{name, description, source}]}`.
- Calls `scan_skills(default_skill_paths())`. Errors → 500 with logged detail.

**MOD `src/claude_cli.py`**
- `build_command(model, system_file, n_images, skills_enabled=False)`:
  - `skills_enabled` → `--tools "Skill Read Glob Grep WebSearch"`,
    `--max-turns max(8, n_images + 4)`.
  - else → unchanged (`--tools ""|Read`, `--max-turns max(2, n_images+2)`).
- `build_instruction(prompt, image_paths, skill_names=None)`:
  - `skill_names` non-empty → trailer: `"\n\nUse only these Agent Skills if
    relevant: {', '.join(names)}. Then respond with ONLY the result text. Do NOT
    write any files."`
  - else → unchanged trailer.
- `run(prompt, model_id, system_file, image_paths, run_fn=None,
  skills_enabled=False, skill_names=None)` plumbs both through.

**MOD `src/routers/llm.py`**
- Endpoint: add `skills_mode: bool = Form(False)`, `skills: str = Form("")`
  (comma-separated skill names).
- `_chat_claude_cli(...)` gains `skills_mode`, `skill_names: list[str]`; passes
  `skills_enabled=skills_mode, skill_names=...` into `claude_cli.run`.
- Parse `skills` → `[s.strip() for s in skills.split(",") if s.strip()]`.

### Frontend

**MOD `frontend/src/api.ts`**
- `get<T>` helper: add optional `signal?: AbortSignal` param (forwarded to
  fetch) so the picker fetch is abortable (rule 6).
- `listSkills(signal?) -> Promise<{skills: {name,description,source}[]}>` →
  `GET /llm/skills`.
- `llmChat(..., skillsMode?: boolean, skills?: string[])`: when `skillsMode`
  append `skills_mode=true` and `skills=<comma names>`.

**NEW `frontend/src/nodes/llm/SkillPicker.tsx`** (~90 lines)
- Props: `value: string[]`, `onChange(next: string[])`.
- Fetches `listSkills()` on mount with `AbortController`; cleanup aborts.
- Renders a compact checkbox list (name + truncated description tooltip).
- No backend → empty list + small "backend required" note (mirrors node guard).
- Keeps `LLMNode.tsx` under the 300-line limit.

**MOD `frontend/src/nodes/llm/LLMNode.tsx`**
- `skillsMode` + `selectedSkills` state, persisted via `updateNodeData`.
- Skills toggle (`subtleToggle`, Lucide-style glyph, title `Skills ON/OFF`) shown
  only when `modelInfo.api === 'claude-cli'`.
- On first enable, if `selectedSkills` empty → seed `['caveman']`.
- When ON → render `<SkillPicker value={selectedSkills} onChange={…} />`.
- Pass `skillsMode` + `selectedSkills` into `api.llmChat(...)`.

## Data flow

1. User selects a `(Local CLI)` model → Skills toggle appears.
2. Toggle ON → SkillPicker fetches `GET /api/llm/skills`, shows discovered
   skills, caveman pre-ticked.
3. Run → `POST /api/llm/chat` with `skills_mode=true`, `skills=caveman,…`.
4. `_chat_claude_cli` → `claude_cli.run(skills_enabled=true,
   skill_names=[...])` → `claude -p --tools "Skill Read Glob Grep WebSearch"
   --max-turns 8 …` with instruction listing allowed skills.
5. Model loads relevant skill(s), answers in text. JSON envelope parsed as today.

## Error handling

- Scanner: malformed/missing SKILL.md → log + skip, never raise.
- Endpoint: scan failure → 500 logged (not silent).
- CLI: existing `parse_result` already surfaces `error_max_turns` etc.; higher
  `--max-turns` (8) gives room for Skill load + Grep + answer.
- Frontend fetch: AbortController on unmount; backend-down → empty list + note.

## Testing (TDD, failure paths included — rule 8, feedback_test_failure_paths)

- **`tests/test_skill_scanner.py`** — fake SKILL.md dirs: parses name+description,
  handles folded `>` scalars, dedups by name across roots, skips file with no
  `name`, skips malformed YAML without raising, empty when no roots exist.
- **`tests/test_claude_cli.py`** (extend) — `skills_enabled` sets the exact tool
  string + `max-turns 8`; OFF unchanged; `build_instruction` allowlist trailer
  with/without names; `run` plumbs both flags to `run_fn`.
- **Endpoint test** (httpx) — `GET /api/llm/skills` returns list shape;
  monkeypatch scanner to fixed list.
- **`SkillPicker.test.tsx`** — renders fetched skills, toggles selection, aborts
  on unmount; backend-down path shows note.
- **LLMNode** — toggle visible only for `claude-cli`; seeds caveman on enable.

## Live verification (manual, during impl)

- `GET /api/llm/skills` via curl → caveman present in list.
- Node run with Skills ON + caveman → output in caveman style (proves the skill
  fired through the node, subscription auth, no API key).

## Out of scope

- Repo `skills/aycb-*` discovery (action skills; deferred).
- Action skills / Bash / Write from the node.
- Force-one `/skill-name` mode (soft allowlist chosen instead).
- Streaming, session resume, MCP tools beyond Read (tracked elsewhere).

## File-size guardrails

- `LLMNode.tsx` 263 → keep <300 by moving picker UI to `SkillPicker.tsx`.
- `llm.py` 225 → new endpoint goes to `src/plugins/skill_list.py`, not here.
- `claude_cli.py` 147 → ~+25 lines, well under 300.
