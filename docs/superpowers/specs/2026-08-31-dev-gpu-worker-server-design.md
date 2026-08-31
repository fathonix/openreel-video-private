# Dev GPU Worker Server — Design

**Date:** 2026-08-31
**Status:** Implemented (staged on `opencode/mvp-cloud-gpu`)
**Relates:** `2026-08-31-mvp-cloud-gpu-workers-design.md` (the worker registry this server executes), `2026-08-31-gpu-endpoint-dev-resolution-design.md` (why dev resolves to `localhost:8000`), `2026-08-31-transcription-engine-ts-design.md` (the in-process engine powering transcription/translation).

## 1. Goal

Nothing in the repo previously started the server-side GPU worker, so dev environments resolved to the remote `ai.openreel.video`. Add a **local GPU worker dev server** on port 8000 — started automatically by `pnpm dev` — that implements the same HTTP contract the web/desktop clients expect, runs the 25 worker tasks in-process, and serves the auth-broker endpoints (also resolved to `localhost:8000` in dev). The other 23 (non-transcription) kinds fail honestly: they need the real GPU worker, which is not in this repo.

## 2. Server (`dev-server.ts`)

Zero-dependency `node:http` server (no express), in-memory state, CORS `Access-Control-Allow-Origin: *` for the browser clients. Port: `OPENREEL_DEV_GPU_PORT ?? 8000`. Started by the `dev-server` entry; `startDevServer()` is exported for tests, and the file self-starts only when executed directly (`argv[1].endsWith("dev-server.js")` boot guard).

| Route | Behavior |
|---|---|
| `GET /health` | worker name (`openreel-dev-gpu-worker`), all 25 kinds, active job count |
| `POST /auth/challenge` | `{ challengeId }` (UUID) |
| `POST /auth/token` | dev token `dev.<base64url>` + 10 min expiry |
| `POST /auth/upload-url` | `{ uploadURL, mediaKey, headers }` pointing at `/media/<key>` |
| `PUT/GET /media/:key` | in-memory media store (lost on restart — mirrors the contract, not persistence) |
| `POST /jobs` | accepts `{ kind, params }` or `{ request: { kind, params }, mediaKey, mediaFilename }`; a present `mediaKey` is injected into `params.mediaUrl` (and 400s if the media isn't stored locally); unknown kinds 400; enqueues → `{ jobID, status }` |
| `GET /jobs/:id` | status (`queued` / `processing` / `completed` / `failed` / `cancelled`), error, manifestURL |
| `GET /jobs/:id/manifest` | kind, status, artifact list, metadata |
| `GET /jobs/:id/artifacts/:path` | stored artifacts (`transcript.vtt` served as `text/vtt`) |
| `DELETE /jobs/:id` | cancels queued/processing jobs |

Job execution: `runWorkerTask(kind, params, ctx)` with a `devRunner` that returns `{ ok: false, error: "kind X is not implemented in the local dev GPU worker (no cloud GPU worker configured)" }` — so `upscale`, `stabilization`, etc. fail fast and honestly rather than silently hitting the remote. Transcription/translation run the in-process TS engine; their `vtt` output is stored as a `transcript.vtt` artifact. Workers run in a `void`-ed promise per job (no queueing), matching the MVP scope.

## 3. Build + dev wiring

- **`tsup.config.ts`** — new `dev-server` entry; format switched from `["cjs"]` to `["cjs", "esm"]` (the initial per-entry `{ cli: ["cjs"], "dev-server": ["cjs","esm"] }` form is unsupported by tsup 8: `Cannot find cli: [object Object]`). Workspace packages stay `noExternal` (inlined), Node built-ins external.
- **`dev:worker` script** — `tsup --watch --onSuccess "node dist/dev-server.js"`: rebuild + restart the worker on every change.
- **`scripts/dev.mjs`** — root orchestrator: spawns the agent-runner `dev:worker` and the web `dev` (vite) with inherited stdio, SIGTERMs both on exit or when either dies. Root `dev` script now runs it (`pnpm dev` → worker + web together).

## 4. Verification

- Smoke-tested via curl against the running server: health, `/auth/*` (challenge/token/upload-url), media PUT/GET, job lifecycle (submit → processing → completed with manifest + artifact), unknown kind 400, missing media 400, `upscale` → `failed` with the honest not-implemented error.
- Full transcription E2E (tone WAV → decode → model → VTT) progressed through decode + model inference; the remaining blocker is model-host reachability, tracked in the engine design doc.
- Typecheck + 44/44 agent-runner tests still green (the workers registry itself is unchanged by the server).

## 5. Known limitations / open items

- **In-memory only:** media and jobs vanish on restart; fine for dev, wrong for anything else.
- **No queueing/concurrency limits** — a long transcription blocks new requests (single-threaded async + sync ONNX inference).
- The 23 dispatch kinds intentionally error locally; a real local GPU worker (or a tunnel to the deployed one) is required for them.
- `pnpm dev` starts the worker before vite; the worker takes a moment to build on first run (tsup watch).