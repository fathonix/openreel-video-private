import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { cloudDispatchWorker } from "./cloud-dispatch";

export const audioSeparationWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.audioSeparation);
export const voiceEnhanceWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.voiceEnhance);
export const silenceRemovalWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.silenceRemoval);
