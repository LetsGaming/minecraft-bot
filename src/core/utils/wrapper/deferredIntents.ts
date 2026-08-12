/**
 * Actions someone tried to take while the wrapper was down.
 *
 * ── Why these are not queued ──
 *
 * Config edits queue safely because they are *declarative*: "engineMode should
 * be 3" is still true an hour later, so replaying it unattended does exactly
 * what the operator asked for.
 *
 * Control actions are *imperative*. "Restart" means restart now, in the
 * context the operator could see: who was online, what they had just changed,
 * whether they were watching. A restart that fires by itself three hours later
 * kicks players nobody warned, for a reason nobody remembers. `rollback` and a
 * backup restore are worse again — both destroy world state, and a rollback
 * queued at 14:00 and applied at 17:00 discards three hours of play that the
 * operator never intended to lose. A console command is worse still: "say
 * restarting in 5 minutes" replayed at 03:00 is a lie the bot tells on your
 * behalf.
 *
 * So the intent is remembered and the *action is not*. When the wrapper comes
 * back the dashboard offers a one-click retry, with a person present to decide
 * whether it is still what they want. That keeps the thing worth keeping — you
 * do not have to remember what you were doing — without ever firing a
 * destructive operation into an empty room.
 *
 * ── Why in memory, and why it expires ──
 *
 * Deliberately not durable. If the bot restarted, a pending "restart" is
 * already moot, and an intent surviving a deploy would be a prompt about a
 * situation nobody remembers. Intents also expire: being asked whether you
 * still want to restart something you tried three hours ago is noise, and
 * saying yes to it by reflex is exactly the accident this design avoids.
 */

/** Past this, an intent is no longer something anyone is still thinking about. */
const INTENT_TTL_MS = 30 * 60 * 1000;

export interface DeferredIntent {
  serverId: string;
  /** The operator action that could not run, e.g. "restart". */
  action: string;
  /** Human-readable target, when the action had one (a backup archive). */
  target?: string;
  attemptedAt: number;
  byTag: string;
  /** Why it could not run, kept for the tooltip. */
  reason: string;
}

/** One per (server, action): trying twice is one intent, not two. */
const intents = new Map<string, DeferredIntent>();

const keyOf = (serverId: string, action: string): string => `${serverId}::${action}`;

/**
 * Record that an action could not run.
 *
 * A repeat attempt refreshes the timestamp rather than stacking, because
 * pressing Restart twice during an outage is one wish expressed twice.
 */
export function recordIntent(intent: DeferredIntent): void {
  intents.set(keyOf(intent.serverId, intent.action), intent);
}

/** Intents still worth offering, newest first. Expired ones are dropped. */
export function listIntents(
  serverId: string,
  now: number = Date.now(),
): DeferredIntent[] {
  const live: DeferredIntent[] = [];
  for (const [key, intent] of intents) {
    if (intent.serverId !== serverId) continue;
    if (now - intent.attemptedAt > INTENT_TTL_MS) {
      intents.delete(key);
      continue;
    }
    live.push(intent);
  }
  return live.sort((a, b) => b.attemptedAt - a.attemptedAt);
}

/** Clear one intent: the operator retried it, or dismissed it. */
export function clearIntent(serverId: string, action: string): void {
  intents.delete(keyOf(serverId, action));
}

/** Test seam. */
export function resetIntents(): void {
  intents.clear();
}
