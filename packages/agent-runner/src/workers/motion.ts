import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { cloudDispatchWorker } from "./cloud-dispatch";

export const stabilizationWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.stabilization);
export const autoReframeWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.autoReframe);
export const frameInterpolationWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.frameInterpolation);
