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
  /** The bot has no Discord token configured, so Discord cannot be read. */
  DiscordTokenMissing: "DISCORD_TOKEN_MISSING",
  /** Discord answered 401: the configured bot token is wrong or was reset. */
  DiscordTokenRejected: "DISCORD_TOKEN_REJECTED",
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * The body of every error response: the human-readable message, the stable
 * code when the failure has one, and whatever extra fields the route attached
 * (a validation list, the hash a conflicting write lost to).
 */
export interface ApiErrorBody {
  error: string;
  code?: ApiErrorCode;
}
