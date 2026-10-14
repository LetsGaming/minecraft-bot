/**
 * How a failed script or restore call is answered (AUD-012).
 *
 * Every failure used to be reported as "the wrapper did not answer, so it
 * did not run" and offered back as a one-click retry, including a backup or
 * restore still running on the host after we stopped waiting, and a refusal
 * the wrapper did answer with. A retry then started the operation twice.
 * Only a wrapper that did not answer at all is remembered for a retry.
 */
import type { ScriptFailure } from "@mcbot/core/utils/server/serverAccess.js";
import { HttpError } from "../errors.js";

/**
 * The wrapper's reason, when it is safe to show: it explains a refusal
 * ("another operation is running"), but an answer that names a path stays
 * in the log (paths never reach the browser).
 */
function shownReason(message: string): string {
  return /[\\/]/.test(message) || message.trim() === "" ? "the server refused it" : message;
}

export function scriptFailureError(
  action: string,
  failure: Exclude<ScriptFailure, { kind: "unreachable" }>,
): HttpError {
  if (failure.kind === "still-running") {
    return new HttpError(
      504,
      `"${action}" is still running on the server, the dashboard stopped waiting for it. Check the server status before starting it again.`,
    );
  }
  if (failure.status === 409) {
    return new HttpError(409, `"${action}" did not start: ${shownReason(failure.message)}`);
  }
  if (failure.status === 429) {
    return new HttpError(429, `The server's API is rate limiting requests, so "${action}" did not start. Try again in a moment.`);
  }
  if (failure.status >= 400 && failure.status < 500) {
    return new HttpError(400, `The server refused "${action}": ${shownReason(failure.message)}`);
  }
  return new HttpError(
    502,
    `The server reported an error while running "${action}"; it may have stopped part way. Check the server before trying again.`,
  );
}
