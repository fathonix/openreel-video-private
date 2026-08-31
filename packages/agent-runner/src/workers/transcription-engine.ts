import { env, pipeline } from "@huggingface/transformers";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function ffmpegBinaryPath(): string {
  const fromEnv = process.env.OPENREEL_FFMPEG_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return require("ffmpeg-static") as string;
}

const MODEL_HOST =
  process.env.OPENREEL_WHISPER_MODEL_HOST ??
  "https://media.openreel.video/models/";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = MODEL_HOST;
env.remotePathTemplate = "{model}/resolve/{revision}/";

export type WhisperModelKey = "accurate" | "fast";

const WHISPER_MODEL_IDS: Record<WhisperModelKey, string> = {
  accurate: "onnx-community/whisper-large-v3-turbo_timestamped",
  fast: "onnx-community/whisper-tiny_timestamped",
};

export const DEFAULT_WHISPER_MODEL: WhisperModelKey = "accurate";

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscribeEngineOptions {
  audio: Float32Array;
  language?: string;
  targetLanguage?: string;
  model?: WhisperModelKey;
  onProgress?: (progress: number) => void;
}

export interface TranscribeEngineResult {
  text: string;
  words: WhisperWord[];
  language: string;
  duration: number;
}

interface WhisperChunk {
  text: string;
  timestamp: [number | null, number | null];
}

interface WhisperOutput {
  text: string;
  chunks?: WhisperChunk[];
}

type WhisperPipeline = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<WhisperOutput | WhisperOutput[]>;

const createPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: Record<string, unknown>,
) => Promise<WhisperPipeline>;

let transcriberPromise: Promise<WhisperPipeline> | null = null;

function getTranscriber(
  model: WhisperModelKey,
  onProgress?: (progress: number) => void,
): Promise<WhisperPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = createPipeline("automatic-speech-recognition", WHISPER_MODEL_IDS[model], {
      device: "cpu",
      dtype: "q4",
      progress_callback: (event: Record<string, unknown>) => {
        if (typeof event.progress === "number") onProgress?.(event.progress);
      },
    });
    transcriberPromise.catch(() => {
      transcriberPromise = null;
    });
  }
  return transcriberPromise;
}

export async function transcribeAudio(
  options: TranscribeEngineOptions,
): Promise<TranscribeEngineResult> {
  const transcriber = await getTranscriber(options.model ?? DEFAULT_WHISPER_MODEL, options.onProgress);
  const output = await transcriber(options.audio, {
    language: options.language,
    task: options.targetLanguage === "en" ? "translate" : "transcribe",
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const result = Array.isArray(output) ? output[0] : output;
  const words: WhisperWord[] = (result.chunks ?? [])
    .filter((chunk) => chunk.timestamp[0] !== null && chunk.timestamp[1] !== null)
    .map((chunk) => ({
      word: chunk.text.trim(),
      start: Math.round((chunk.timestamp[0] as number) * 100) / 100,
      end: Math.round((chunk.timestamp[1] as number) * 100) / 100,
    }));
  return {
    text: result.text,
    words,
    language: options.language ?? "",
    duration: Math.round(options.audio.length / 16000 * 100) / 100,
  };
}

export async function decodeAudioToFloat32(input: Uint8Array): Promise<Float32Array> {
  const wav = await runFFmpegDecode(input);
  return wavToFloat32(wav);
}

function runFFmpegDecode(input: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegBinaryPath(),
      ["-y", "-i", "pipe:0", "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on("error", (error) =>
      reject(new Error(`ffmpeg failed to start: ${error.message}`)),
    );
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdin.end(Buffer.from(input));
  });
}

export function wavToFloat32(wav: Uint8Array): Float32Array {
  if (
    wav.length < 44 ||
    wav[0] !== 0x52 ||
    wav[1] !== 0x49 ||
    wav[2] !== 0x46 ||
    wav[3] !== 0x46
  ) {
    throw new Error("not a RIFF/WAVE file");
  }
  const audioFormat = wav[20] | (wav[21] << 8);
  const channels = wav[22] | (wav[23] << 8);
  const bitsPerSample = wav[34] | (wav[35] << 8);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(`expected 16-bit mono PCM WAV (got format=${audioFormat}, channels=${channels}, bits=${bitsPerSample})`);
  }
  let dataOffset = 12;
  let dataSize = 0;
  while (dataOffset + 8 <= wav.length) {
    const chunkSize = (wav[dataOffset + 4] | (wav[dataOffset + 5] << 8) | (wav[dataOffset + 6] << 16) | (wav[dataOffset + 7] << 24)) >>> 0;
    if (wav[dataOffset] === 0x64 && wav[dataOffset + 1] === 0x61 && wav[dataOffset + 2] === 0x74 && wav[dataOffset + 3] === 0x61) {
      dataOffset += 8;
      dataSize = chunkSize === 0xffffffff ? wav.length - dataOffset : chunkSize;
      break;
    }
    dataOffset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataSize === 0) throw new Error("WAV has no data chunk");
  const samples = new Float32Array(Math.floor(dataSize / 2));
  for (let i = 0; i < samples.length; i++) {
    const byte = wav[dataOffset + i * 2] | (wav[dataOffset + i * 2 + 1] << 8);
    samples[i] = (byte >= 32768 ? byte - 65536 : byte) / 32768;
  }
  return samples;
}

export function wordsToVtt(words: WhisperWord[]): string {
  const lines = ["WEBVTT", ""];
  for (const word of words) {
    lines.push(`${formatTimestamp(word.start)} --> ${formatTimestamp(word.end)}`);
    lines.push(word.word);
    lines.push("");
  }
  return lines.join("\n");
}

function formatTimestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const millis = Math.round((seconds - whole) * 1000);
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(millis, 3)}`;
}