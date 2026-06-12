# Claude CLI provider in the AYCB LLM node

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Reference:** `C:\Users\upper\Documents\00_pao_batch\PAO-Pipeline\engine\producers\claude_cli.py`

## Goal

Add a **Claude via local CLI** path to the AYCB LLM node. When a user picks a
`(Local CLI)` Claude model, the backend shells out to the installed `claude`
binary in headless print mode (`claude -p`) using the logged-in subscription —
**no Anthropic API key, $0 metered API cost**. This is distinct from the
existing Anthropic-**API** path (`_chat_claude`, SDK + key), which stays
untouched.

## Why

- PAO-Pipeline already runs Claude this way (subscription auth, deterministic
  batch). AYCB only has the API-key path.
- Lets the user drive Claude from the node graph without burning API credits.

## Verified facts (do not re-derive)

- `claude -p --output-format json ...` returns a single JSON object. Confirmed
  empirically 2026-06-12 against the installed binary:
  ```json
  {"type":"result","subtype":"success","is_error":false,
   "result":"OK","total_cost_usd":0.24117,"num_turns":1,
   "session_id":"...","usage":{"input_tokens":2,"output_tokens":4, ...}}
  ```
  Map: `text = result`, `cost_usd = total_cost_usd`,
  `input_tokens = usage.input_tokens`, `output_tokens = usage.output_tokens`,
  fail when `is_error == true` OR rc != 0 OR empty `result`.
- AYCB backend route: `src/routers/llm.py` `POST /api/llm/chat`, dispatches by
  `model_id`: `_is_claude_model()` (`startswith("claude-")`) → `_chat_claude`
  (Anthropic SDK), else `_chat_gemini`.
- Existing claude-API return shape: `{"text", "status": "OK", "usage": {input_tokens, output_tokens, cost_usd}}`. The CLI path returns the SAME shape.
- Frontend `LLMNode.tsx`: hardcoded `LLM_MODELS` array (~L18-27) + hardcoded
  optgroup dropdown (~L170-195), each model tagged `api: 'gemini'|'anthropic'|'ollama'`. `effectiveKey` (~L120) picks the key by `api`.
- `frontend/src/api.ts` `llmChat()`: ollama intercepted client-side
  (`startsWith('ollama/')`); a cloud fallback uses the gemini provider when the
  backend is unavailable; everything else POSTs `/llm/chat` as FormData.
- Key resolution: `_require_key(api_key, provider)` in `src/shared.py`. **CLI
  path never calls it** (subscription auth).

## Design

### Routing signal

CLI model ids are prefixed `cli-claude-…`:

| Dropdown label        | Frontend model id        | `--model` passed to claude |
|-----------------------|--------------------------|----------------------------|
| Opus 4.8 (Local CLI)  | `cli-claude-opus-4-8`    | `claude-opus-4-8`          |
| Opus 4.6 (Local CLI)  | `cli-claude-opus-4-6`    | `claude-opus-4-6`          |
| Sonnet 4.6 (Local CLI)| `cli-claude-sonnet-4-6`  | `claude-sonnet-4-6`        |

Backend checks `_is_claude_cli_model(model_id)` (`startswith("cli-claude-")`)
**before** `_is_claude_model()`, so the API path is unaffected. Handler strips
the `cli-` prefix to get the real model id.

### New module `src/claude_cli.py`

Placed outside the auto-discovered `routers/`/`plugins/` dirs so it is imported,
not mounted as a router. Mirrors PAO's producer. Max 300 lines.

- `build_command(model, system, n_images) -> list[str]`
  ```
  claude -p --output-format json
         --max-turns {max(2, n_images + 2)}
         --model {model}
         --permission-mode bypassPermissions
         [--append-system-prompt {system}]   # only if system non-empty
  ```
  `--max-turns` scales with image count: each `Read` of an image consumes one
  agentic turn, plus one for the final response. `--bare` intentionally omitted
  (it forces `ANTHROPIC_API_KEY`-only auth, breaking subscription/OAuth).
- `build_instruction(prompt, image_paths) -> str` — prompt, then
  `Read and analyze the image at {abs_path}` per image, then a print-only
  trailer (`Respond with ONLY the result text. Do NOT write any files.`).
  Piped via **STDIN, not argv** (Windows ~8191-char command-line limit).
- `_win_exec(cmd)` — resolve the npm shim (`claude.cmd` / `.ps1`) via
  `shutil.which` and wrap through `cmd /c` or `powershell -File`. Copied from
  PAO `engine/jobs._win_exec`.
- `run(prompt, model, system, image_paths, run_fn=None) -> dict` — single
  network seam `run_fn(cmd, stdin) -> (returncode, stdout_str)`; defaults to a
  production `_default_run` (resolves `_win_exec`, `subprocess.run`, STDIN pipe,
  600s timeout). Parses JSON, returns
  `{"text", "status": "OK"|"ERROR", "usage": {input_tokens, output_tokens, cost_usd}}`.
  Tests inject a fake `run_fn` — **no real claude spawned in tests**.

### `src/routers/llm.py` changes (thin)

- `_is_claude_cli_model(model_id)` helper.
- `_chat_claude_cli(prompt, system_prompt, model_id, media_files, t0)`:
  1. Write each `media_files` upload to a `tempfile.TemporaryDirectory`.
  2. Strip `cli-` → real model.
  3. `await asyncio.to_thread(claude_cli.run, ...)`.
  4. Return the module's dict (already in node shape). Temp dir auto-cleaned.
  - No `_require_key` call.
- Route branch ordered before the existing claude/gemini branches.
- If `llm.py` would exceed 300 lines, move the handler body into
  `src/claude_cli.py` and keep only the dispatch line in `llm.py`.

### Frontend changes

- `LLMNode.tsx`: 3 new `LLM_MODELS` entries `{ id, name, api: 'claude-cli' }`;
  new `<optgroup label="Claude (Local CLI)">`. `effectiveKey`: for
  `api === 'claude-cli'` pass `''` (no key needed).
- `api.ts` `llmChat()`: claude-cli requires the backend (subprocess). Add a
  guard so the "backend unavailable → gemini" fallback does **not** hijack a
  `cli-claude-*` model — surface a clear error instead.
- **No** `MODEL_PRICING` entry (cost comes from the JSON `total_cost_usd`).

## Testing (TDD — write tests first)

`tests/test_claude_cli.py` (backend, fake `run_fn`):
- command construction: flags, model, `--append-system-prompt` only when system
  present, `--max-turns` = `n_images + 2`.
- instruction built from STDIN (prompt + per-image Read lines + print-only
  trailer); never passed as argv.
- JSON parse → node shape; cost/usage mapping from `total_cost_usd` + `usage`.
- failure paths: `is_error: true`, rc != 0, empty `result` → status ERROR, no
  text leak.
- temp-dir image write + cleanup.

Frontend (`LLMNode.test.tsx` if present): renders the new optgroup + 3 models.

Run after every change: `cd frontend && npx vitest run` and `python -m pytest`.

## Files

| Action | Path |
|--------|------|
| NEW    | `src/claude_cli.py` |
| NEW    | `tests/test_claude_cli.py` |
| MODIFY | `src/routers/llm.py` |
| MODIFY | `frontend/src/nodes/llm/LLMNode.tsx` |
| MODIFY | `frontend/src/api.ts` |

## Out of scope (v1)

- Session resume / multi-turn chat (`--session-id`).
- MCP tool use beyond the built-in `Read` for images.
- Streaming output.
