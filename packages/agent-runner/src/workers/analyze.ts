import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { cloudDispatchWorker } from "./cloud-dispatch";

export const autoCaptionsWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.autoCaptions);
export const sceneDetectionWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.sceneDetection);
export const faceAnalysisWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.faceAnalysis);
export const objectTrackingWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.objectTracking);
export const smartThumbnailWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.smartThumbnail);
export const aiHighlightWorker = cloudDispatchWorker(AI_CLOUD_JOB_KINDS.aiHighlight);
