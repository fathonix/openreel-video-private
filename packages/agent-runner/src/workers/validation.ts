import { WorkerValidationError } from "./types";

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkerValidationError(`missing or invalid string param: ${key}`);
  }
  return value;
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function requireNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkerValidationError(`missing or invalid number param: ${key}`);
  }
  return value;
}

export function requireEnum(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): string {
  const value = requireString(input, key);
  if (!allowed.includes(value)) {
    throw new WorkerValidationError(`param ${key} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

const MEDIA_KEYS = ["mediaKey", "mediaUrl", "media_url", "media_key"] as const;

export function requireMediaKey(input: Record<string, unknown>): string {
  for (const key of MEDIA_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new WorkerValidationError(
    `this GPU kind requires media: provide one of ${MEDIA_KEYS.join(", ")}`,
  );
}

export function optionalMediaKey(input: Record<string, unknown>): string | undefined {
  for (const key of MEDIA_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
