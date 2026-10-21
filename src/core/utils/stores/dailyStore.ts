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

export interface PendingRewardEntry {
  /** Discord user the claim belongs to ("" for system rewards, e.g. challenge bonuses). */
  discordId: string;
  items: DailyRewardItem[];
  queuedAt: number;
  /** Items from a claim that was already consumed but could not all be handed over. */
  owed?: boolean;
}

/** serverId → lowercased MC name → queued entries (oldest first) */
export type ServerPendingMap = Record<string, PendingRewardEntry[]>;

export interface PendingRewardsStore {
  version: 1;
  servers: Record<string, ServerPendingMap>;
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
 * waiting entries use up the cap (default: all). Returns the new queue length.
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
    return list.length;
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
