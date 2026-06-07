# Graph-to-CLI: design spec

**Date:** 2026-05-19
**Author:** Antonio + Claude
**Status:** Design approved, ready for implementation plan
**Canvas reference:** `proj-1779207005835-ik3jy4` (PAO_reframe, 51 nodes, 64 edges)

## Goal

Define a reusable workflow that converts any AYCB canvas into a batch-executable CLI run, leveraging the Gemini Batch API for 50% cost reduction on LLM + image generation calls.

The user designs interactively in AYCB, then with one click ("Send to CLI") materializes a self-contained batch folder on disk where input slots are file-system folders. Dropping N files into an input slot produces N runs of the full canvas, submitted as Batch API jobs.

## Non-goals

- Replace the AYCB canvas as a design tool — the canvas remains source of truth, the CLI is for production batching only.
- Support arbitrary external APIs — Gemini Batch API only (LLM + image gen).
- Real-time progress UI in AYCB — terminal output is enough.
- Migrate existing one-off scripts under `scripts/` — those stay as-is.

## User workflow (happy path)

1. User designs a canvas in AYCB and iterates until satisfied.
2. User right-clicks the project in `ProjectGallery` (or selects from `ProjectSwitcher` header dropdown) → **Send to CLI** → modal asks for `batch_name` (default = canvas name).
3. Backend bootstraps `scripts/batches/<batch_name>/` with `canvas.json`, auto-discovered `batch.toml`, copied refs, empty input slot folders. Frontend toast offers "Open folder".
4. User edits `batch.toml` if needed (rename slots, drop unwanted inputs), drops N files into `inputs/$<slot>/`.
5. User runs `python scripts/run_canvas_batch.py scripts/batches/<batch_name>`.
6. CLI submits Gemini Batch jobs, polls every 30s, writes `.batch_state/` for crash recovery, downloads results to `outputs/run_<ts>/` with manifest files.
7. User inspects `manifest.json` for totals + per-run details.

If user closes the terminal: relaunch the same command and polling resumes from `.batch_state/`.

## Architecture

```
┌─────────────────┐                          ┌──────────────────┐
│ AYCB Frontend   │  click "Send to CLI"     │ AYCB Backend     │
│ ProjectGallery  │  ─────────────────────►  │ POST /api/cli/   │
│ ProjectSwitcher │  {project_id, name?,     │ bootstrap        │
│                 │   update?}               │                  │
└─────────────────┘                          └────────┬─────────┘
                                                      │ load canvas
                                                      │ topo-sort DAG
                                                      │ auto-discover I/O
                                                      │ materialize folder
                                                      ▼
                                       ┌──────────────────────────┐
                                       │ scripts/batches/<name>/  │
                                       │ ├── canvas.json          │
                                       │ ├── batch.toml           │
                                       │ ├── inputs/$slot/        │
                                       │ ├── refs/                │
                                       │ ├── outputs/             │
                                       │ ├── .cache/              │
                                       │ └── .batch_state/        │
                                       └──────────────┬───────────┘
                                                      │
                                                      │  python scripts/
                                                      │  run_canvas_batch.py <folder>
                                                      ▼
                                       ┌──────────────────────────┐
                                       │ CLI runner               │
                                       │ - parse + topo sort      │
                                       │ - BFS execution by level │
                                       │ - Gemini Batch API       │
                                       │   (50% off, async poll)  │
                                       │ - key-based dispatch     │
                                       │ - crash recovery         │
                                       │ - cache by content hash  │
                                       │ - manifest.json          │
                                       └──────────────────────────┘
```

## Folder structure (per batch)

