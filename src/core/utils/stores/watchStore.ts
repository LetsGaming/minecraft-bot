/**
 * /watch subscriptions, one-shot personal DMs, single owner of
 * kv_store["watches"] (data/bot.db).
 *
 *   kind "server": DM when the server comes back online (fired by the
 *                  downtime monitor's recovery branch)
 *   kind "player": DM when the player joins (fired by the join watcher)
 *
 * One-shot by design: a fired watch is removed, so nobody accumulates a
 * notification subscription they forgot about. Re-arm by running /watch
 * again. Store shape:
 *
 *   { "version": 1, "watches": [{ "id", "userId", "kind",
 *     "serverId", "player"?, "createdAt" }] }
 */
import { randomBytes } from "crypto";
import { versionedStore } from "./versionedStore.js";

/** Per-user cap so the file (and one user's DM burst) stays bounded. */
export const MAX_WATCHES_PER_USER = 10;

export type WatchKind = "server" | "player";

export interface Watch {
  id: string;
  userId: string;
  kind: WatchKind;
  serverId: string;
  /** Lowercased player name; only for kind "player". */
  player?: string;
  createdAt: number;
}

export interface WatchStore {
  version: 1;
  watches: Watch[];
}

const watchDoc = versionedStore<WatchStore>(
  "watches",
  { version: 1, container: "watches", kind: "array" },
  () => ({ version: 1, watches: [] }),
);

/** Read-only snapshot. To change watches use updateWatchStore or addWatch. */
export async function loadWatchStore(): Promise<WatchStore> {
  return watchDoc.load();
}

/** Change the watches in one transaction; see versionedStore. */
export function updateWatchStore<T>(fn: (store: WatchStore) => T): T {
  return watchDoc.update(fn);
}

export type AddWatchResult =
  | { status: "added"; watch: Watch }
  | { status: "duplicate"; watch: Watch }
  | { status: "limit" };

/** Same target (kind, server and, for player watches, name) for the same user. */
export function sameWatchTarget(a: Watch, b: Watch): boolean {
  return (
    a.userId === b.userId &&
    a.kind === b.kind &&
    a.serverId === b.serverId &&
    (a.kind === "server" || a.player === b.player)
  );
}

/**
 * Add a watch under the /watch rules, atomically: a user at
 * MAX_WATCHES_PER_USER is refused, and a duplicate target returns the
 * existing watch.
 */
export function addWatch(watch: Watch): AddWatchResult {
  return watchDoc.update((store) => {
    const owned = store.watches.filter((w) => w.userId === watch.userId);
    if (owned.length >= MAX_WATCHES_PER_USER) return { status: "limit" } as const;
    const existing = owned.find((w) => sameWatchTarget(w, watch));
    if (existing) return { status: "duplicate", watch: existing } as const;
    store.watches.push(watch);
    return { status: "added", watch } as const;
  });
}

export function newWatchId(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Remove-and-return every watch matching an event. Callers DM the
 * returned entries; the store is already saved without them (one-shot).
 */
export async function takeMatchingWatches(event: {
  kind: WatchKind;
  serverId: string;
  player?: string;
}): Promise<Watch[]> {
  const lowerPlayer = event.player?.toLowerCase();
  const matched: Watch[] = [];
  const isHit = (watch: Watch): boolean =>
    watch.kind === event.kind &&
    watch.serverId === event.serverId &&
    (watch.kind === "server" || watch.player === lowerPlayer);

  // Joins are frequent and almost never match: skip the write transaction.
  if (!watchDoc.load().watches.some(isHit)) return matched;

  // Atomic take: match + remove hold the write lock together, so two
  // concurrent events can never DM the same one-shot watch twice.
  watchDoc.update((store) => {
    const rest: Watch[] = [];
    for (const watch of store.watches) (isHit(watch) ? matched : rest).push(watch);
    store.watches = rest;
  });
  return matched;
}
