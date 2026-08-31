import { AI_CLOUD_JOB_KINDS } from "@openreel/core/ai/cloud-job-types";
import { dispatchCloudJob } from "./cloud-dispatch";
import { WorkerValidationError } from "./types";
import type { WorkerTask, WorkerTaskContext } from "./types";
import { optionalString } from "./validation";
import { decodeAudioToFloat32, transcribeAudio, wordsToVtt } from "./transcription-engine";
import { hasLocalMedia } from "./transcription";

export const translationWorker: WorkerTask = async (input, ctx) => {
  const language = optionalString(input, "language");
  const targetLanguage =
    optionalString(input, "target_language") ?? optionalString(input, "targetLanguage");
  if (!targetLanguage) {
    throw new WorkerValidationError("translation requires target_language");
  }

  if (!hasLocalMedia(input)) {
    const params: Record<string, unknown> = {
      ...input,
      language,
      target_language: targetLanguage,
    };
    return dispatchCloudJob(ctx, AI_CLOUD_JOB_KINDS.translation, params);
  }

  if (targetLanguage !== "en") {
    throw new WorkerValidationError(
      'local translation supports target_language "en" only (Whisper translate task)',
    );
  }

  try {
    const bytes = await resolveLocalBytes(input, ctx);
    const audio = await decodeAudioToFloat32(bytes);
    const model = optionalString(input, "model") === "fast" ? "fast" : undefined;
    const result = await transcribeAudio({ audio, language, targetLanguage, model });
    return {
      ok: true,
      data: { ...result, vtt: wordsToVtt(result.words) },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

async function resolveLocalBytes(
  input: Record<string, unknown>,
  ctx: WorkerTaskContext,
): Promise<Uint8Array> {
  const direct = input.file ?? input.audio;
  if (direct instanceof Uint8Array) return direct;
  if (direct instanceof ArrayBuffer) return new Uint8Array(direct);
  const mediaUrl = optionalString(input, "mediaUrl") ?? optionalString(input, "media_url");
  if (mediaUrl) {
    const fetchFn = ctx.fetchFn ?? fetch;
    const res = await fetchFn(mediaUrl);
    if (!res.ok) throw new WorkerValidationError(`failed to fetch media from ${mediaUrl}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new WorkerValidationError("translation requires media bytes or an http mediaUrl");
}