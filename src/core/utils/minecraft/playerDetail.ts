/**
 * One player's audit view, assembled from the stores that already know
 * something about them. The web process cannot import the bot's `/whois` and
 * `/profile`, which each join a few of these inline, so the assembly lives
 * here and is pure apart from the reads.
 *
 * Every section is read independently and a failing one degrades to empty
 * rather than failing the page: a wrapper outage must not hide the session
 * history, and a missing Discord token must not hide the notes.
 */
import type {
  PlayerActivity,
  PlayerApplicationDto,
  PlayerDayPlaytime,
  PlayerDetail,
  PlayerLink,
  PlayerNoteDto,
  PlayerSensitive,
  PlayerStatValue,
  PlayerStreak,
  PlayerTempBan,
  PlayerWhitelistEntry,
} from "@mcbot/schema/players.js";
import { MS } from "@mcbot/schema/time.js";
import type { ServerInstance } from "../server/server.js";
import { errMsg } from "../error.js";
import { log } from "../logger.js";
import {
  getPlayerSummary,
  listSessions,
  SESSION_RETENTION_DAYS,
} from "../stores/sessionStore.js";
import { getAuditEntry } from "../stores/whitelistAudit.js";
import {
  loadLinkedAccountsOrEmpty,
  findDiscordIdByMcName,
} from "../stores/linkStore.js";
import {
  loadNotesStore,
  getNotesByUuid,
  findNotesByName,
} from "../stores/noteStore.js";
import { loadWhitelistApplications } from "../stores/whitelistApplicationStore.js";
import { loadTempBanStore, tempBanKey } from "../stores/tempBanStore.js";
import { loadClaimedStore, getServerClaims } from "../stores/dailyStore.js";
import { findPlayer } from "./playerUtils.js";
import { normalizeUuid } from "./playerRoster.js";
import {
  loadAllStats,
  flattenStats,
  LEADERBOARD_STATS,
} from "./statUtils.js";

const RECENT_SESSIONS = 50;
const DAILY_WINDOW_DAYS = 90;
const MAX_APPLICATIONS = 10;
/** Upper bound on the sessions read for one player (a year of heavy play is well under it). */
const SESSION_QUERY_LIMIT = 5000;

export interface PlayerDetailInput {
  serverId: string;
  /** Resolved server, for the wrapper-backed parts (uuid, stats). Null skips them. */
  server: ServerInstance | null;
  name: string;
  includeSensitive: boolean;
  /** Turns a Discord id into a display name; null on any failure. */
  resolveDiscordName?: (discordId: string) => Promise<string | null>;
  now?: number;
}

async function safe<T>(label: string, fallback: T, read: () => Promise<T> | T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    log.warn("web", `Player detail: ${label} unavailable: ${errMsg(err)}`);
    return fallback;
  }
}

/** Time played per UTC day, splitting sessions that cross midnight. */
export function dailyPlaytime(
  sessions: ReadonlyArray<{ joinedAt: number; leftAt: number | null }>,
  now: number,
  days: number = DAILY_WINDOW_DAYS,
): PlayerDayPlaytime[] {
  const windowStart = Math.floor((now - days * MS.day) / MS.day) * MS.day;
  const perDay = new Map<number, number>();
  for (const s of sessions) {
    let from = Math.max(s.joinedAt, windowStart);
    const to = Math.min(s.leftAt ?? now, now);
    while (from < to) {
      const day = Math.floor(from / MS.day) * MS.day;
      const end = Math.min(to, day + MS.day);
      perDay.set(day, (perDay.get(day) ?? 0) + (end - from));
      from = end;
    }
  }
  return [...perDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, playtimeMs]) => ({ day, playtimeMs }));
}

function buildStats(
  allStats: Awaited<ReturnType<typeof loadAllStats>>,
  uuid: string,
): PlayerStatValue[] | null {
  const key = Object.keys(allStats).find((k) => normalizeUuid(k) === uuid);
  if (!key) return null;
  const flat = flattenStats(allStats[key]!);
  return Object.entries(LEADERBOARD_STATS).map(([statKey, def]) => {
    const value = def.extract(flat);
    return { key: statKey, label: def.label, value, formatted: def.format(value) };
  });
}

/**
 * The player's detail, or null when nothing at all is known about the name
 * (for a viewer without sensitive access, "known" means session history).
 */
