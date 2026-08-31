import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import type { JobResult } from "@openreel/agent";
import { dispatchCloudJob } from "./cloud-dispatch";
import type { WorkerTask, WorkerTaskContext } from "./types";
import { WorkerValidationError } from "./types";
import { optionalMediaKey, optionalString, requireMediaKey } from "./validation";

const TERMINAL_OK = new Set(["completed", "complete", "succeeded", "done"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled"]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface InfraTranscribeArgs {
  data: Uint8Array;
  filename?: string;
  language?: string;
  targetLanguage?: string;
}

interface InfraJobStatus {
  jobId?: string;
  status?: string;
  progress?: number;
  result?: Record<string, unknown>;
  error?: string;
}

export async function transcribeViaInfra(
  ctx: WorkerTaskContext,
  args: InfraTranscribeArgs,
): Promise<JobResult> {
  const base = ctx.transcribeBaseUrl;
  if (!base) throw new WorkerValidationError("transcribeBaseUrl is not configured");
  const fetchFn = ctx.fetchFn ?? fetch;
  const sleep = ctx.sleep ?? defaultSleep;
  const pollIntervalMs = ctx.pollIntervalMs ?? 2000;
  const maxPollMs = ctx.maxPollMs ?? 10 * 60 * 1000;

  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(args.data)]), args.filename ?? "audio.wav");
  if (args.language) form.append("language", args.language);
  if (args.targetLanguage) form.append("target_language", args.targetLanguage);

  const submitRes = await fetchFn(`${base}/transcribe`, { method: "POST", body: form });
  if (!submitRes.ok) {
    return { ok: false, error: `transcribe submit failed: ${submitRes.status}` };
  }
  const created = (await submitRes.json()) as InfraJobStatus;
  const jobID = created.jobId;
  if (!jobID) return { ok: false, error: "transcribe submit returned no jobId" };

  const deadline = Date.now() + maxPollMs;
  let last: InfraJobStatus = created;
  let status = created.status ?? "processing";
  while (!TERMINAL_OK.has(status) && !TERMINAL_FAIL.has(status)) {
    if (Date.now() >= deadline) {
      return { ok: false, error: `transcription job ${jobID} timed out (last status: ${status})` };
    }
    await sleep(pollIntervalMs);
    const statusRes = await fetchFn(`${base}/jobs/${jobID}`, { method: "GET" });
    if (!statusRes.ok) {
      return { ok: false, error: `transcription status failed: ${statusRes.status}` };
    }
    last = (await statusRes.json()) as InfraJobStatus;
    status = last.status ?? "processing";
  }

  if (TERMINAL_FAIL.has(status)) {
    return { ok: false, error: last.error ?? `transcription job ${jobID} ${status}` };
  }
  return { ok: true, data: last.result ?? last };
}

async function resolveMediaBytes(
  input: Record<string, unknown>,
  ctx: WorkerTaskContext,
): Promise<{ data: Uint8Array; filename?: string }> {
  const filename = optionalString(input, "filename");
  const direct = input.file ?? input.audio;
  if (direct instanceof Uint8Array) return { data: direct, filename };
  if (direct instanceof ArrayBuffer) return { data: new Uint8Array(direct), filename };
  const url = optionalMediaKey(input);
  if (url && /^(https?:)?\/\//.test(url)) {
    const fetchFn = ctx.fetchFn ?? fetch;
    const res = await fetchFn(url);
    if (!res.ok) throw new WorkerValidationError(`failed to fetch media from ${url}: ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), filename };
  }
  throw new WorkerValidationError(
    "transcription via the infra service requires media bytes (file) or an http mediaUrl",
  );
}

export const transcriptionWorker: WorkerTask = async (input, ctx) => {
  const language = optionalString(input, "language");
  const targetLanguage =
    optionalString(input, "target_language") ?? optionalString(input, "targetLanguage");
  if (ctx.transcribeBaseUrl) {
    const media = await resolveMediaBytes(input, ctx);
    return transcribeViaInfra(ctx, { ...media, language, targetLanguage });
  }
  const params: Record<string, unknown> = { ...input, language, target_language: targetLanguage };
  params.mediaKey = requireMediaKey(input);
  return dispatchCloudJob(ctx, AI_CLOUD_JOB_KINDS.transcription, params);
};
