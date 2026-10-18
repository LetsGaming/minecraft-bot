/**
 * The wrapper answers 423 while another operation holds the instance. The
 * dashboard reports that as a 409 naming what holds it.
 */
import { ApiError } from "@mcbot/core/utils/server/access/apiClient.js";
import { isRecord } from "@mcbot/core/utils/objects.js";
import { Conflict } from "../errors.js";

const UNKNOWN_HOLDER = "another operation";

/** What holds the instance, from a 423 error message; "another operation" when it cannot be read. */
export function busyKind(message: string): string {
  const start = message.indexOf("{");
  if (start === -1) return UNKNOWN_HOLDER;
  try {
    const parsed: unknown = JSON.parse(message.slice(start));
    if (isRecord(parsed) && isRecord(parsed.busy) && typeof parsed.busy.kind === "string") {
      return parsed.busy.kind;
    }
  } catch {
    /* fall through */
  }
  return UNKNOWN_HOLDER;
}

/** The 409 for a wrapper 423, or null when `err` is something else. */
export function busyConflict(err: unknown): Conflict | null {
  if (!(err instanceof ApiError) || err.status !== 423) return null;
  return new Conflict(
    `The server is busy (${busyKind(err.message)}). Try again when it has finished.`,
  );
}
