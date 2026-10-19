/**
 * Pure merge of every source that knows a player existed on a server: stats
 * files, the whitelist/usercache name map and the bot's session store.
 * No I/O, so the ordering rules are unit-testable.
 */
import { MS } from "@mcbot/schema/time.js";
import type { PlayerSummary } from "../stores/sessionStore.js";

export type RosterSort = "last-seen" | "playtime" | "name";

export interface RosterEntry {
  /** Dashless lowercase UUID, null for a player only the session store knows. */
  uuid: string | null;
  name: string;
  online: boolean;
  /** End of the last tracked session; null when the bot never saw them leave. */
  lastSeen: number | null;
  /** Lifetime playtime from the stats file; null when there is no stats file. */
  playtimeTicks: number | null;
}

export interface RosterInput {
  /** Raw UUID (dashed or not) to lifetime playtime ticks, one per stats file. */
  statsPlaytime: Record<string, number>;
  /** UUID to name pairs from the whitelist and usercache. */
  known: ReadonlyArray<{ uuid: string; name: string }>;
  /** Session summaries for this server, keyed by lowercased name. */
  sessions: Record<string, PlayerSummary>;
}

const DAY_MS = MS.day;

export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

export function buildRoster(input: RosterInput): RosterEntry[] {
  const nameByUuid = new Map<string, string>();
  for (const k of input.known) nameByUuid.set(normalizeUuid(k.uuid), k.name);

  const playtimeByUuid = new Map<string, number>();
  for (const [uuid, ticks] of Object.entries(input.statsPlaytime)) {
    playtimeByUuid.set(normalizeUuid(uuid), ticks);
  }

  const uuids = new Set<string>([...nameByUuid.keys(), ...playtimeByUuid.keys()]);
  const usedSessionKeys = new Set<string>();
  const entries: RosterEntry[] = [];

  for (const uuid of uuids) {
    const name = nameByUuid.get(uuid) ?? uuid;
    const key = name.toLowerCase();
    const session = input.sessions[key];
    if (session) usedSessionKeys.add(key);
    entries.push(fromParts(uuid, name, session, playtimeByUuid.get(uuid) ?? null));
  }

  for (const [key, session] of Object.entries(input.sessions)) {
    if (usedSessionKeys.has(key)) continue;
    entries.push(fromParts(null, session.name, session, null));
  }

  return entries;
}

function fromParts(
  uuid: string | null,
  name: string,
  session: PlayerSummary | undefined,
  playtimeTicks: number | null,
): RosterEntry {
  return {
    uuid,
    name: session?.name ?? name,
    online: session?.online ?? false,
    lastSeen: session?.lastSeen ?? null,
    playtimeTicks,
  };
}

/** True when the bot has any trustworthy activity timestamp for the player. */
export function hasTrackedActivity(e: RosterEntry): boolean {
  return e.online || e.lastSeen !== null;
}

/**
 * Keeps players whose last activity is older than `days`. Online players are
 * never inactive. Players with no tracked activity (they last played before
 * the bot started tracking, or never) are kept only with `includeUnknown`.
 */
export function filterInactive(
  entries: RosterEntry[],
  days: number,
  includeUnknown: boolean,
  now: number = Date.now(),
): RosterEntry[] {
  const cutoff = now - days * DAY_MS;
  return entries.filter((e) => {
    if (e.online) return false;
    if (e.lastSeen === null) return includeUnknown;
    return e.lastSeen < cutoff;
  });
}

const byName = (a: RosterEntry, b: RosterEntry): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const byPlaytimeDesc = (a: RosterEntry, b: RosterEntry): number =>
  (b.playtimeTicks ?? 0) - (a.playtimeTicks ?? 0);

/**
 * "last-seen": online first, then most recent activity, then players with no
 * tracked activity by lifetime playtime. Returns a new array.
 */
export function sortRoster(entries: RosterEntry[], sort: RosterSort): RosterEntry[] {
  const out = [...entries];
  if (sort === "name") return out.sort(byName);
  if (sort === "playtime") {
    return out.sort((a, b) => byPlaytimeDesc(a, b) || byName(a, b));
  }
  return out.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const aTracked = hasTrackedActivity(a);
    const bTracked = hasTrackedActivity(b);
    if (aTracked !== bTracked) return aTracked ? -1 : 1;
    if (aTracked && bTracked) {
      const diff = (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
      if (diff !== 0) return diff;
    }
    return byPlaytimeDesc(a, b) || byName(a, b);
  });
}
