import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { cloudDispatchWorker } from "./cloud-dispatch";

export const upscaleWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.upscale);
export const denoiseWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.denoise);
export const faceRestoreWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.faceRestore);
export const photoEnhanceWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.photoEnhance);
export const colorizeWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.colorize);
export const colorMatchWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.colorMatch);
export const portraitBokehWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.portraitBokeh);
