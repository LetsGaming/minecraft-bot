// One place to turn a caught `unknown` into a display string, instead of the
// unsafe `(err as Error).message` repeated across every catch block. A thrown
// value isn't guaranteed to be an Error, so this narrows before reading.

/** Extract a human-readable message from an unknown caught value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * The backend surfaces validation failures as a JSON array string (starting
 * with "["). Parse that into a string[], falling back to the raw message when
 * it isn't a clean array of strings — so a non-conforming payload is shown to
 * the user rather than throwing.
 */
export function parseErrorList(message: string): string[] {
  if (!message.startsWith("[")) return [message];
  try {
    const parsed: unknown = JSON.parse(message);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    /* not valid JSON — fall through to the raw message */
  }
  return [message];
}
