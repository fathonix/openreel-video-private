# GPU Cloud Endpoint Dev Resolution — Design

**Date:** 2026-08-31
**Status:** Implemented (commit `09ec8a9` + follow-up)
**Relates:** `2026-06-02-desktop-gpu-cloud-jobs-design.md` (the `ai.openreel.video` GPU worker contract), `apps/web/src/config/api-endpoints.ts` (existing endpoint-convention module).

## 1. Goal

The GPU cloud features previously resolved `ai.openreel.video` unconditionally, so dev environments hit the remote worker instead of local code. Make all GPU-cloud endpoint resolution environment-aware: **dev/local → localhost, production → the remote service**, with explicit env-var overrides always winning. No behavior change in packaged/production builds.

## 2. Resolution rules

| Component | Env var (override) | Dev default | Prod default |
|---|---|---|---|
| GPU job worker (`/jobs`, artifacts) | `VITE_OPENREEL_GPU_BASE_URL` (web) / `OPENREEL_GPU_BASE_URL` (desktop) | `http://localhost:8000` | `https://ai.openreel.video` |
| Auth broker (GPU JWT minting) | `VITE_OPENREEL_AUTH_BROKER_BASE_URL` (web) / `OPENREEL_AUTH_BROKER_BASE_URL` (desktop) | `http://localhost:8787` | `https://api.openreel.video` |
| Transcribe service (GPU) | `VITE_OPENREEL_TRANSCRIBE_URL` | `http://localhost:8000` | `https://cloud.openreel.video` |

Dev detection follows existing in-repo conventions:

- **Web renderer:** `import.meta.env.DEV` — the same switch already used by `OPENREEL_CLOUD_URL` (`http://localhost:8787` in dev) and `OPENREEL_TTS_URL` in `apps/web/src/config/api-endpoints.ts`. The GPU/broker/transcribe URLs now live in that config module as `OPENREEL_GPU_URL`, `OPENREEL_BROKER_URL`, `OPENREEL_TRANSCRIBE_URL`, and the GPU/broker clients read them from there (no inline hardcoded fallbacks).
- **Desktop main (Electron):** `app.isPackaged` — the existing dev/packaged distinction already used by `rendererRoot()` in `apps/desktop/src/main/index.ts`. Unpackaged (`pnpm dev`, `tsup --watch` + `electron .`) resolves to localhost; packaged builds resolve to prod.

## 3. Files changed

- `apps/web/src/config/api-endpoints.ts` — added `OPENREEL_GPU_URL`, `OPENREEL_BROKER_URL`; gave `OPENREEL_TRANSCRIBE_URL` the dev switch it was missing (it was the only endpoint in the module hardcoded to prod).
- `apps/web/src/services/gpu-web-client.ts` — `gpuBaseUrl()` / `brokerBaseUrl()` now resolve from the config module.
- `apps/desktop/src/main/index.ts` — `GPU_BASE_URL` and `BROKER_BASE_URL` default to localhost when `!app.isPackaged`; env overrides still win.
- `apps/web/.env.example` — documented `VITE_OPENREEL_GPU_BASE_URL` and `VITE_OPENREEL_AUTH_BROKER_BASE_URL`.
- `apps/desktop/test/parity.md` — corrected the stale broker default (`openreel-cloud.niiyeboah1996.workers.dev` → `api.openreel.video`) and noted the dev defaults.

## 4. Audit (endpoint correctness across the worker/GPU stack)

- No hardcoded URLs in `packages/agent-runner`: dispatch workers use the injected `ctx.runner`; transcription/translation use optional `ctx.transcribeBaseUrl`; `createGpuJobRunner` requires `gpuBaseUrl` from config (no default).
- Headers verified against the reference implementations: infra path sends multipart `audio`/`language`/`target_language` (matches `infra/transcribe-gpu/main.py`); cloud clients send `Authorization: Bearer`, `X-Bundle-ID`, `Accept`, `Content-Type` (matches the broker JWT flow).
- Payload/response verified: `POST /transcribe` → `{jobId}` and `GET /jobs/{id}` → `{status, progress, result?, error?}` handling matches the service's actual contract; cloud path returns `{jobID, status, manifestURL}`.

## 5. Verification

- Typecheck clean: `apps/web`, `apps/desktop`, `packages/agent-runner`.
- Tests green: web GPU services (`gpu-web-client` 12, `gpu-jobs` 2, `gpu-clip-submit` 4, `gpu-result-import` 9), desktop GPU (`gpu-token-provider` 4, `gpu-job-client` 9), agent-runner 40/40.

## 6. Known limitations / open items

- **No staging-specific endpoints** are modeled anywhere in the repo — non-dev resolves to prod (matches existing convention).
- **Broker in dev** defaults to `http://localhost:8787`, but no local broker exists in this repo (`apps/cloud` is deployed externally) — dev GPU flows require a local broker or an explicit override.
- **`infra/transcribe-gpu` (port 8000)** implements only `/transcribe`; the other 23 job kinds need the full GPU worker (external) reachable at the dev URL.
- The **desktop renderer** is always a production build of `apps/web` (`import.meta.env.DEV` false even in desktop dev); its web-GPU path keeps the prod fallback, which is harmless while desktop routes GPU calls through the main process (`window.openreel.gpu`).