```
scripts/batches/<batch_name>/
├── canvas.json                  Snapshot of the canvas at bootstrap (or last --update)
├── batch.toml                   I/O slot mapping + run config (see below)
├── inputs/
│   ├── $input1/                 One folder per CLI input slot, name = slot key
│   │   ├── img_001.png          N files = N runs of the full graph
│   │   ├── img_002.png
│   │   └── img_003.png
│   └── $base/                   Other input slots (any number)
│       └── placeholder.png
├── refs/                        Constant ref images, materialized from canvas mediaIds
│   ├── ref_1.jpg
│   ├── ref_2.jpg
│   └── ref_3.jpg
├── outputs/
│   └── run_20260519_182230/     One folder per CLI invocation, timestamped
│       ├── @final_swA_img_001.png    PNG with prompt in tEXt chunk (as today)
│       ├── @final_swA_img_002.png
│       ├── @final_swB_relighted_img_001.png
│       ├── manifest_img_001.json     Per-run detail (outputs + intermediates)
│       ├── manifest_img_002.json
│       ├── manifest.json             Rollup: totals + index → manifest_*.json
│       └── batch.log                 Stdout of the run
├── .cache/                      Content-addressed node output cache
│   ├── <sha256>.json
│   └── <sha256>.png
└── .batch_state/                Live Batch API job state for crash recovery
    └── <google_job_id>.json
```

## Canvas conventions (auto-discovery)

The runner auto-discovers I/O without requiring canvas modifications:

- **Input candidates**: `imageUpload` nodes with no `image-in` edge — these will be filled from a CLI slot folder.
- **Output candidates**: `generateImage` nodes whose `image-out` edge does not feed another `generateImage` or `llm` node (i.e., DAG leaves).
- **Passthrough**: `imageUpload` with an `image-in` edge is treated as a copy node, not a CLI input.
- **UI-only**: `imageCompare` is always skipped by the CLI.

The bootstrap writes all candidates into `batch.toml`; the user can delete entries to demote them to canvas constants, or rename slots.

## batch.toml schema

```toml
# Auto-discovered from canvas. Delete sections you want kept as canvas constants.
# Rename slot keys to give them friendly names — these become folder names under inputs/.

[inputs.input1]
node_id = "imageUpload-94b90f4d"
note    = "BASE placeholder image — main variable input"

# Refs (delete these sections to keep them as canvas constants instead of CLI inputs)
[inputs.ref1]
node_id = "imageUpload-cda9d505"
[inputs.ref2]
node_id = "imageUpload-930b1343"

[outputs.final_swA]
node_id = "generateImage-2ba27644"
[outputs.final_swB_relighted]
node_id = "generateImage-ab9fe79d"

[batch]
fanout_slot = "input1"           # N files in inputs/$input1/ = N runs
sync_mode = false                # true forces sync (no Batch, no discount, faster)
poll_interval_s = 30
poll_timeout_min = 1440          # 24h hard ceiling
model_overrides = {}             # { "generateImage-682bd6a4" = "gemini-3.1-flash-image-preview" }
```

## Bootstrap endpoint

`POST /api/cli/bootstrap`

**Request:**
```json
{ "project_id": "proj-1779207005835-ik3jy4", "batch_name": "PAO_reframe", "update": false }
```

**Behavior:**
1. Load canvas from AYCB project store.
2. Topologically sort the DAG. If cycles detected: return 422 with the cycle path.
3. Auto-discover input/output candidates per the rules above.
4. Materialize `scripts/batches/<batch_name>/`:
   - Write `canvas.json` (snapshot).
   - Write `batch.toml` with auto-discovered sections and inline comments.
   - Create empty `inputs/$<slot>/` folders for every discovered input.
   - Copy referenced media from `shared/Media/` into `refs/`, naming by `mediaId` lookup.
   - Create empty `outputs/`, `.cache/`, `.batch_state/`.
5. If folder exists and `update=true`: read existing `batch.toml`, preserve user-renamed slot keys for unchanged node_ids, append `# ADDED` / `# REMOVED` inline comments for delta, rewrite `canvas.json`. Never delete user inputs in `inputs/$<slot>/`.
6. If folder exists and `update=false`: return 409 with existing `batch_path`.

**Response:**
```json
{
  "batch_path": "scripts/batches/PAO_reframe",
  "inputs_discovered": 5,
  "outputs_discovered": 3,
  "refs_copied": 4,
  "warnings": ["node imageUpload-x has no mediaId — skipped from refs"]
}
```

## Frontend integration

