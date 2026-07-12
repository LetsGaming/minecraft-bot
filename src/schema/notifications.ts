// ── Notification events ─────────────────────────────────────────────────────
// The single source of truth for the keys a guild's `notifications.events`
// list may contain, shared by every layer that touches them:
//   - the dispatcher (broadcastNotification) filters each event against the
//     guild's list, falling back to DEFAULT_NOTIFICATION_EVENTS when unset,
//   - the setup wizard seeds DEFAULT_NOTIFICATION_EVENTS for a new guild,
//   - the config validator warns on an unknown key or an empty selection.
// Adding a new broadcastable event means adding its key here once; every
// consumer then agrees on the name and the generated JSON Schema (and the
// dashboard editor built from it) picks it up.

/** Every event key a `notifications.events` entry may name. */
export const NOTIFICATION_EVENTS = [
  "join",
  "leave",
  "death",
  "advancement",
  "challenge",
  "milestone",
  "start",
  "stop",
  "scheduledRestart",
] as const;

/** One of the broadcastable notification event keys. */
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Type guard: is an arbitrary string a known notification event key? */
export function isNotificationEvent(value: string): value is NotificationEvent {
  // Widen the const tuple to readonly string[] so .includes accepts an
  // arbitrary string (TS otherwise restricts the arg to the literal union).
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

/**
 * Events a guild receives when it doesn't choose its own set — the six the
 * setup wizard writes and the template/docs document. `challenge`,
 * `milestone`, and `scheduledRestart` are opt-in extras a user adds
 * deliberately, so they stay out of the default.
 *
 * This is also what the dispatcher treats an *absent* `events` field as, so a
 * guild configured with only a channel (e.g. by the wizard before this
 * default existed) still receives the common events instead of silently
 * nothing.
 */
export const DEFAULT_NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  "join",
  "leave",
  "death",
  "advancement",
  "start",
  "stop",
];
