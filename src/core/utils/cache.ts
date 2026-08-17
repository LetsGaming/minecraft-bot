/**
 * A small time-to-live cache for reads that go through an external API.
 *
 * `lastKnown` already keeps the last *successful* read so a wrapper outage
 * degrades to stale-with-a-date instead of a 502. It does not stop the fetch:
 * every call still hits the wrapper (or Modrinth), which is the wrong load
 * profile for data that barely changes and for a third party that rate-limits.
 *
 * This closes that gap. A value read here is served from memory until it ages
 * past its TTL, so a burst of dashboard requests — a page mount, a re-render, a
 * second admin on the same server — collapses to one upstream call. It is a
 * freshness cache, not a fallback cache: past the TTL the next caller fetches,
 * and any error propagates (wrap with `readThrough` when a stale fallback is
 * also wanted; the two compose).
 *
 * Process-local and unbounded in time but bounded in keys (one per resource),
 * so it grows with the deployment, not with traffic, and nothing survives a
 * restart. A mutation invalidates the keys it affects; see `invalidate`.
 */

interface Entry {
  value: unknown;
  at: number;
}

const store = new Map<string, Entry>();

/**
 * Return the cached value for `key` if it is younger than `ttlMs`, otherwise
 * run `read`, cache the result, and return it. Errors are not cached.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  read: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) {
    return hit.value as T;
  }
  const value = await read();
  store.set(key, { value, at: now });
  return value;
}

/** Drop one key, so the next read fetches fresh (after a mutation). */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Drop every key under a prefix (e.g. all of one server's cached reads). */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