- **ProjectGallery tile**: add `Send to CLI` to the existing context menu.
- **ProjectSwitcher**: add `Send to CLI` to the dropdown menu (next to Rename, Duplicate, Delete).
- Both call `POST /api/cli/bootstrap`. Modal asks for `batch_name` (defaults to project name slug).
- Success toast: "Batch ready at `<path>`. <button>Open folder</button>". Clicking calls `POST /api/cli/open-folder` which uses `os.startfile()` on Windows / `xdg-open` on Linux.
- If 409 conflict: toast offers `Update existing` (calls bootstrap with `update=true`) or `Open existing`.

## CLI runner

**Entry point:** `python scripts/run_canvas_batch.py <batch_folder> [--sync] [--no-cache] [--dry-run]`

**Execution model: BFS by level with cross-run batching.**

1. **Parse**: load `canvas.json` + `batch.toml`, validate, build node graph in memory.
2. **Build run set**: scan `inputs/$<fanout_slot>/` → derive `runs = { stem: scope_dict, ... }`. Each scope is seeded with `inputs.<slot>.path` for every declared input.
3. **Topological levels**: compute BFS levels of the DAG (source nodes at level 0).
4. **Level execution**:
   - For each node at the current level:
     - If batchable (`llm`, `generateImage`) and not `--sync`: collect all N requests across runs, submit one Batch API job, persist `.batch_state/<job_id>.json` before polling, wait until terminal state, dispatch results back into per-run scope by `key`.
     - If batchable and `--sync`: parallel `asyncio.gather()` of N sync calls, full price, lower latency.
     - If local (`textInput`, `jsonParser`, `bracketParser`, `imageUpload`): plain Python loop over runs.
     - Skip `imageCompare` unconditionally.
   - Cache layer: before executing any node for a run, compute `cache_key = sha256(canvas.nodes[node_id].data || hash(input_files))`. If hit: load from `.cache/`, skip execution. (Disable with `--no-cache`.)
5. **Write outputs**: after the last level, for each run write `outputs/run_<ts>/@<output_slot>_<stem>.png` (PNG tEXt = prompt) and `manifest_<stem>.json`. After all runs done, write `manifest.json` rollup.

### Key-based dispatch (input correctness guarantee)

**Plain explanation:** each input file's stem (`img_001`) is used as the Batch API request `key`. The key travels inside every request line in the JSONL upload and Google returns it on every response line. The runner uses the key to write results into the correct per-run scope dict. Sequential nodes downstream read from that same scope by key, so a node N+1 processing `img_001` always reads N's output for `img_001`. No index mixing, no scope leak.

**Test obligation:** the implementation MUST include a unit test with a 3-run mini-canvas `[input → llm "echo: <input>"] → [llm "uppercase: <input>"]` over distinct inputs `hello`/`world`/`foo`, asserting outputs `HELLO`/`WORLD`/`FOO` (not all-equal, not shuffled).

## Node executors

| Type | Behavior |
|---|---|
| `textInput` | Constant from `data.text`. If has `text-in` edge AND `autoUpdate=true`: substitute from upstream text via bracket templating. Pure Python, no API. |
| `imageUpload` | If `node_id` declared as `inputs.<slot>` in batch.toml → read `inputs/$<slot>/<stem>.<ext>` for the current run. If has `image-in` edge → take from upstream scope. Else → constant from `refs/<ref_name>.<ext>`. |
| `llm` | Build payload from system_prompt (from edge or constant) + prompt (from edge or constant) + media[] (from upstream edges). Model from `data.selectedModel` unless overridden in `batch.model_overrides`. **Batchable.** |
| `generateImage` | Build payload from prompt (from edge) + refs (from edges, prepared via `prepare_ref` from `aycb-cli-generation` skill). Model from `data.selectedModel`. Honors `aspectRatio`, `resolution`. Omit `thinkingConfig` for Pro Image and for Flash ≥2K (per skill memory). **Batchable.** |
| `jsonParser` | Parse upstream JSON text, apply `excludedKeys` / `flatten` / `overrides`. Build output pins. Pure Python. |
| `bracketParser` | Template substitution `{var}` or `[var]` using `overrides` and pin inputs. Pure Python. |
| `imageCompare` | SKIP. CLI is non-interactive. |

