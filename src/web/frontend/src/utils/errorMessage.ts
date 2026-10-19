import { ApiError } from "../api";

function messageOfValue(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * A display string for a caught `unknown`. Reads Errors, strings and plain
 * objects with a string `message`. When there is no usable text it returns
 * `fallback`, or the stringified value if no fallback was given.
 */
export function errorMessage(err: unknown, fallback?: string): string {
  const text = messageOfValue(err);
  if (text) return text;
  if (fallback !== undefined) return fallback;
  return err instanceof Error ? "" : String(err);
}

/** Like `errorMessage`, but a failed request keeps its HTTP status in front: "404: not found". */
export function apiErrorText(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  return errorMessage(err, fallback);
}
