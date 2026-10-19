/**
 * Community waypoint persistence, single owner of kv_store["waypoints"];
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
import { versionedStore } from "./versionedStore.js";
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
   * Optional flat category tag ("base", "farm", "shop", …) same
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
    /* config unavailable, default */
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

const waypointDoc = versionedStore<WaypointStore>(
  "waypoints",
  { version: 1, container: "servers" },
  () => ({ version: 1, servers: {} }),
);

export async function loadWaypointStore(): Promise<WaypointStore> {
  return waypointDoc.load();
}

/** Waypoints for one server; creates the map lazily so callers can mutate. */
export function getServerWaypoints(
  store: WaypointStore,
  serverId: string,
): ServerWaypointsMap {
  return (store.servers[serverId] ??= {});
}

/** Change the store in one transaction; see versionedStore. */
export async function updateWaypointStore<T>(
  fn: (store: WaypointStore) => T,
): Promise<T> {
  return waypointDoc.update(fn);
}
