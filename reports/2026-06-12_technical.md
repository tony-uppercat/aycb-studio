# AYCB v2 — Technical Report 2026-06-12

## Summary

Ported a Claude-via-local-CLI path into the LLM node (subscription auth, no
API key), referencing PAO-Pipeline's `engine/producers/claude_cli.py`. Then
root-caused and fixed two failures Antonio hit live. All work committed on
`dev-full`. Working tree clean.

Commits this session:
- `fc97f3d` [feat] Claude via local CLI in LLM node
- `2fb60c7` [fix] restrict tools + surface real error
- `932a58a` [fix] pass system prompt as file, not argv

## Architecture

`cli-claude-*` model ids (e.g. `cli-claude-opus-4-8`) route to a new module
`src/claude_cli.py` that invokes:

```
claude -p --output-format json --max-turns {max(2,n_img+2)} --model {real}
       --permission-mode bypassPermissions --tools {""|Read}
       [--append-system-prompt-file {path}]
```

- Prompt piped via STDIN; system prompt via a temp **file**. Both kept off
  argv (Windows ~8191-char limit).
- `--tools ""` (text) / `--tools Read` (images): generation node, not an agent
  — prevents tool wandering + skill auto-fire.
- `parse_result` parses claude's JSON envelope even on rc≠0 (claude prints
  `is_error`/`subtype`/`errors` on stdout AND exits 1), surfacing the real
  reason. stderr captured as fallback when no JSON.
- Network seam `run_fn(cmd, stdin) -> (rc, stdout, stderr)` injectable; tests
  never spawn real claude.
- `_is_claude_cli_model` (`startswith "cli-claude-"`) checked before
  `_is_claude_model` (`startswith "claude-"`) → Anthropic-API path untouched.
- `_chat_claude_cli` in `src/routers/llm.py` writes uploads + `system.txt` to a
  `TemporaryDirectory`, calls the module via `asyncio.to_thread`. No
  `_require_key` (subscription auth). Errors → HTTP 422 (not 502).

## Files Changed

- Created: `src/claude_cli.py` (139 lines)
- Created: `tests/test_claude_cli.py` (19 tests)
- Modified: `src/routers/llm.py` (dispatch + `_chat_claude_cli`, now ~230 lines)
- Modified: `frontend/src/nodes/llm/LLMNode.tsx` (3 models, optgroup, key)
- Modified: `frontend/src/api.ts` (backend-required guard for `cli-claude-*`)
- Docs: `docs/superpowers/specs/2026-06-12-claude-cli-llm-node-design.md`,
  `docs/superpowers/plans/2026-06-12-claude-cli-llm-node.md`

## Tests

- Backend: 318 passing (incl. 19 new in `test_claude_cli.py`).
- Frontend: 431 passing; `tsc --noEmit` clean.
- Live backend verification (curl/requests against :5101):
  - text → OK; image (red/blue PNG) → correct color; opus-4-8 → OK
  - tool-inducing prompt → HTTP 422 `Claude CLI error_max_turns: Reached
    maximum number of turns (2)` (was opaque "claude exited 1")
  - 16k-char system prompt → HTTP 200, system honored ("Paris")

## Known Issues

- Cost reported per call includes the CLI's own system-prompt/cache overhead
  (e.g. ~$0.09–0.22 for trivial prompts). It is the subscription-equivalent
  figure from `total_cost_usd`, not a metered charge.
- A user prompt that explicitly demands tool use still fails with
  `error_max_turns` (by design — tools are disabled). Now reported clearly.

## Next Tasks

1. Visual confirmation in the graph (Antonio) — real prompt + system prompt +
   image on a `(Local CLI)` model.
2. Optional: node param to enable agentic mode (raise `--max-turns`, drop the
   print-only trailer, widen `--tools`) for deliberate tool/skill use. Design
   noted in `project_llm_node_claude_cli` memory.
3. Deferred: session resume (`--session-id`), streaming, MCP tools beyond Read.
