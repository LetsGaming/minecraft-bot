/**
 * Single owner of daily-reward persistence: claim data in
 * kv_store["claimedDaily"], the offline-delivery queue in
 * kv_store["pendingRewards"], plus the rewards config re-exported from
 * rewardsConfig.ts. Commands never open-code these keys.
 *
 * Claims are stored per server:
 *
 *   { "version": 2, "servers": { "<serverId>": { "<discordUserId>": {…} } } }
 *
 * so cooldowns, streaks, and reminder opt-ins are independent between
 * servers. An old flat store (one userId→claim map) is migrated on first
 * load: everything moves under the first configured server.
 */
import { log } from "../logger.js";
import type { DailyRewardItem, UserClaimData } from "../../types/index.js";
import { kvGet } from "../../db/kv.js";
import { isVersionedDoc, versionedStore } from "./versionedStore.js";
import { createRecord, ownGet, ownSet, toRecord } from "./safeRecord.js";

// The reward documents themselves (shared pool, per-server overrides) live
// in rewardsConfig.ts; re-exported here so callers keep one import.
export {
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  rewardPoolForServer,
  type ResolvedRewardPool,
} from "./rewardsConfig.js";

export type ClaimedDailyMap = Record<string, UserClaimData>;

export interface ClaimedDailyStore {
  version: 2;
  /** serverId → userId → claim record */
  servers: Record<string, ClaimedDailyMap>;
}

// Load errors are deliberately not swallowed here: turning a corrupt store
// into {} would wipe everyone's streaks on the next save.

const CLAIMED_SHAPE = { version: 2, container: "servers" } as const;

const claimedDoc = versionedStore<ClaimedDailyStore>(
  "claimedDaily",
  CLAIMED_SHAPE,
  () => ({ version: 2, servers: {} }),
);

export async function loadClaimedStore(): Promise<ClaimedDailyStore> {
  const raw = kvGet<Record<string, unknown>>("claimedDaily") ?? {};

  if (isVersionedDoc<ClaimedDailyStore>(raw, CLAIMED_SHAPE)) return raw;

  const legacyEntries = Object.entries(raw);
  if (legacyEntries.length === 0) {
    return { version: 2, servers: {} };
  }

  // Old format: a flat userId→claim map with no server dimension. Move
  // everything under the first configured server. Lazy import so the
  // config chain is only pulled in for this one-time path.
  const { getServerIds } = await import("../../config.js");
  const target = getServerIds()[0] ?? "default";
  log.warn(
    "daily",
    `Migrating the claim store to the per-server format (v2): ` +
      `${legacyEntries.length} user record(s) → server "${target}". ` +
      `Streaks and cooldowns are now tracked per server.`,
  );

  const store: ClaimedDailyStore = {
    version: 2,
    // The pre-v2 format was exactly a userId→claim map, i.e. a
    // ClaimedDailyMap, so reinterpreting the flat `raw` as one is the
    // format upgrade. This path runs once and is then persisted.
    servers: { [target]: raw as ClaimedDailyMap },
  };
  claimedDoc.save(store); // persist so the migration never re-runs
  return store;
}

/** Claims for one server; creates the map lazily so callers can mutate. */
export function getServerClaims(
  store: ClaimedDailyStore,
  serverId: string,
): ClaimedDailyMap {
  return (store.servers[serverId] ??= {});
}

/**
 * Change the claim store in one transaction. `fn` gets the store as it is
 * stored right now, mutates only what it means to change, and its return
 * value is handed back. Use this instead of load, await, save, which writes a
 * stale snapshot over every change made during the await (another user's
 * claim, a reminder flag).
 */
export async function updateClaimedStore<T>(
  fn: (store: ClaimedDailyStore) => T,
): Promise<T> {
  await loadClaimedStore(); // runs the one-time v1 → v2 migration first
  return claimedDoc.update(fn);
}

// ── Offline-claim delivery queue ──────────────────────────────────────────
//
// Offline claims record the claim (streak logic untouched), roll the reward,
// and queue it here; the joinLeave watcher delivers on the next join through
// the give() path, removing entries on confirmed success and keeping them on
// failure.

