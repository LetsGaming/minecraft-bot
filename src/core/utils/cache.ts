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
 * freshness cache, not a fallback cache: past `staleMs` the next caller fetches
 * and any error propagates (wrap with `readThrough`/`lastKnown` when a stale
 * fallback on *error* is also wanted; the two compose, deliberately kept
 * separate rather than merged into this one).
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
/** One shared load per key, so N concurrent misses cost one `read()`. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Return the cached value for `key` if it is younger than `ttlMs`; if it is
 * older but younger than `staleMs` (default: same as `ttlMs`, meaning no
 * stale-while-revalidate), serve it immediately while a refresh runs in the
 * background for the next caller. Otherwise run `read()` — shared by every
 * concurrent caller currently missing on this key — cache the result, and
 * return it. Errors are not cached and are not swallowed.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  read: () => Promise<T>,
  staleMs: number = ttlMs,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) {
    return hit.value as T;
  }

  function refresh(): Promise<T> {
    let promise = inFlight.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = read()
        .then((value) => {
          store.set(key, { value, at: Date.now() });
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, promise);
    }
    return promise;
  }

  // A refresh is already running and the stale value is still within its
  // grace window: answer now rather than waiting on the same round-trip.
  if (hit && inFlight.has(key) && now - hit.at < staleMs) {
    return hit.value as T;
  }
  if (hit && now - hit.at < staleMs) {
    void refresh();
    return hit.value as T;
  }
  return refresh();
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
