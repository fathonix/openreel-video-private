import type { JobResult, JobRunner } from "@openreel/agent";

export interface WorkerTaskContext {
  /** Existing GPU JobRunner (e.g. createGpuJobRunner(config)) or a test double. */
  readonly runner: JobRunner;
  readonly fetchFn?: typeof fetch;
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
