# TypeScript Transcription Engine — Design

**Date:** 2026-08-31
**Status:** Implemented (staged on `opencode/mvp-cloud-gpu`; supersedes §5 of `2026-08-31-mvp-cloud-gpu-workers-design.md`)
**Relates:** `infra/transcribe-gpu/main.py` (the Python/faster-whisper service this replaces for local use), `apps/web/src/workers/whisper-worker.ts` + `whisper-models.ts` (browser-side reference for the transformers.js pipeline call), `2026-08-31-dev-gpu-worker-server-design.md` (the server that hosts this engine in dev).

## 1. Goal

Replace the HTTP path to `infra/transcribe-gpu` (Python faster-whisper service) with an **in-process TypeScript engine** so transcription/translation run as homogeneous worker tasks on the Node GPU worker, using the same transformers.js Whisper stack the web app already uses in the browser. No Python interpreter or separate service needed locally.

## 2. Engine (`transcription-engine.ts`)

- **Model stack:** `@huggingface/transformers` 3.8.1 → ONNX Runtime CPU (`device: "cpu"`, `dtype: "q4"`, ~100 MB models).
- **Models** (mirroring `whisper-models.ts` naming): `accurate` = `onnx-community/whisper-large-v3-turbo_timestamped`, `fast` = `onnx-community/whisper-tiny_timestamped`. Both are *timestamped* variants — non-timestamped models fail `return_timestamps` with "Model outputs must contain cross attentions" (the plain `whisper-tiny` was originally wired and hit exactly this).
- **Model host:** `env.remoteHost` defaults to `https://media.openreel.video/models/` with `remotePathTemplate = "{model}/resolve/{revision}/"` (the same R2 mirror config as the browser worker); overridable via `OPENREEL_WHISPER_MODEL_HOST`.
- **Pipeline call:** `automatic-speech-recognition` with `return_timestamps: "word"`, `chunk_length_s: 30`, `stride_length_s: 5`; `task: "translate"` when `targetLanguage === "en"`, else `"transcribe"`. Chunks are mapped to `{word, start, end}` (0.01 s rounding); `wordsToVtt` renders `WEBVTT`.
- **Audio decode** (`decodeAudioToFloat32`): spawns `ffmpeg-static` (7.0.2 static binary, downloaded at install) with `-i pipe:0 … -ar 16000 -ac 1 -f wav pipe:1`. `OPENREEL_FFMPEG_PATH` overrides the binary. `wavToFloat32` validates 16-bit mono PCM and — importantly — treats a `data` chunk size of `0xFFFFFFFF` as "size unknown until EOF" and derives it from the buffer length: ffmpeg emits exactly that when writing to a non-seekable pipe (this was the actual E2E bug, surfacing as `Invalid typed array length: -1`).

## 3. Worker changes

- **`transcription.ts`** — rewritten. `hasLocalMedia(input)` decides the path: media **bytes** (`file`/`audio`) or an **http(s) `mediaUrl`** → in-process engine; a bare `mediaKey` → cloud dispatch via `ctx.runner` (unchanged fallback). `model: "fast"` param selects the fast model; the engine result is returned as `{ ok, data: { text, words, language, duration, vtt } }`.
- **`translation.ts`** — rewritten. Now always requires `target_language` (cloud path previously tolerated its absence); local path supports `target_language: "en"` only (Whisper translate task) and rejects other targets with a clear error; otherwise mirrors the transcription path.
- **`types.ts`** — `WorkerTaskContext` slimmed: removed `transcribeBaseUrl`, `pollIntervalMs`, `maxPollMs`, `sleep` (the infra HTTP client is gone).
- **`workers/index.ts`** — exports the engine surface (`transcribeAudio`, `decodeAudioToFloat32`, `wavToFloat32`, `wordsToVtt`, types) alongside the rewritten workers.

## 4. Dependencies

- Added to `packages/agent-runner`: `@huggingface/transformers` (3.8.1), `ffmpeg-static` (^5.3.0). `ffmpeg-static`'s postinstall downloads the binary, so `pnpm-workspace.yaml` `allowBuilds` now lists `ffmpeg-static: true` (pnpm 11 blocks build scripts by default).
- `@ffmpeg/core` / `@ffmpeg/ffmpeg` / `@ffmpeg/util` were added during the first decode attempt (ffmpeg.wasm) and are **unused** after the ffmpeg-static rewrite — pending removal (see limitations).

## 5. Verification

- `tsc --noEmit` clean; `vitest run` — agent-runner **44/44 tests** (workers.test.ts grew 12 → 16: engine path for bytes, http `mediaUrl`, cloud fallback on bare `mediaKey`, engine-failure → `ok:false`, no-media rejection, `target_language` requirement, en-only local translation, `wavToFloat32` decode). The engine is mocked in tests via `vi.mock("./transcription-engine")`.
- Real E2E through the dev GPU worker (see `2026-08-31-dev-gpu-worker-server-design.md`): `wavToFloat32` + ffmpeg pipe decode verified against a generated 440 Hz tone (sample values match the sine after s16 quantization); model download + inference reached on `whisper-tiny`; timestamped-tiny E2E pending the model-host issue below.

## 6. Known limitations / open items

- **Model host 404s:** direct requests to `https://media.openreel.video/models/<repo>/resolve/main/...` return 404 for repos not yet mirrored (first-access cache). The `whisper-tiny_timestamped` run failed with `Could not locate file: …tokenizer.json`. `huggingface.co` direct is reachable (307), so a mirror fallback in the engine (try mirror → fall back to HF) is the likely fix; the env override already provides an escape hatch.
- **`@ffmpeg/*` deps unused** — leftover from the ffmpeg.wasm iteration; remove alongside a cleanup commit.
- Only `transcription`/`translation` run locally; the other 23 kinds need the external GPU worker.
- Local decode/inference blocks the event loop (sync `callMain`-style decode via child process is async, but the ONNX inference itself is synchronous); fine for dev/MVP.