/**
 * Last-known values for reads that go through the API wrapper.
 *
 * Lives in core so both consumers share one fallback: the dashboard's routes
 * and the bot's own commands. A `/status` in Discord and a status card in the
 * web UI should degrade the same way when the wrapper is away, because they
 * are answering the same question against the same wrapper — the only thing
 * that ever differed was which of them happened to cache the last good read.
 *
 * The wrapper is a separate process on the Minecraft host: it gets restarted,
 * updated, rate-limited, or briefly wedged. Every read that goes through it
 * used to answer with a hard failure in that window, so the caller simply lost
 * the data — at the exact moment someone was most likely trying to find out
 * what was wrong.
 *
 * The data was not gone. It had been read successfully thirty seconds earlier,
 * and for a config file or a backup index thirty seconds is nothing. Serving
 * it, clearly labelled with when it was true, is better than serving an error:
 * an operator can read a stale config, compare it against what they expected,
 * and decide what to do. They can do none of that with a 502.
 *
 * Two rules make this honest rather than merely convenient:
 *
 *   1. A cache entry is only written after a *successful* read. Nothing here
 *      is ever inferred, defaulted, or reconstructed.
 *   2. A stale answer always carries `asOf`, and the UI always says so. Silent
 *      staleness would be worse than the 502 it replaces — an operator acting
 *      on data they believe is live is the failure mode this must not create.
 *
 * Writes are deliberately NOT covered. Queuing a mutation until the wrapper
 * returns needs a conflict policy (the file can change on disk while an edit
 * waits), and that is a separate piece of work.
 */

import type { StaleInfo } from "@mcbot/schema/contract.js";

/**
 * How long a value stays servable after its last successful read.
 *
 * Generous on purpose. The alternative to a four-hour-old config listing is
 * not a fresh one, it is a 502, and a listing of which files exist changes far
 * more slowly than that. Past the window the entry is dropped and callers get
 * the real error, because at some point "last known" stops being information
 * and starts being archaeology.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface Entry {
  value: unknown;
  storedAt: number;
}

/**
 * Process-local and deliberately unbounded in time but bounded in keys: one
 * entry per (server, resource), so it grows with the deployment rather than
 * with traffic. Nothing here survives a restart, which is correct — a fresh
 * process has never successfully read anything and should not pretend it has.
 */
const entries = new Map<string, Entry>();

function keyOf(serverId: string, resource: string): string {
  return `${serverId}::${resource}`;
}

/** Record a value that was genuinely just read from the wrapper. */
export function remember(serverId: string, resource: string, value: unknown): void {
  entries.set(keyOf(serverId, resource), { value, storedAt: Date.now() });
}

export interface Recalled<T> {
  value: T;
  stale: StaleInfo;
}

/**
 * The last value we successfully read, if one is still within the window.
 *
 * Returns undefined when nothing was ever read or the entry has aged out —
 * both cases mean the caller should surface the real failure, because an
 * error is the honest answer when there is genuinely nothing to show.
 */
export function recall<T>(
  serverId: string,
  resource: string,
  reason: string,
  now: number = Date.now(),
): Recalled<T> | undefined {
  const key = keyOf(serverId, resource);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (now - entry.storedAt > MAX_AGE_MS) {
    entries.delete(key);
    return undefined;
  }
  return {
    value: entry.value as T,
    stale: { asOf: entry.storedAt, reason },
  };
}

/**
 * Read through the wrapper, falling back to the last known value.
 *
 * The shape every caller wants: try live, remember success, and on failure
 * hand back what we had rather than nothing. The failure is rethrown when
 * there is no fallback, so a first-ever read of an unreachable server still
 * reports the problem instead of inventing an empty result.
 */
export async function readThrough<T>(
  serverId: string,
  resource: string,
  read: () => Promise<T>,
): Promise<{ value: T; stale: StaleInfo | null }> {
  try {
    const value = await read();
    remember(serverId, resource, value);
    return { value, stale: null };
  } catch (err) {
    const fallback = recall<T>(
      serverId,
      resource,
      err instanceof Error ? err.message : String(err),
    );
    if (!fallback) throw err;
    return { value: fallback.value, stale: fallback.stale };
  }
}

/** Drop everything for a server. Used after a write, so the next read is live. */
export function forget(serverId: string, resource?: string): void {
  if (resource) {
    entries.delete(keyOf(serverId, resource));
    return;
  }
  for (const key of entries.keys()) {
    if (key.startsWith(`${serverId}::`)) entries.delete(key);
  }
}

/** Test seam: drop every entry. */
export function clearLastKnown(): void {
  entries.clear();
}
