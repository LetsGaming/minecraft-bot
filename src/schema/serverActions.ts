// ── Server actions ──────────────────────────────────────────────────────────
// The management scripts the setup suite installs, named once for every layer
// that reasons about them: capability detection, the RCON/script runner, the
// bot's /server subcommands, the dashboard's action route, and the Vue view's
// confirm step. Each of those used to carry its own copy — as a `Set` of
// literals, a `Record<string, …>`, or a bare `sub === "stop"` — which is how
// the dashboard's list quietly drifted out of sync with the runner's.

/** Every management script the suite exposes. */
export const SERVER_SCRIPT_ACTIONS = [
  "start",
  "stop",
  "restart",
  "backup",
  "status",
] as const;

export type ServerScriptAction = (typeof SERVER_SCRIPT_ACTIONS)[number];

/**
 * The subset an operator can trigger from the bot or the dashboard.
 * `status` is deliberately absent: it's a read, served by the status
 * endpoints, not a state change.
 */
export const SERVER_OPERATOR_ACTIONS = [
  "start",
  "stop",
  "restart",
  "backup",
] as const satisfies readonly ServerScriptAction[];

export type ServerOperatorAction = (typeof SERVER_OPERATOR_ACTIONS)[number];

/** Type guard: may this string be run as an operator action? */
export function isServerOperatorAction(
  value: string,
): value is ServerOperatorAction {
  // Widen the const tuple to readonly string[] so .includes accepts an
  // arbitrary string (TS otherwise restricts the arg to the literal union).
  return (SERVER_OPERATOR_ACTIONS as readonly string[]).includes(value);
}

/**
 * Actions that interrupt play, so both front-ends confirm before running
 * them. Naming the set here keeps the bot's prompt and the dashboard's
 * dialog agreeing on which actions are worth a second look.
 */
export const DISRUPTIVE_SERVER_ACTIONS = [
  "stop",
  "restart",
] as const satisfies readonly ServerOperatorAction[];

/** Does this action interrupt players, warranting a confirm step? */
export function isDisruptiveServerAction(value: string): boolean {
  return (DISRUPTIVE_SERVER_ACTIONS as readonly string[]).includes(value);
}
