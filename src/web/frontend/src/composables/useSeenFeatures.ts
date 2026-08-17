/**
 * "New feature" tracking for the config editor.
 *
 * A section whose key is absent from the config is *unset*, but that is not the
 * same as *new*: a mature config leaves many optional features unset on purpose,
 * and badging every one of them as New (the first cut did) is noise, not signal.
 *
 * New should mean "added since you last looked". So we snapshot the set of
 * feature keys the user has already seen, persisted in localStorage, and read
 * New against that snapshot — frozen once per app load so a badge does not
 * vanish mid-session. Visiting the editor commits the current keys, so on the
 * next load they are no longer new and only genuinely new schema additions
 * light up. The very first visit has an empty snapshot, so everything shows as
 * new once; that is acceptable and self-correcting.
 *
 * Keys are the schema's own feature keys, unscoped: "notifications" is the same
 * feature whether it appears globally or per guild, so seeing it once is enough.
 */

const STORAGE_KEY = "mcbot.config.seenFeatures.v1";

/** Frozen at first read, so a badge is stable for the whole session. */
let snapshot: Set<string> | null = null;

function loadStore(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveStore(seen: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    /* private mode / storage disabled: New simply never persists. */
  }
}

/** Has this feature key not been seen before this app load? */
export function isFeatureNew(key: string): boolean {
  if (snapshot === null) snapshot = loadStore();
  return !snapshot.has(key);
}

/** Record feature keys as seen, for the next visit (does not affect this one). */
export function commitSeenFeatures(keys: string[]): void {
  if (keys.length === 0) return;
  const store = loadStore();
  let changed = false;
  for (const key of keys) {
    if (!store.has(key)) {
      store.add(key);
      changed = true;
    }
  }
  if (changed) saveStore(store);
}