/**
 * Queue cap per player and server, so the queue cannot become free item
 * storage. A full queue rejects further offline claims WITHOUT consuming
 * the cooldown: the user can claim online or after the next delivery.
 */
export const MAX_PENDING_PER_PLAYER = 3;

/**
 * Join-time delivery runs an entry may fail without the server rejecting its
 * items before the rest of it moves to the failed list.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Failed entries kept per player; the oldest drop first. */
export const MAX_FAILED_PER_PLAYER = 20;

export interface PendingRewardEntry {
  /** Discord user the claim belongs to ("" for system rewards, e.g. challenge bonuses). */
  discordId: string;
  items: DailyRewardItem[];
  queuedAt: number;
  /** Items from a claim that was already consumed but could not all be handed over. */
  owed?: boolean;
  /** Delivery runs that left items undelivered without the server rejecting them. */
  attempts?: number;
}

/** Items that will not be retried: the server rejected them, or delivery kept failing. */
export interface FailedRewardEntry {
  discordId: string;
  items: DailyRewardItem[];
  queuedAt: number;
  failedAt: number;
  /** `rejected`: the server refused the item. `attempts`: delivery kept failing. */
  reason: "rejected" | "attempts";
}

/** serverId → lowercased MC name → queued entries (oldest first) */
export type ServerPendingMap = Record<string, PendingRewardEntry[]>;

/** serverId → lowercased MC name → failed entries (oldest first) */
export type ServerFailedMap = Record<string, FailedRewardEntry[]>;

export interface PendingRewardsStore {
  version: 1;
  servers: Record<string, ServerPendingMap>;
  /** Created on the first failure, so a store without one stays as it was. */
  failed?: Record<string, ServerFailedMap>;
}

// Player names key these maps, so they have no prototype (see safeRecord).
const pendingDoc = versionedStore<PendingRewardsStore>(
  "pendingRewards",
  { version: 1, container: "servers" },
  () => ({ version: 1, servers: createRecord() }),
  (doc) => {
    doc.servers = toRecord(doc.servers);
    for (const serverId of Object.keys(doc.servers)) {
      doc.servers[serverId] = toRecord(doc.servers[serverId]!);
    }
    if (doc.failed) {
      doc.failed = toRecord(doc.failed);
      for (const serverId of Object.keys(doc.failed)) {
        doc.failed[serverId] = toRecord(doc.failed[serverId]!);
      }
    }
    return doc;
  },
);

export async function loadPendingRewards(): Promise<PendingRewardsStore> {
  return pendingDoc.load();
}

/** Change the pending-rewards queue in one transaction; see updateClaimedStore. */
export async function updatePendingRewards<T>(
  fn: (store: PendingRewardsStore) => T,
): Promise<T> {
  return pendingDoc.update(fn);
}

/** Pending entries for one server; created lazily so callers can mutate. */
export function getServerPending(
  store: PendingRewardsStore,
  serverId: string,
): ServerPendingMap {
  let map = ownGet(store.servers, serverId);
  if (!map) {
    map = createRecord<PendingRewardEntry[]>();
    ownSet(store.servers, serverId, map);
  }
  return map;
}

/** Failed entries for one server; created lazily so callers can mutate. */
export function getServerFailed(
  store: PendingRewardsStore,
  serverId: string,
): ServerFailedMap {
  const failed = (store.failed ??= createRecord());
  let map = ownGet(failed, serverId);
  if (!map) {
    map = createRecord<FailedRewardEntry[]>();
    ownSet(failed, serverId, map);
  }
  return map;
}

/** Whether anything is queued for the player; a read that stays off the write lock. */
export async function hasPending(
  serverId: string,
  player: string,
): Promise<boolean> {
  const queue = ownGet(pendingDoc.load().servers, serverId);
  return (ownGet(queue ?? {}, player.toLowerCase())?.length ?? 0) > 0;
}

/**
 * Queue an entry for the player's next join. With `cap`, a full queue
 * refuses (returns null) and nothing is written; `counts` narrows which
 * waiting entries use up the cap (default: all). Returns how many entries now
 * wait, counted the same way as the cap, so a shown "n/cap" matches the cap.
 */
