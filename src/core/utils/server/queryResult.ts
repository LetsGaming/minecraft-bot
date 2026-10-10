/**
 * The answer to a question asked of the live server through the console.
 * A failure carries why, so a caller can say "the server could not be
 * reached" instead of guessing a default such as an overworld waypoint.
 */
export type QueryFailure =
  /** The command never reached the server. */
  | "unreachable"
  /** The named player is not online. */
  | "player-offline"
  /** The server answered that the value does not exist (no recorded death). */
  | "no-data"
  /** The server answered, or the log was read, but nothing parseable came back. */
  | "unreadable";

export type QueryResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: QueryFailure };

export function queryOk<T>(value: T): QueryResult<T> {
  return { ok: true, value };
}

export function queryFail<T = never>(reason: QueryFailure): QueryResult<T> {
  return { ok: false, reason };
}
