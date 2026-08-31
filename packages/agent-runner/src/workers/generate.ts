import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { cloudDispatchWorker } from "./cloud-dispatch";

export const musicGenerationWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.musicGeneration);