export async function buildPlayerDetail(input: PlayerDetailInput): Promise<PlayerDetail | null> {
  const { serverId, server, name, includeSensitive } = input;
  const now = input.now ?? Date.now();

  const summary = getPlayerSummary(serverId, name, { now });
  const audit = await safe("whitelist audit", null, () => getAuditEntry(name));

  let uuid: string | null = audit?.uuid ? normalizeUuid(audit.uuid) : null;
  if (!uuid && server) {
    const known = await safe("known players", null, () => findPlayer(name, server));
    uuid = known ? normalizeUuid(known.uuid) : null;
  }

  const all = summary
    ? listSessions(serverId, name, { limit: SESSION_QUERY_LIMIT })
    : [];
  const windowStart = now - DAILY_WINDOW_DAYS * MS.day;
  const windowSessions = all.filter((s) => (s.leftAt ?? now) > windowStart);
  const longestSessionMs = all.reduce(
    (max, s) => Math.max(max, (s.leftAt ?? now) - s.joinedAt),
    0,
  );

  const activity: PlayerActivity = {
    online: summary?.online ?? false,
    firstSeen: summary?.firstSeen ?? null,
    lastSeen: summary?.lastSeen ?? null,
    sessions: summary?.sessions ?? 0,
    playtimeMs: summary?.playtimeMs ?? 0,
    longestSessionMs,
    recentSessions: all.slice(0, RECENT_SESSIONS),
    daily: dailyPlaytime(windowSessions, now),
    historyDays: SESSION_RETENTION_DAYS,
  };

  let stats: PlayerStatValue[] | null = null;
  if (server && uuid) {
    const all = await safe("stats", null, () => loadAllStats(server));
    stats = all ? buildStats(all, uuid) : null;
  }

  let sensitive: PlayerSensitive | null = null;
  if (includeSensitive) {
    sensitive = await buildSensitive(input, uuid, audit);
  }

  const known =
    summary !== null ||
    (sensitive !== null &&
      (sensitive.link !== null ||
        sensitive.whitelist !== null ||
        sensitive.notes.length > 0 ||
        sensitive.applications.length > 0 ||
        sensitive.tempBan !== null));
  if (!known) return null;

  return {
    serverId,
    name: summary?.name ?? audit?.username ?? name,
    uuid,
    activity,
    stats,
    sensitiveAccess: includeSensitive,
    sensitive,
  };
}

async function buildSensitive(
  input: PlayerDetailInput,
  uuid: string | null,
  audit: Awaited<ReturnType<typeof getAuditEntry>>,
): Promise<PlayerSensitive> {
  const { serverId, name } = input;
  const lower = name.toLowerCase();

  const linked = await safe("links", {}, () => loadLinkedAccountsOrEmpty());
  const discordId = findDiscordIdByMcName(linked, name);

  let link: PlayerLink | null = null;
  if (discordId) {
    const displayName = input.resolveDiscordName
      ? await safe("discord name", null, () => input.resolveDiscordName!(discordId))
      : null;
    link = { discordId, displayName };
  }

  const whitelist: PlayerWhitelistEntry | null = audit
    ? {
        addedBy: audit.addedBy ?? null,
        addedAt: audit.addedAt ?? null,
        removedBy: audit.removedBy ?? null,
        removedAt: audit.removedAt ?? null,
        server: audit.server ?? null,
      }
    : null;

  const notesStore = await safe("notes", null, () => loadNotesStore());
  const noteEntry = notesStore
    ? ((uuid ? getNotesByUuid(notesStore, uuid) : null) ??
      getNotesByUuid(notesStore, audit?.uuid ?? "") ??
      findNotesByName(notesStore, name)?.entry ??
      null)
    : null;
  const notes: PlayerNoteDto[] = (noteEntry?.notes ?? [])
    .map((n) => ({ text: n.text, author: n.author, createdAt: n.createdAt }))
    .reverse();

  const applications: PlayerApplicationDto[] = await safe("applications", [], () =>
    loadWhitelistApplications()
      .applications.filter(
        (a) =>
          a.serverId === serverId &&
          a.mcName.toLowerCase() === lower &&
          (a.status === "approved" || a.status === "denied"),
      )
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
      .slice(0, MAX_APPLICATIONS)
      .map((a) => ({
        id: a.id,
        status: a.status as "approved" | "denied",
        userTag: a.userTag,
        note: a.note ?? null,
        createdAt: a.createdAt,
        decidedBy: a.decidedBy ?? null,
        decidedAt: a.decidedAt ?? null,
      })),
  );

  const tempBan: PlayerTempBan | null = await safe("temp ban", null, async () => {
    const bans = (await loadTempBanStore()).bans;
    const key = tempBanKey(serverId, name);
    const ban = Object.hasOwn(bans, key) ? bans[key] : undefined;
    return ban
      ? { expiresAt: ban.expiresAt, bannedAt: ban.bannedAt, by: ban.by, reason: ban.reason }
      : null;
  });

  let streak: PlayerStreak | null = null;
  if (discordId) {
    streak = await safe("streak", null, async () => {
      const claims = getServerClaims(await loadClaimedStore(), serverId);
      const claim = Object.hasOwn(claims, discordId) ? claims[discordId] : undefined;
      return claim
        ? {
            current: claim.currentStreak,
            longest: claim.longestStreak,
            lastClaim: claim.lastClaim ?? null,
          }
        : null;
    });
  }

  return { link, whitelist, notes, applications, tempBan, streak };
}