## Gemini Batch API integration

Reuses `src/batch_gen/provider.py` (already implemented):
- `build_jsonl_lines(requests)` — generate JSONL per request type
- `GeminiBatchProvider.submit()` — upload JSONL, create job, return `job.name`
- `GeminiBatchProvider.get_state()` — poll one job
- `GeminiBatchProvider.download_results()` — parse result JSONL, write PNGs with metadata, return `BatchResult[]`
- `BATCH_DISCOUNT = 0.5` applied to all cost calculations

**Extension required for `llm` nodes**: current `BatchRequest` is image-gen oriented. Add a `BatchTextRequest` variant or extend `BatchRequest` to handle pure-text LLM responses (no image extraction, just `candidates[0].content.parts[0].text`). The job submission path is identical (same `batches.create`); only response parsing differs.

## Crash recovery

For every Batch API job submitted, immediately persist `.batch_state/<google_job_id>.json`:

```json
{
  "job_name": "batches/abc123",
  "node_id": "llm-3759faa4",
  "level": 4,
  "submitted_at": "2026-05-19T18:22:30Z",
  "key_to_run_stem": { "img_001": "img_001", "img_002": "img_002" },
  "node_type": "llm",
  "request_payload_sha256": "..."
}
```

On runner restart:
1. Scan `.batch_state/` for pending jobs.
2. For each: resume polling via `get_state()`. Do not resubmit.
3. On terminal state: distribute results via key, delete state file, continue execution.

Stale state (>48h, beyond Batch API expiry) → log warning, mark dependent runs as failed in manifest.

## Cache strategy

Content-addressed cache, opt-out only.

- Cache key per node per run: `sha256( canonical_json(canvas.nodes[node_id].data) + ":" + sha256(input_files_concatenated) )` where `canonical_json` is `json.dumps(data, sort_keys=True, separators=(",", ":"))`.
- Cache lookup before any API call. Hit → load cached output, skip execution, skip billing.
- Cache invalidation: implicit. Change a prompt in the canvas → `canvas.json` changes → cache key changes → downstream re-executes. Upstream untouched nodes keep cache hits.
- Disable: `--no-cache` forces full re-execution and overwrites cache.

## Error handling

| Failure | Behavior |
|---|---|
| Single Batch item error (e.g., 1/50 returns no inline image) | `manifest_<stem>.json` has `status=failed` + `error` message. Other items proceed. Rollup reflects in `totals.failed`. |
| Whole-job FAILED / EXPIRED | Runner stops with exit != 0. `.batch_state/` preserved. Partial results written. Manifest marks affected runs as failed. |
| Transient 5xx / 429 on submit or poll | Retry with backoff 5s + 15s (max 3 attempts). |
| Cycle detected in DAG | Exit early with cycle path. Bootstrap also blocks this. |
| Missing input file for declared slot | Exit early listing missing files. |
| `fanout_slot` undeclared or empty folder | Exit early with message "no input files found in inputs/$<fanout_slot>/". |
| Unknown node type | Exit early naming the node. Future node types require an executor stub. |

Never `except: pass`. Every caught exception logs via `_log()` with node_id and run stem.

## Manifest format

### Per-run `manifest_<stem>.json`

```json
{
  "stem": "img_001",
  "status": "succeeded",
  "started_at": "2026-05-19T18:22:30Z",
  "completed_at": "2026-05-19T18:30:14Z",
  "inputs": {
    "input1": "inputs/$input1/img_001.png",
    "ref1": "refs/ref_1.jpg"
  },
  "outputs": {
    "final_swA": {
      "path": "@final_swA_img_001.png",
      "node_id": "generateImage-2ba27644",
      "model": "gemini-3-pro-image-preview",
      "aspect_ratio": "3:4",
      "resolution": "2K",
      "prompt": "Render a continuation frame ...",
      "cost_usd": 0.067,
      "duration_s": 142.3
    }
  },
  "intermediates": {
    "llm-88b3d9fb": {
      "node_type": "llm",
      "model": "gemini-3.1-pro-preview",
      "output_text": "{ \"products\": { \"product_01\": \"replace ...\" } }",
      "tokens_in": 1234,
      "tokens_out": 567,
      "cost_usd": 0.012
    },
    "jsonParser-b238c2d0": {
      "pins": ["text-0", "text-1", "text-2", "text-3", "text-4", "text-5", "text-6"]
    }
  }
}
```

