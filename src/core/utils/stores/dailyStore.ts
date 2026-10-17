/**
 * Single owner of daily-reward persistence (claim data, plus the rewards
 * config re-exported from rewardsConfig.ts);
 * commands never touch loadJson/saveJson for these files directly.
 *
 * Claims are stored per server:
 *
 *   { "version": 2, "servers": { "<serverId>": { "<discordUserId>": {…} } } }
 *
 * so cooldowns, streaks, and reminder opt-ins are independent between
 * servers. Old flat files (one userId→claim map) are migrated on first
 * load — everything moves under the first configured server.
 */
import { kvGet, kvSet, kvUpdate } from "../../db/kv.js";
import { log } from "../logger.js";
import type { DailyRewardItem, UserClaimData } from "../../types/index.js";

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

function isV2Store(raw: unknown): raw is ClaimedDailyStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 2 &&
    typeof (raw as { servers?: unknown }).servers === "object" &&
    (raw as { servers?: unknown }).servers !== null
  );
}

export async function loadClaimedStore(): Promise<ClaimedDailyStore> {
  const raw = kvGet<Record<string, unknown>>("claimedDaily") ?? {};

  if (isV2Store(raw)) return raw;

  const legacyEntries = Object.entries(raw ?? {});
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
    `Migrating claimedDaily.json to the per-server format (v2): ` +
      `${legacyEntries.length} user record(s) → server "${target}". ` +
      `Streaks and cooldowns are now tracked per server.`,
  );

  const store: ClaimedDailyStore = {
    version: 2,
    // Legacy migration: the pre-v2 on-disk format was exactly a userId→claim
    // map, i.e. a ClaimedDailyMap, so reinterpreting the flat `raw` as one is
    // the format upgrade. This path runs once and is then persisted.
    servers: { [target]: raw as ClaimedDailyMap },
  };
  await saveClaimedStore(store); // persist so the migration never re-runs
  return store;
}

/** Claims for one server; creates the map lazily so callers can mutate. */
export function getServerClaims(
  store: ClaimedDailyStore,
  serverId: string,
): ClaimedDailyMap {
  return (store.servers[serverId] ??= {});
}

export async function saveClaimedStore(
  store: ClaimedDailyStore,
): Promise<void> {
  kvSet("claimedDaily", store);
}

/**
 * AUD-005: change the claim store in one transaction. `fn` gets the store
 * as it is on disk right now, mutates only what it means to change, and
 * its return value is handed back. Use this instead of load → await → save,
 * which writes a stale snapshot over every change made during the await
 * (another user's claim, a reminder flag).
 */
export async function updateClaimedStore<T>(
  fn: (store: ClaimedDailyStore) => T,
): Promise<T> {
  await loadClaimedStore(); // runs the one-time v1 → v2 migration first
  let out!: T;
  kvUpdate<unknown>("claimedDaily", (raw) => {
    const store: ClaimedDailyStore = isV2Store(raw) ? raw : { version: 2, servers: {} };
    out = fn(store);
    return store;
  });
  return out;
}

// ── Offline-claim delivery queue ──────────────────────────────────────────
//
// /daily used to reject offline claims outright, which broke streaks for
// exactly the audience streaks are for (people checking Discord away from
// their PC). Offline claims now record the claim (streak logic untouched),
// roll the reward, and queue it here; the joinLeave watcher delivers on
// the next join through daily.ts's give(), removing entries on confirmed
// success and keeping them on failure.

/**
 * Queue cap per player and server, so the queue cannot become free item
 * storage. A full queue rejects further offline claims WITHOUT consuming
 * the cooldown — the user can claim online or after the next delivery.
 */
export const MAX_PENDING_PER_PLAYER = 3;

export interface PendingRewardEntry {
  /** Discord user the claim belongs to ("" for system rewards, e.g. challenge bonuses). */
  discordId: string;
  items: DailyRewardItem[];
  queuedAt: number;
}

/** serverId → lowercased MC name → queued entries (oldest first) */
export type ServerPendingMap = Record<string, PendingRewardEntry[]>;

export interface PendingRewardsStore {
  version: 1;
  servers: Record<string, ServerPendingMap>;
}

function isPendingV1(raw: unknown): raw is PendingRewardsStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    typeof (raw as { servers?: unknown }).servers === "object" &&
    (raw as { servers?: unknown }).servers !== null
  );
}

export async function loadPendingRewards(): Promise<PendingRewardsStore> {
  const raw = kvGet<unknown>("pendingRewards");
  if (isPendingV1(raw)) return raw;
  return { version: 1, servers: {} };
}

export async function savePendingRewards(
  store: PendingRewardsStore,
): Promise<void> {
  kvSet("pendingRewards", store);
}

/** AUD-005: change the pending-rewards queue in one transaction; see updateClaimedStore. */
export async function updatePendingRewards<T>(
  fn: (store: PendingRewardsStore) => T,
): Promise<T> {
  let out!: T;
  kvUpdate<unknown>("pendingRewards", (raw) => {
    const store: PendingRewardsStore = isPendingV1(raw) ? raw : { version: 1, servers: {} };
    out = fn(store);
    return store;
  });
  return out;
}

/** Pending entries for one server; created lazily so callers can mutate. */
export function getServerPending(
  store: PendingRewardsStore,
  serverId: string,
): ServerPendingMap {
  return (store.servers[serverId] ??= {});
}
