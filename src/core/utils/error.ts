/**
 * Turning an unknown throw into something loggable.
 *
 * `catch` binds `unknown`, so every call site has to narrow before it can
 * log — and this repo did, 107 times, with the same ternary. One copy
 * means the awkward cases can be handled once instead of never:
 * an AggregateError stringifies to "AggregateError" without its
 * `errors`, and a thrown plain object to "[object Object]", both of which
 * are useless in a log line.
 *
 * Dependency-free on purpose: this sits below the logger so anything,
 * including modules the logger itself uses, can call it.
 */

/** Best available human-readable message for anything a `catch` can bind. */
export function errMsg(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map(errMsg).filter(Boolean).join("; ");
    return inner ? `${err.message}: ${inner}` : err.message;
  }
  if (err instanceof Error) {
    // Fetch and node:sqlite wrap the useful part in `cause`.
    const cause =
      err.cause !== undefined && err.cause !== null
        ? ` (cause: ${errMsg(err.cause)})`
        : "";
    return `${err.message}${cause}`;
  }
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return String(err);

  // A thrown object: String() would give "[object Object]".
  if (typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    try {
      return JSON.stringify(err) ?? String(err);
    } catch {
      return String(err); // circular, getters that throw, …
    }
  }
  return String(err);
}

/**
 * A failure meant for the person who ran a command: the problem, an optional
 * next step and an optional title naming the failed action. The command
 * wrapper renders it as problem plus recovery; `message` is the problem, so
 * anything that only logs it still reads well.
 */
export class CommandError extends Error {
  readonly title?: string;
  readonly problem: string;
  readonly recovery?: string;

  constructor(content: { title?: string; problem: string; recovery?: string }) {
    super(content.problem);
    this.name = "CommandError";
    this.title = content.title;
    this.problem = content.problem;
    this.recovery = content.recovery;
  }
}