### Rollup `manifest.json`

```json
{
  "batch_name": "PAO_reframe",
  "canvas_id": "proj-1779207005835-ik3jy4",
  "started_at": "2026-05-19T18:22:30Z",
  "completed_at": "2026-05-19T18:34:55Z",
  "totals": {
    "items": 50,
    "succeeded": 48,
    "failed": 2,
    "cost_usd": 5.43,
    "discount": 0.5,
    "duration_min": 12.4
  },
  "runs": [
    { "stem": "img_001", "status": "succeeded", "manifest": "manifest_img_001.json" },
    { "stem": "img_002", "status": "failed", "manifest": "manifest_img_002.json", "error": "no_inline_image" }
  ]
}
```

## Sync mode (`--sync` fallback)

For interactive iteration on small batches (1-3 inputs), Batch API's 5-30 min latency hurts. `--sync` switches to:
- Direct REST calls (per `aycb-cli-generation` skill) — no JSONL upload, no Batch polling.
- `asyncio.gather()` parallelism across runs within rate limits.
- Full price (no discount), but result in seconds.

All other behavior (folder structure, scope dispatch, manifest writing, cache) identical.

## Testing

### Unit tests
- `test_dag_parser.py` — load canvas.json variants, topo sort, cycle detection, level grouping.
- `test_node_executors.py` — each node type executed in isolation with fixture inputs.
- `test_batch_packer.py` — N runs → JSONL with N items, keys match stems, model selection respects overrides.
- `test_key_dispatch.py` — **the input-correctness smoke test from the design** (3-run echo+uppercase mini-canvas).
- `test_cache.py` — cache hit/miss, invalidation by canvas edit.
- `test_crash_recovery.py` — kill runner mid-poll, restart, resume from `.batch_state/`.

### Integration tests
- `test_cli_bootstrap.py` — POST /api/cli/bootstrap creates correct folder structure for a fixture canvas.
- `test_cli_runner_e2e_sync.py` — full end-to-end with `--sync`, mocked Gemini client, asserts outputs and manifests.
- `test_cli_runner_e2e_batch.py` — same with Batch API mocked, asserts `.batch_state/` lifecycle.

### Smoke test (manual)
- `scripts/smoke_canvas_batch.py` — drops 2 placeholders into the PAO_reframe batch folder, runs the full pipeline in `--sync`, verifies `@final_swA_*.png` exist and have prompts in tEXt.

## Out of scope (future work)

- **Mid-batch canvas edits**: today, editing the canvas while a Batch job is in flight is undefined behavior. Future: detect canvas.json drift and warn.
- **Multi-canvas batches**: chaining the output of one batch as input to another. Could be done with a `batches.toml` orchestrator on top.
- **Non-Gemini providers**: Flux, Atlas, PiAPI, Veo. The CLI runner is provider-agnostic in principle but only the Gemini path is implemented.
- **Web UI for batch monitoring**: terminal output is sufficient for v1.
- **Cross-platform `open folder`**: Windows-only via `os.startfile()` for v1; macOS/Linux added if needed.
- **Batch resume after canvas edit**: if canvas changes between bootstrap and run, the cache invalidates downstream but `.batch_state/` jobs already submitted are kept (they reflect the old canvas). Future: lock canvas hash into `.batch_state/`.

## Open questions

None at design time. All decisions captured above.

## References

- Canvas backup: `shared/data/canvas_backups/proj-1779207005835-ik3jy4/canvas_20260519_162506.json`
- Existing batch infra: `src/batch_gen/` (provider, store, poller, models)
- CLI conventions: `skills/aycb-cli-generation/SKILL.md`
- Existing smoke pattern: `scripts/smoke_batch_node.py`, `scripts/batch_brush_refsheet_async.py`
