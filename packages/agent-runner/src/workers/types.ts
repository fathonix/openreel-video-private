import type { JobResult, JobRunner } from "@openreel/agent";

export interface WorkerTaskContext {
  /** Existing GPU JobRunner (e.g. createGpuJobRunner(config)) or a test double. */
  readonly runner: JobRunner;
  /** Base URL of the infra/transcribe-gpu FastAPI service; enables the in-repo Whisper path for transcription/translation. */
  readonly transcribeBaseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly maxPollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type WorkerTask = (
  input: Record<string, unknown>,
  ctx: WorkerTaskContext,
) => Promise<JobResult>;

export class WorkerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerValidationError";
  }
}
