import type { JobKind, JobResult, JobRunner } from "@openreel/agent";
import { AI_CLOUD_JOB_KINDS, MEDIA_OPTIONAL_KINDS, type AiCloudJobKind } from "@openreel/core/ai/cloud-job-types";
import { createGpuJobRunner, type GpuRunnerConfig } from "../gpu-job-runner";
import type { WorkerTask, WorkerTaskContext } from "./types";
import { optionalMediaKey, requireMediaKey } from "./validation";

export function dispatchCloudJob(
  ctx: WorkerTaskContext,
  kind: string,
  params: Record<string, unknown>,
): Promise<JobResult> {
  return ctx.runner(kind as JobKind, params);
}

export function createCloudJobRunner(config: GpuRunnerConfig): JobRunner {
  return createGpuJobRunner(config);
}

export function cloudDispatchWorker(
  kind: AiCloudJobKind,
  opts: { requiresMedia?: boolean } = {},
): WorkerTask {
  return async (input, ctx) => {
    const requiresMedia = opts.requiresMedia ?? !MEDIA_OPTIONAL_KINDS.has(kind);
    const params: Record<string, unknown> = { ...input };
    if (requiresMedia) {
      params.mediaKey = requireMediaKey(input);
    } else {
      const mediaKey = optionalMediaKey(input);
      if (mediaKey) params.mediaKey = mediaKey;
    }
    return dispatchCloudJob(ctx, kind, params);
  };
}

export { AI_CLOUD_JOB_KINDS };
