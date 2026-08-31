import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import type { WorkerTask } from "./types";
import { WorkerValidationError } from "./types";
import { dispatchCloudJob } from "./cloud-dispatch";
import { transcribeViaInfra } from "./transcription";
import { optionalMediaKey, optionalString } from "./validation";

export const translationWorker: WorkerTask = async (input, ctx) => {
  const language = optionalString(input, "language");
  const targetLanguage =
    optionalString(input, "target_language") ?? optionalString(input, "targetLanguage");
  if (ctx.transcribeBaseUrl) {
    if (!targetLanguage) {
      throw new WorkerValidationError("translation requires target_language");
    }
    const filename = optionalString(input, "filename");
    const direct = input.file ?? input.audio;
    if (direct instanceof Uint8Array || direct instanceof ArrayBuffer) {
      const data = direct instanceof Uint8Array ? direct : new Uint8Array(direct);
      return transcribeViaInfra(ctx, { data, filename, language, targetLanguage });
    }
    const url = optionalMediaKey(input);
    if (!url) {
      throw new WorkerValidationError(
        "translation via the infra service requires media bytes (file) or an http mediaUrl",
      );
    }
    const fetchFn = ctx.fetchFn ?? fetch;
    const res = await fetchFn(url);
    if (!res.ok) throw new WorkerValidationError(`failed to fetch media from ${url}: ${res.status}`);
    return transcribeViaInfra(ctx, {
      data: new Uint8Array(await res.arrayBuffer()),
      filename,
      language,
      targetLanguage,
    });
  }
  const params: Record<string, unknown> = {
    ...input,
    language,
    target_language: targetLanguage,
  };
  return dispatchCloudJob(ctx, AI_CLOUD_JOB_KINDS.translation, params);
};
