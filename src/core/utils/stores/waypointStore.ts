/**
 * Community waypoint persistence — single owner of kv_store["waypoints"];
 * commands never touch loadJson/saveJson for this file directly (same
 * ownership pattern as dailyStore.ts).
 *
 * Waypoints are stored per server:
 *
 *   { "version": 1, "servers": { "<serverId>": { "<lowercased name>": {…} } } }
 *
 * Names are constrained to [\w-]{1,24}: they get interpolated into
 * console commands (/msg, /tellraw) by the in-game commands, so the same
 * conservative character set the sanitize contract enforces for player
 * names applies here.
 */
import { kvGet, kvSet } from "../../db/kv.js";
import { loadConfig } from "../../config.js";

export interface Waypoint {
  /** Display name (original casing as typed by the author). */
  name: string;
  dimension: string;
  x: number;
  y: number;
  z: number;
  author: string;
  createdAt: number;
  /**
   * Optional flat category tag ("base", "farm", "shop", …) — same
   * conservative character set as names, since it travels through
   * console commands and Discord embeds. Lowercased on write.
   */
  category?: string;
}

/** serverId → lowercased waypoint name → waypoint */
export type ServerWaypointsMap = Record<string, Waypoint>;

export interface WaypointStore {
  version: 1;
  servers: Record<string, ServerWaypointsMap>;
}

/**
 * Default cap per server so the file (and the in-game list) cannot grow
 * forever. Overridable via `waypoints.maxPerServer` in config.json for
 * servers that actually hit the limit.
 */
export const MAX_WAYPOINTS_PER_SERVER = 100;

/** Effective per-server waypoint cap: config override or the default. */
export function waypointCap(): number {
  try {
    const max = loadConfig().waypoints?.maxPerServer;
    if (typeof max === "number" && Number.isInteger(max) && max > 0) {
      return max;
    }
  } catch {
    /* config unavailable — default */
  }
  return MAX_WAYPOINTS_PER_SERVER;
}

const WAYPOINT_NAME_REGEX = /^[\w-]{1,24}$/;
const WAYPOINT_CATEGORY_REGEX = /^[\w-]{1,16}$/;

export function isValidWaypointName(name: string): boolean {
  return WAYPOINT_NAME_REGEX.test(name);
}

export function isValidWaypointCategory(category: string): boolean {
  return WAYPOINT_CATEGORY_REGEX.test(category);
}

function isV1Store(raw: unknown): raw is WaypointStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    typeof (raw as { servers?: unknown }).servers === "object" &&
    (raw as { servers?: unknown }).servers !== null
  );
}

export async function loadWaypointStore(): Promise<WaypointStore> {
  const raw = kvGet<unknown>("waypoints");
  if (isV1Store(raw)) return raw;
  return { version: 1, servers: {} };
}

/** Waypoints for one server; creates the map lazily so callers can mutate. */
export function getServerWaypoints(
  store: WaypointStore,
  serverId: string,
): ServerWaypointsMap {
  return (store.servers[serverId] ??= {});
}

export async function saveWaypointStore(store: WaypointStore): Promise<void> {
  kvSet("waypoints", store);
}
