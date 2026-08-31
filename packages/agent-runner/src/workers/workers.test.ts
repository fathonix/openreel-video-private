import { describe, it, expect, vi } from "vitest";
import { AI_CLOUD_JOB_KINDS, type AiCloudJobKind } from "@openreel/core/ai/cloud-job-types";
import type { JobResult, JobRunner } from "@openreel/agent";
import { runWorkerTask, WORKER_TASKS } from "./registry";
import { WorkerValidationError } from "./types";
import type { WorkerTaskContext } from "./types";

vi.mock("./transcription-engine", () => ({
  decodeAudioToFloat32: vi.fn(async () => new Float32Array([0, 0.5, -0.5, 1])),
  transcribeAudio: vi.fn(
    async (options: { targetLanguage?: string; language?: string }) => ({
      text: "hello world",
      words: [
        { word: "hello", start: 0, end: 0.5 },
        { word: "world", start: 0.5, end: 1 },
      ],
      language: options.targetLanguage === "en" ? "es" : (options.language ?? "en"),
      duration: 1,
    }),
  ),
  wordsToVtt: vi.fn(() => "WEBVTT\n\n"),
}));

function makeRunner(): { runner: JobRunner; calls: Array<{ kind: string; params: Record<string, unknown> }> } {
  const calls: Array<{ kind: string; params: Record<string, unknown> }> = [];
  const runner: JobRunner = async (kind, params) => {
    calls.push({ kind, params });
    return { ok: true, data: { kind } } as JobResult;
  };
  return { runner, calls };
}

function baseCtx(runner: JobRunner): WorkerTaskContext {
  return { runner };
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
      const result = await runWorkerTask(
        kind,
        { mediaKey: "media-1", target_language: "en" },
        baseCtx(runner),
      );
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
  it("runs the in-process TS engine when media bytes are provided", async () => {
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.transcription,
      { file: new Uint8Array([1, 2, 3]), filename: "clip.wav", language: "en" },
      baseCtx(runner),
    );
    expect(result.ok).toBe(true);
    expect((result.data as { text: string }).text).toBe("hello world");
    expect((result.data as { vtt: string }).vtt).toBe("WEBVTT\n\n");
    expect(calls).toHaveLength(0);
  });

  it("runs the in-process engine for http mediaUrl inputs", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([9, 8, 7]).buffer, { status: 200 }),
    );
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.transcription,
      { mediaUrl: "http://localhost:8000/media/x" },
      { ...baseCtx(runner), fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("http://localhost:8000/media/x");
    expect(calls).toHaveLength(0);
  });

  it("dispatches to the cloud runner when only a mediaKey is present", async () => {
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

  it("returns ok:false when the engine fails", async () => {
    const { decodeAudioToFloat32 } = await import("./transcription-engine");
    vi.mocked(decodeAudioToFloat32).mockRejectedValueOnce(new Error("decode failed"));
    const { runner } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.transcription,
      { file: new Uint8Array([1]) },
      baseCtx(runner),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/decode failed/);
  });

  it("rejects when neither media nor a mediaKey is provided", async () => {
    const { runner } = makeRunner();
    await expect(
      runWorkerTask(AI_CLOUD_JOB_KINDS.transcription, {}, baseCtx(runner)),
    ).rejects.toThrow(WorkerValidationError);
  });
});

describe("translationWorker", () => {
  it("requires target_language", async () => {
    const { runner } = makeRunner();
    await expect(
      runWorkerTask(AI_CLOUD_JOB_KINDS.translation, { file: new Uint8Array([1]) }, baseCtx(runner)),
    ).rejects.toThrow(WorkerValidationError);
  });

  it("runs the engine with the whisper translate task for en", async () => {
    const { runner, calls } = makeRunner();
    const result = await runWorkerTask(
      AI_CLOUD_JOB_KINDS.translation,
      { file: new Uint8Array([1]), target_language: "en" },
      baseCtx(runner),
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects non-en local translation", async () => {
    const { runner } = makeRunner();
    await expect(
      runWorkerTask(
        AI_CLOUD_JOB_KINDS.translation,
        { file: new Uint8Array([1]), target_language: "es" },
        baseCtx(runner),
      ),
    ).rejects.toThrow(WorkerValidationError);
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

describe("wavToFloat32", () => {
  it("decodes a 16-bit mono PCM WAV into samples", async () => {
    const { wavToFloat32 } = await vi.importActual<typeof import("./transcription-engine")>(
      "./transcription-engine",
    );
    const header = new Uint8Array(44);
    header.set([0x52, 0x49, 0x46, 0x46], 0);
    header.set([0x57, 0x41, 0x56, 0x45], 8);
    header.set([0x66, 0x6d, 0x74, 0x20], 12);
    header[16] = 16;
    header[20] = 1;
    header[22] = 1;
    header[24] = 0x40;
    header[25] = 0x1f;
    header[34] = 16;
    header.set([0x64, 0x61, 0x74, 0x61], 36);
    header[40] = 4;
    const pcm = new Uint8Array([0x00, 0x00, 0x00, 0x80]);
    const wav = new Uint8Array(header.length + pcm.length);
    wav.set(header);
    wav.set(pcm, header.length);
    const samples = wavToFloat32(wav);
    expect(samples.length).toBe(2);
    expect(samples[0]).toBe(0);
    expect(samples[1]).toBe(-1);
  });
});