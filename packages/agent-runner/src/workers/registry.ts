import { AI_CLOUD_JOB_KINDS, type AiCloudJobKind } from "@openreel/core/ai/cloud-job-types";
import type { JobResult } from "@openreel/agent";
import type { WorkerTask, WorkerTaskContext } from "./types";
import { WorkerValidationError } from "./types";
import { transcriptionWorker } from "./transcription";
import { translationWorker } from "./translation";
import {
  upscaleWorker,
  denoiseWorker,
  faceRestoreWorker,
  photoEnhanceWorker,
  colorizeWorker,
  colorMatchWorker,
  portraitBokehWorker,
} from "./enhance";
import {
  backgroundRemovalWorker,
  personMattingWorker,
  objectRemovalWorker,
} from "./cutout";
import {
  stabilizationWorker,
  autoReframeWorker,
  frameInterpolationWorker,
} from "./motion";
import {
  autoCaptionsWorker,
  sceneDetectionWorker,
  faceAnalysisWorker,
  objectTrackingWorker,
  smartThumbnailWorker,
  aiHighlightWorker,
} from "./analyze";
import {
  audioSeparationWorker,
  voiceEnhanceWorker,
  silenceRemovalWorker,
} from "./audio";
import { musicGenerationWorker } from "./generate";

export const WORKER_TASKS: Record<AiCloudJobKind, WorkerTask> = {
  [AI_CLOUD_JOB_KINDS.transcription]: transcriptionWorker,
  [AI_CLOUD_JOB_KINDS.aiHighlight]: aiHighlightWorker,
  [AI_CLOUD_JOB_KINDS.autoCaptions]: autoCaptionsWorker,
  [AI_CLOUD_JOB_KINDS.personMatting]: personMattingWorker,
  [AI_CLOUD_JOB_KINDS.objectTracking]: objectTrackingWorker,
  [AI_CLOUD_JOB_KINDS.faceAnalysis]: faceAnalysisWorker,
  [AI_CLOUD_JOB_KINDS.stabilization]: stabilizationWorker,
  [AI_CLOUD_JOB_KINDS.autoReframe]: autoReframeWorker,
  [AI_CLOUD_JOB_KINDS.audioSeparation]: audioSeparationWorker,
  [AI_CLOUD_JOB_KINDS.colorMatch]: colorMatchWorker,
  [AI_CLOUD_JOB_KINDS.colorize]: colorizeWorker,
  [AI_CLOUD_JOB_KINDS.upscale]: upscaleWorker,
  [AI_CLOUD_JOB_KINDS.sceneDetection]: sceneDetectionWorker,
  [AI_CLOUD_JOB_KINDS.backgroundRemoval]: backgroundRemovalWorker,
  [AI_CLOUD_JOB_KINDS.musicGeneration]: musicGenerationWorker,
  [AI_CLOUD_JOB_KINDS.photoEnhance]: photoEnhanceWorker,
  [AI_CLOUD_JOB_KINDS.portraitBokeh]: portraitBokehWorker,
  [AI_CLOUD_JOB_KINDS.smartThumbnail]: smartThumbnailWorker,
  [AI_CLOUD_JOB_KINDS.denoise]: denoiseWorker,
  [AI_CLOUD_JOB_KINDS.silenceRemoval]: silenceRemovalWorker,
  [AI_CLOUD_JOB_KINDS.frameInterpolation]: frameInterpolationWorker,
  [AI_CLOUD_JOB_KINDS.faceRestore]: faceRestoreWorker,
  [AI_CLOUD_JOB_KINDS.objectRemoval]: objectRemovalWorker,
  [AI_CLOUD_JOB_KINDS.voiceEnhance]: voiceEnhanceWorker,
  [AI_CLOUD_JOB_KINDS.translation]: translationWorker,
};

export async function runWorkerTask(
  kind: string,
  input: Record<string, unknown>,
  ctx: WorkerTaskContext,
): Promise<JobResult> {
  const task = (WORKER_TASKS as Record<string, WorkerTask | undefined>)[kind];
  if (!task) {
    throw new WorkerValidationError(`unknown GPU worker kind: ${kind}`);
  }
  return task(input, ctx);
}
