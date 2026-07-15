/**
 * Single owner of daily-reward persistence (rewards config + claim data);
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
import path from "path";
import { loadJson } from "../jsonStore.js";
import { getRootDir } from "../paths.js";
import { kvGet, kvSet } from "../../db/kv.js";
import { log } from "../logger.js";
import type {
  DailyRewardsConfig,
  DailyRewardItem,
  UserClaimData,
} from "../../types/index.js";

/** The pool one server draws from: its override, else the default pool. */
export interface ResolvedRewardPool {
  default: DailyRewardItem[];
  streakBonuses?: Record<string, DailyRewardItem[]>;
}

/**
 * Resolve the effective reward pool for a server. Per-server overrides
 * (dailyRewards.json → servers.<id>) win field-by-field; missing fields
 * fall back to the top-level pool, so a server can override just the
 * items and inherit the streak bonuses (or vice versa).
 */
export function rewardPoolForServer(
  cfg: DailyRewardsConfig,
  serverId: string,
): ResolvedRewardPool {
  const override = cfg.servers?.[serverId];
  const items =
    override?.default && override.default.length > 0
      ? override.default
      : (cfg.default ?? []);
  const streakBonuses = override?.streakBonuses ?? cfg.streakBonuses;
  return {
    default: items,
    ...(streakBonuses ? { streakBonuses } : {}),
  };
}

// dailyRewards.json stays a JSON file on purpose: it is the one store in
// this module an admin edits by hand (the ownership rule in
// docs/dev/data-storage.md). Claims and the pending queue are
// machine-written and live in kv_store.
const REWARDS_PATH = path.resolve(getRootDir(), "data", "dailyRewards.json");

export type ClaimedDailyMap = Record<string, UserClaimData>;

export interface ClaimedDailyStore {
  version: 2;
  /** serverId → userId → claim record */
  servers: Record<string, ClaimedDailyMap>;
}

// Load errors are deliberately not swallowed here: turning a corrupt file
// into {} would wipe everyone's streaks on the next save. loadJson already
// recovers from .bak; if even that fails, the command should fail loudly.

export async function loadDailyRewardsConfig(): Promise<DailyRewardsConfig> {
  // dailyRewards.json is an operator-authored config file bundled with the
  // deployment; loadJson returns unknown, and we assert the config shape here.
  // (Kept as a cast rather than a full parse: it's first-party config, and
  // loadJson already recovers a corrupt file from its .bak — see above.)
  return (await loadJson(REWARDS_PATH)) as DailyRewardsConfig;
}

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

/** Pending entries for one server; created lazily so callers can mutate. */
export function getServerPending(
  store: PendingRewardsStore,
  serverId: string,
): ServerPendingMap {
  return (store.servers[serverId] ??= {});
}
