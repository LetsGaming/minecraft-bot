// ── Server actions ──────────────────────────────────────────────────────────
// The management scripts the setup suite installs, named once for every layer
// that reasons about them: capability detection, the RCON/script runner, the
// bot's /server subcommands, the dashboard's action route, and the Vue view's
// confirm step. Each of those used to carry its own copy — as a `Set` of
// literals, a `Record<string, …>`, or a bare `sub === "stop"` — which is how
// the dashboard's list quietly drifted out of sync with the runner's.

import { ServerState } from "./serverState.js";

/** Every management script the suite exposes. */
export const SERVER_SCRIPT_ACTIONS = [
  "start",
  "stop",
  "restart",
  "rollback",
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
  "rollback",
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
  "rollback",
] as const satisfies readonly ServerOperatorAction[];

/**
 * Actions that cannot be undone, so the confirm has to be more than an OK
 * button: both front-ends make the operator type the server's name.
 *
 * A rollback replaces the world from the suite's snapshot. "Restart" asks a
 * question the operator can answer wrong and recover from; this one they
 * cannot, so the two get different dialogs rather than the same one with
 * scarier wording.
 */
export const IRREVERSIBLE_SERVER_ACTIONS = [
  "rollback",
] as const satisfies readonly ServerOperatorAction[];

/** Does this action destroy state that cannot be recovered from the UI? */
export function isIrreversibleServerAction(value: string): boolean {
  return (IRREVERSIBLE_SERVER_ACTIONS as readonly string[]).includes(value);
}

/** Does this action interrupt players, warranting a confirm step? */
export function isDisruptiveServerAction(value: string): boolean {
  return (DISRUPTIVE_SERVER_ACTIONS as readonly string[]).includes(value);
}

/**
 * Whether an action is worth offering against a server in this state.
 *
 * The dashboard rendered every granted action as live regardless of state, so
 * a server sitting at 20 TPS still showed an enabled, primary-styled "Start"
 * — the one button on the card that could only fail. Offering an impossible
 * action is a state-visibility bug, not a permissions one: the operator reads
 * the button as an available choice and learns otherwise from an error toast.
 *
 * `Unknown` deliberately allows everything. We established nothing about the
 * server, and disabling the controls on ignorance would hide exactly the
 * buttons someone needs when a host is misbehaving.
 */
export function isActionApplicable(
  action: ServerOperatorAction,
  state: ServerState,
): boolean {
  if (state === ServerState.Unknown) return true;
  const running =
    state === ServerState.Online || state === ServerState.Unresponsive;
  switch (action) {
    // Nothing to start when it is already up.
    case "start":
      return !running;
    // Both need a live process to talk to.
    case "stop":
    case "restart":
      return running;
    // A world-file operation: it needs the server *stopped*, and the suite's
    // script stops it first, so it stays offered either way.
    case "rollback":
    case "backup":
      return true;
  }
}
