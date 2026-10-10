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
 * Bumped whenever a key is invalidated. A refresh remembers the value it
 * started under and only stores its result if it is unchanged, so a read that
 * began before an invalidation cannot write its stale value back afterwards.
 */
const generations = new Map<string, number>();

function bump(key: string): void {
  generations.set(key, (generations.get(key) ?? 0) + 1);
  store.delete(key);
  inFlight.delete(key);
}

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
      const startedAt = generations.get(key) ?? 0;
      const started: Promise<T> = read()
        .then((value) => {
          if ((generations.get(key) ?? 0) === startedAt) {
            store.set(key, { value, at: Date.now() });
          }
          return value;
        })
        .finally(() => {
          if (inFlight.get(key) === started) inFlight.delete(key);
        });
      promise = started;
      inFlight.set(key, started);
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
  bump(key);
}

/** Drop every key under a prefix (e.g. all of one server's cached reads). */
export function invalidatePrefix(prefix: string): void {
  invalidateWhere((key) => key.startsWith(prefix));
}

/** Drop every cached key (and any shared in-flight load) the predicate selects. */
export function invalidateWhere(predicate: (key: string) => boolean): void {
  const keys = new Set([...store.keys(), ...inFlight.keys()]);
  for (const key of keys) if (predicate(key)) bump(key);
}
