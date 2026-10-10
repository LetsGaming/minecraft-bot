/**
 * Stable machine-readable reasons carried in the `code` field of a dashboard
 * API error body. Clients branch on these (and on the HTTP status), never on
 * the human-readable message, which is free to change.
 */
export const ApiErrorCode = {
  BadRequest: "BAD_REQUEST",
  Unauthorized: "UNAUTHORIZED",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  ValidationFailed: "VALIDATION_FAILED",
  RateLimited: "RATE_LIMITED",
  Unavailable: "UNAVAILABLE",
  BadGateway: "BAD_GATEWAY",
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
