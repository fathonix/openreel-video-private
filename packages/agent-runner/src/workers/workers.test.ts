import { describe, it, expect, vi } from "vitest";
import { AI_CLOUD_JOB_KINDS, type AiCloudJobKind } from "@openreel/core/ai/cloud-job-types";
import type { JobResult, JobRunner } from "@openreel/agent";
import { runWorkerTask, WORKER_TASKS } from "./registry";
import { WorkerValidationError } from "./types";
import type { WorkerTaskContext } from "./types";

function makeRunner(): { runner: JobRunner; calls: Array<{ kind: string; params: Record<string, unknown> }> } {
  const calls: Array<{ kind: string; params: Record<string, unknown> }> = [];
  const runner: JobRunner = async (kind, params) => {
    calls.push({ kind, params });
    return { ok: true, data: { kind } } as JobResult;
  };
  return { runner, calls };
}

function baseCtx(runner: JobRunner): WorkerTaskContext {
  return { runner, sleep: async () => {}, pollIntervalMs: 1 };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALL_KINDS = Object.values(AI_CLOUD_JOB_KINDS) as AiCloudJobKind[];
const MEDIA_KEYS_IN_KINDS = ALL_KINDS.filter(
  (k) => !["music_generation", "translation"].includes(k),
);

describe("worker registry", () => {
  it("registers exactly one task per cloud GPU kind", () => {
    for (const kind of ALL_KINDS) {
      expect(WORKER_TASKS[kind], `missing worker for ${kind}`).toBeTypeOf("function");
    }
    expect(Object.keys(WORKER_TASKS)).toHaveLength(ALL_KINDS.length);
  });

  it("runs every kind end-to-end through a mock runner", async () => {
    for (const kind of ALL_KINDS) {
      const { runner, calls } = makeRunner();
      const result = await runWorkerTask(kind, { mediaKey: "media-1" }, baseCtx(runner));
      expect(result.ok, `worker ${kind} failed`).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].kind).toBe(kind);
    }
  });

  it("rejects unknown kinds", async () => {
    const { runner } = makeRunner();
    await expect(
      runWorkerTask("nonexistent_kind", {}, baseCtx(runner)),
    ).rejects.toThrow(WorkerValidationError);
  });

  it("requires media for media-bound kinds", async () => {
    for (const kind of MEDIA_KEYS_IN_KINDS) {
      const { runner } = makeRunner();
      await expect(
        runWorkerTask(kind, {}, baseCtx(runner)),
      ).rejects.toThrow(WorkerValidationError);
    }
  });

  it("forwards mediaKey and passthrough params to the runner", async () => {
    const { runner, calls } = makeRunner();
    await runWorkerTask(
      AI_CLOUD_JOB_KINDS.upscale,
      { mediaKey: "media-9", scale: 4 },
      baseCtx(runner),
    );
    expect(calls[0].params.mediaKey).toBe("media-9");
    expect(calls[0].params.scale).toBe(4);
  });
});

describe("transcriptionWorker", () => {
  it("wraps the infra transcribe-gpu service when configured", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobId: "t1", status: "processing" }))
      .mockResolvedValueOnce(
        jsonResponse({ jobId: "t1", status: "completed", result: { text: "hello world" } }),
      );
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.transcription,
      { file: new Uint8Array([1, 2, 3]), filename: "clip.wav" },
      { ...baseCtx(runner), transcribeBaseUrl: "http://infra.test", fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { text: string }).text).toBe("hello world");
    expect(calls).toHaveLength(0);
    const [submitUrl, submitInit] = fetchFn.mock.calls[0];
    expect(submitUrl).toBe("http://infra.test/transcribe");
    expect(submitInit?.method).toBe("POST");
    expect(fetchFn.mock.calls[1][0]).toBe("http://infra.test/jobs/t1");
  });

  it("falls back to the cloud dispatch kind when no infra base URL is set", async () => {
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.transcription,
      { mediaKey: "media-2", language: "en" },
      baseCtx(runner),
    );
    expect(result.ok).toBe(true);
    expect(calls[0].kind).toBe(AI_CLOUD_JOB_KINDS.transcription);
    expect(calls[0].params.mediaKey).toBe("media-2");
    expect(calls[0].params.language).toBe("en");
  });

  it("propagates infra job failures", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobId: "t2", status: "processing" }))
      .mockResolvedValueOnce(jsonResponse({ jobId: "t2", status: "failed", error: "OOM" }));
    const { runner } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.transcription,
      { file: new Uint8Array([1]) },
      { ...baseCtx(runner), transcribeBaseUrl: "http://infra.test", fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OOM/);
  });
});

describe("translationWorker", () => {
  it("requires target_language on the infra path", async () => {
    const { runner } = makeRunner();
    await expect(
      runWorkerTask(
        AI_CLOUD_JOB_KINDS.translation,
        { file: new Uint8Array([1]) },
        { ...baseCtx(runner), transcribeBaseUrl: "http://infra.test" },
      ),
    ).rejects.toThrow(WorkerValidationError);
  });

  it("posts target_language to the infra service", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobId: "x1", status: "completed", result: { text: "hola" } }));
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.translation,
      { file: new Uint8Array([1]), target_language: "es" },
      { ...baseCtx(runner), transcribeBaseUrl: "http://infra.test", fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
    const body = fetchFn.mock.calls[0][1]?.body as FormData;
    expect(body.get("target_language")).toBe("es");
  });

  it("dispatches the media-optional cloud kind as fallback", async () => {
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.translation,
      { target_language: "es" },
      baseCtx(runner),
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe(AI_CLOUD_JOB_KINDS.translation);
  });
});

describe("musicGenerationWorker", () => {
  it("runs without media (media-optional kind)", async () => {
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.musicGeneration,
      { prompt: "lo-fi beat" },
      baseCtx(runner),
    );
    expect(result.ok).toBe(true);
    expect(calls[0].kind).toBe(AI_CLOUD_JOB_KINDS.musicGeneration);
  });
});
