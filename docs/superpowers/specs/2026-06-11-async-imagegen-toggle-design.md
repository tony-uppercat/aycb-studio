# Async Image Generation Toggle — Design

Date: 2026-06-11
Status: approved (Antonio, chat 2026-06-11)

## Goal

Per-node "Async" toggle on the Generate Image node that routes generation
through the provider's Batch API at 50% cost. `run()` awaits the result, so
cascade runs keep working. No navbar UI, no global state.

## Scope

- Providers: **Gemini** (Batch API, inline requests) and **OpenAI gpt-image**
  (Batch API via JSONL file upload). All other providers (flux-cloud, recraft,
  atlas, local) ignore the toggle and run sync as today.
- One request per run (no bundling — that's the existing Generate Image Batch
  node's job).
- Everything client-side, mirroring the existing sync paths (Gemini REST
  direct, OpenAI fetch). Zero backend changes.

## UI

- New toggle "Async" in the Generate Image node's toggle row (next to
  Thinking/Grounding/Edit/Crop). Rendered only when the selected model's
  provider is `gemini` or `openai`.
- State: `asyncGen?: boolean` in `GenerateImageNodeData` (persists with the
  project like every other node field).
- While waiting: node status shows `Batch queued… Xm Ys` (updated per poll).
- Cost estimate shown at -50% when the toggle is ON.

## Flow

```
runSingle()
  └─ asyncGen && provider in {gemini, openai}
       → options.async = true
       → provider.generateImage(...) takes the batch path:
           submit → poll (10s) → download/decode → GenerateImageResult
       (await — identical contract to the sync path)
```

Downstream (mediaId, history, bridge, cost tracking) unchanged.

## New files

1. `frontend/src/providers/geminiBatchPath.ts`
   - `POST /v1beta/models/{model}:batchGenerateContent` with ONE inline
     request (`batch.input_config.requests.requests[0]`), same
     `generation_config` as the sync REST path (imageConfig, thinking gate
     per feedback_gemini_thinking_imagesize).
   - Poll `GET /v1beta/batches/{id}` every 10s until terminal state
     (`BATCH_STATE_SUCCEEDED|FAILED|CANCELLED|EXPIRED`).
   - Parse inlined response → `image_b64` + usage; cost ×0.5.
   - Exact result JSON nesting to be verified empirically with one cheap
     flash-lite smoke before shipping (feedback_verify_empirically).

2. `frontend/src/providers/openaiBatchPath.ts`
   - Build one JSONL line `{custom_id, method: "POST", url, body}`.
     `url` = `/v1/images/edits` when refs present (refs uploaded first as
     `purpose: "vision"` files, body uses `images: [{file_id}]` — shape
     proven in PAO `openai_batch.py`), else `/v1/images/generations`.
   - Upload JSONL (`purpose: "batch"`), `POST /v1/batches`
     (`completion_window: "24h"`), poll `GET /v1/batches/{id}`,
     download `output_file_id` content, decode `b64_json`; cost ×0.5.
   - Best-effort cleanup of uploaded files after completion.

## Modified files

- `frontend/src/providers/index.ts` — add `async?: boolean` to
  `ImageGenerationOptions`.
- `frontend/src/providers/geminiProvider.ts` — branch to `geminiBatchPath`
  when `options.async`.
- `frontend/src/providers/openaiProvider.ts` — branch to `openaiBatchPath`
  when `options.async`.
- `frontend/src/nodes/generate-image/useGenerateImage.ts` — `asyncGen` state
  + pass `options.async` + status text while polling.
- `frontend/src/nodes/generate-image/GenerateImageNode.tsx` — toggle UI.
- `frontend/src/types.ts` — `asyncGen?: boolean` on `GenerateImageNodeData`.

## Risks / decisions

- **Batch latency is unbounded** (24h SLA, often minutes). run() blocks until
  done — accepted by Antonio ("attendi risultato"). Cascade stays correct.
- **Tab close mid-poll**: job continues server-side, result lost, money spent
  (at half price). Recovery (persist job name in node data + resume on mount)
  deferred to v2. Cancel-on-Stop also v2.
- **Model id migration**: Gemini `-preview` image ids shut down 2026-06-25
  (GA: `gemini-3-pro-image`, `gemini-3.1-flash-image`). The batch path passes
  through whatever id the node selected; the id migration itself is a separate
  task.
- **OpenAI `/v1/images/generations` in batch** is unproven (PAO only proves
  `/edits`). If rejected, the error surfaces in the node; fallback decision
  then.

## Tests (vitest)

- Gemini: inline request body shape (imageConfig, thinking gate at ≥2K),
  poll-until-terminal, parse success/error line, cost ×0.5.
- OpenAI: JSONL line shape (generations vs edits), vision upload for refs,
  poll, decode, cost ×0.5.
- Routing: `options.async` set only when toggle ON + provider supported.
- Mocked fetch throughout; failure paths covered
  (feedback_test_failure_paths).
