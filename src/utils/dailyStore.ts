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
import { loadJson, saveJson, getRootDir } from "./utils.js";
import { log } from "./logger.js";
import type { DailyRewardsConfig, UserClaimData } from "../types/index.js";

const dataDir = path.resolve(getRootDir(), "data");
const REWARDS_PATH = path.join(dataDir, "dailyRewards.json");
const CLAIMED_PATH = path.join(dataDir, "claimedDaily.json");

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
  const raw = (await loadJson(CLAIMED_PATH)) as Record<string, unknown>;

  if (isV2Store(raw)) return raw;

  const legacyEntries = Object.entries(raw ?? {});
  if (legacyEntries.length === 0) {
    return { version: 2, servers: {} };
  }

  // Old format: a flat userId→claim map with no server dimension. Move
  // everything under the first configured server. Lazy import so the
  // config chain is only pulled in for this one-time path.
  const { getServerIds } = await import("../config.js");
  const target = getServerIds()[0] ?? "default";
  log.warn(
    "daily",
    `Migrating claimedDaily.json to the per-server format (v2): ` +
      `${legacyEntries.length} user record(s) → server "${target}". ` +
      `Streaks and cooldowns are now tracked per server.`,
  );

  const store: ClaimedDailyStore = {
    version: 2,
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
  return saveJson(CLAIMED_PATH, store);
}
