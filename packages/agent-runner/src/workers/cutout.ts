import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { cloudDispatchWorker } from "./cloud-dispatch";

export const backgroundRemovalWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.backgroundRemoval);
export const personMattingWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.personMatting);
export const objectRemovalWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.objectRemoval);
