# MVP Cloud GPU Workers — Design

**Date:** 2026-08-31
**Status:** Implemented (commit `f4ed84d`)
**Relates:** builds on `2026-06-02-desktop-gpu-cloud-jobs-design.md` and `2026-06-18-ai-agent-editing-design.md` (the `JobRunner` / `runJob` delegation surface).

## 1. Goal

Expose **every cloud GPU tool feature** in the project as a callable server-side worker task: one worker function per `AI_CLOUD_JOB_KINDS` entry (25 kinds). Each worker is a thin wrapper over an existing underlying client — no GPU logic is reimplemented — with MVP-level input validation and error handling. Scope is deliberately minimal: no retries, queuing, or observability.

## 2. Architecture

```
caller (server/CLI/test)
        │ runWorkerTask(kind, input, ctx)
        ▼
  WORKER_TASKS[kind]  (registry.ts — one task per kind)
        │
        ├── 23 dispatch kinds ──► ctx.runner(kind, params)      [createGpuJobRunner → ai.openreel.video /jobs]
        │                            │ mediaKey forwarded in params
        └── transcription/translation
                 │ ctx.transcribeBaseUrl set ?  ──► infra/transcribe-gpu (POST /transcribe → poll /jobs/{id})
                 └─ else ──► ctx.runner (cloud dispatch fallback)
```

The context (`WorkerTaskContext`) carries the existing `JobRunner` (typically `createGpuJobRunner(config)` from `gpu-job-runner.ts`) plus optional infra-service settings, so callers inject the transport and the workers stay transport-agnostic and fully testable with a mock runner.

## 3. Worker registry (25 kinds)

`WORKER_TASKS: Record<AiCloudJobKind, WorkerTask>` in `registry.ts`, grouped by domain files:

| File | Workers |
|---|---|
| `enhance.ts` | `upscale`, `denoise`, `faceRestore`, `photoEnhance`, `colorize`, `colorMatch`, `portraitBokeh` (7) |
| `cutout.ts` | `backgroundRemoval`, `personMatting`, `objectRemoval` (3) |
| `motion.ts` | `stabilization`, `autoReframe`, `frameInterpolation` (3) |
| `analyze.ts` | `autoCaptions`, `sceneDetection`, `faceAnalysis`, `objectTracking`, `smartThumbnail`, `aiHighlight` (6) |
| `audio.ts` | `audioSeparation`, `voiceEnhance`, `silenceRemoval` (3) |
| `generate.ts` | `musicGeneration` (1) |
| `transcription.ts` | `transcription` (custom — infra + cloud paths) |
| `translation.ts` | `translation` (custom — infra + cloud paths) |

Entry points: `registry.ts` (`runWorkerTask`, `WORKER_TASKS`), barrel `workers/index.ts`, package exports `packages/agent-runner/src/index.ts`.

## 4. Shared infrastructure

- **`types.ts`** — `WorkerTaskContext` (`runner`, `transcribeBaseUrl?`, `fetchFn?`, `pollIntervalMs?`, `maxPollMs?`, `sleep?`), `WorkerTask = (input, ctx) => Promise<JobResult>`, `WorkerValidationError`.
- **`validation.ts`** — `requireString`, `requireNumber`, `requireEnum`, `requireMediaKey` (accepts `mediaKey` / `mediaUrl` / `media_url` / `media_key`), `optionalMediaKey`, `optionalString`.
- **`cloud-dispatch.ts`** — `dispatchCloudJob` (delegates to `ctx.runner(kind as JobKind, params)`), `createCloudJobRunner(config)` (wraps `createGpuJobRunner`), `cloudDispatchWorker(kind, opts)` factory.

Media requirement is derived from the existing `MEDIA_OPTIONAL_KINDS` set in `packages/core` (`music_generation`, `translation` are optional; the other 23 require a media key). Kinds have no in-repo param schema, so all other params are passed through untouched.

## 5. Transcription / translation (infra path)

> **Superseded (2026-08-31):** the infra HTTP path below has been replaced by the in-process TS engine for local use — see `2026-08-31-transcription-engine-ts-design.md`. The cloud-dispatch fallback described here is unchanged.

`transcription.ts` wraps `infra/transcribe-gpu` (faster-whisper FastAPI service) via HTTP when `ctx.transcribeBaseUrl` is set:

- `POST {base}/transcribe` — multipart form: `audio` blob + optional `language` / `target_language`.
- Poll `GET {base}/jobs/{jobId}` to `completed` / `failed` (2s interval, 10 min cap, injectable `sleep` for tests).
- Returns the service's `result` object; job failures surface as `{ ok: false, error }`.

Input accepts raw bytes (`file` / `audio`) or an http `mediaUrl` (fetched via `ctx.fetchFn`). Without a `transcribeBaseUrl`, both workers fall back to cloud dispatch (`transcription` requires media there; `translation` is media-optional per `MEDIA_OPTIONAL_KINDS`). `translation.ts` additionally requires `target_language` on the infra path.

## 6. Verification

- `tsc --noEmit` (agent-runner): clean.
- `vitest run` (agent-runner): **40/40 tests, 7 files** — including `workers.test.ts` (12 tests): registry covers all 25 kinds, every kind runs end-to-end through a mock runner, unknown kinds reject, media-bound kinds reject without media, mediaKey/params forwarding, infra transcription success/failure + cloud fallback, translation `target_language` requirement + form field, music-generation without media.
- No new dependencies (uses `@openreel/agent`, `@openreel/core` — via the `@openreel/core/ai/cloud-job-types` source subpath to avoid the DOM-bound core barrel at runtime).

## 7. Out of scope / limitations

- **No per-kind param schemas** exist in-repo; validation is media-requirement + passthrough only.
- **`mediaKey` is forwarded inside `params`** for dispatch kinds; callers with media-aware transports may adapt.
- `infra/transcribe-gpu` implements only `/transcribe`; the other 23 kinds need the full GPU worker (deployed externally, not in this repo) reachable via the runner.
- `TranscriptionService` (`packages/core/src/text/transcription-service.ts`) is browser-bound (`AudioContext`), so the infra path wraps the HTTP API directly rather than that client.