export async function enqueuePending(
  serverId: string,
  player: string,
  entry: PendingRewardEntry,
  options: { cap?: number; counts?: (entry: PendingRewardEntry) => boolean } = {},
): Promise<number | null> {
  const key = player.toLowerCase();
  return updatePendingRewards((store) => {
    const queue = getServerPending(store, serverId);
    const list = ownGet(queue, key) ?? [];
    const used = options.counts ? list.filter(options.counts).length : list.length;
    if (options.cap !== undefined && used >= options.cap) return null;
    list.push(entry);
    ownSet(queue, key, list);
    return options.counts ? list.filter(options.counts).length : list.length;
  });
}

/** Drop the player's queued entries that `match` selects (e.g. to undo an enqueue). */
export async function removePending(
  serverId: string,
  player: string,
  match: (entry: PendingRewardEntry) => boolean,
): Promise<void> {
  const key = player.toLowerCase();
  await updatePendingRewards((store) => {
    const queue = getServerPending(store, serverId);
    const kept = (ownGet(queue, key) ?? []).filter((e) => !match(e));
    if (kept.length > 0) ownSet(queue, key, kept);
    else delete queue[key];
  });
}

/** Remove and return everything queued for the player, oldest first. */
export async function takePending(
  serverId: string,
  player: string,
): Promise<PendingRewardEntry[]> {
  const key = player.toLowerCase();
  return updatePendingRewards((store) => {
    const queue = getServerPending(store, serverId);
    const taken = ownGet(queue, key) ?? [];
    delete queue[key];
    return taken;
  });
}

/**
 * Move entries to the player's failed list so nothing retries them. Keeps the
 * newest MAX_FAILED_PER_PLAYER.
 */
export async function recordFailed(
  serverId: string,
  player: string,
  entries: FailedRewardEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const key = player.toLowerCase();
  await updatePendingRewards((store) => {
    const failed = getServerFailed(store, serverId);
    const all = [...(ownGet(failed, key) ?? []), ...entries];
    ownSet(failed, key, all.slice(-MAX_FAILED_PER_PLAYER));
  });
}

/** What waits for the player and what gave up, read without the write lock. */
export function peekPlayerQueue(
  serverId: string,
  player: string,
): { pending: PendingRewardEntry[]; failed: FailedRewardEntry[] } {
  const key = player.toLowerCase();
  const doc = pendingDoc.load();
  return {
    pending: ownGet(ownGet(doc.servers, serverId) ?? {}, key) ?? [],
    failed: ownGet(ownGet(doc.failed ?? {}, serverId) ?? {}, key) ?? [],
  };
}

/** Drop everything queued or failed for the player; returns how many entries went. */
export async function clearPlayerQueue(
  serverId: string,
  player: string,
): Promise<number> {
  const key = player.toLowerCase();
  return updatePendingRewards((store) => {
    const queue = getServerPending(store, serverId);
    const failed = getServerFailed(store, serverId);
    const count = (ownGet(queue, key)?.length ?? 0) + (ownGet(failed, key)?.length ?? 0);
    delete queue[key];
    delete failed[key];
    return count;
  });
}

/**
 * Put the player's failed entries back in the queue with a fresh attempt
 * count. Returns how many entries moved.
 */
export async function retryFailed(
  serverId: string,
  player: string,
): Promise<number> {
  const key = player.toLowerCase();
  return updatePendingRewards((store) => {
    const failed = getServerFailed(store, serverId);
    const moved = ownGet(failed, key) ?? [];
    if (moved.length === 0) return 0;
    delete failed[key];
    const queue = getServerPending(store, serverId);
    const entries: PendingRewardEntry[] = moved.map(
      ({ discordId, items, queuedAt }) => ({ discordId, items, queuedAt, owed: true }),
    );
    ownSet(queue, key, [...entries, ...(ownGet(queue, key) ?? [])]);
    return moved.length;
  });
}

/** Put entries back ahead of anything queued since (they are older). */
export async function requeuePending(
  serverId: string,
  player: string,
  entries: PendingRewardEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const key = player.toLowerCase();
  await updatePendingRewards((store) => {
    const queue = getServerPending(store, serverId);
    ownSet(queue, key, [...entries, ...(ownGet(queue, key) ?? [])]);
  });
}
