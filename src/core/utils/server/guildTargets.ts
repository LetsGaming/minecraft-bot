/**
 * Which servers a Discord guild may target, and which one it targets by
 * default. Pure config logic with no dependency on the live instance
 * registry, so both the bot and `getGuildServer` can share it.
 */
import { loadConfig } from "../../config.js";
import type { GuildConfig } from "../../types/index.js";

import { t } from "@mcbot/core/utils/i18n.js";
function scopeToList(scope: string | string[] | undefined): string[] {
  if (typeof scope === "string") return [scope];
  if (Array.isArray(scope)) return scope;
  return [];
}

/**
 * Derive the set of server IDs a guild's config references.
 * Used as the default allowed set when `allowedServers` is not explicit.
 */
export function referencedServerIds(guild: GuildConfig): Set<string> {
  const ids = new Set<string>();
  if (guild.defaultServer) ids.add(guild.defaultServer);
  for (const scope of [
    guild.notifications?.server,
    guild.leaderboard?.server,
    guild.tpsAlerts?.server,
    guild.downtimeAlerts?.server,
    guild.reports?.server,
  ]) {
    for (const id of scopeToList(scope)) ids.add(id);
  }
  const bridges = Array.isArray(guild.chatBridge)
    ? guild.chatBridge
    : guild.chatBridge
      ? [guild.chatBridge]
      : [];
  for (const bridge of bridges) {
    if (bridge.server) ids.add(bridge.server);
  }
  return ids;
}

/**
 * Which server IDs may commands from this guild target?
 *
 * `null` means unrestricted: single-tenant setups, or a guild that
 * references no servers and sets no allowedServers (a startup warning
 * nudges the operator). An empty set means deny: DMs and unconfigured
 * guilds in multi-guild deployments; resolveServer layers the
 * global-admin exception on top.
 */
export function getAllowedServerIds(
  guildId: string | undefined,
): Set<string> | null {
  return allowedServerIdsIn(loadConfig().guilds, guildId);
}

/**
 * getAllowedServerIds over an explicit `guilds` map instead of the loaded
 * config, so a candidate config (e.g. a dashboard write that hasn't landed
 * yet) can be checked with exactly the rule the bot will apply to it.
 */
export function allowedServerIdsIn(
  guildMap: Record<string, GuildConfig> | undefined,
  guildId: string | undefined,
): Set<string> | null {
  const guilds = guildMap ?? {};
  if (Object.keys(guilds).length <= 1) return null; // single-tenant

  if (!guildId) return new Set(); // DM in a multi-guild deployment
  const guild = guilds[guildId];
  if (!guild) return new Set(); // unconfigured guild in a multi-guild deployment

  const explicit = guild.allowedServers !== undefined;
  const allowed = explicit
    ? new Set(guild.allowedServers)
    : referencedServerIds(guild);
  // The guild's own default must always be reachable, even if the operator
  // set an explicit allowedServers list that forgot to repeat it.
  if (guild.defaultServer) allowed.add(guild.defaultServer);

  // An explicit empty list denies; only an unset one falls back to legacy.
  if (allowed.size === 0 && !explicit) return null;
  return allowed;
}

/** The subset of `serverIds` this guild may target, in the given order. */
export function visibleServerIdsForGuild(
  guildId: string | undefined,
  serverIds: readonly string[],
): string[] {
  const allowed = getAllowedServerIds(guildId);
  return serverIds.filter((id) => !allowed || allowed.has(id));
}

/**
 * The server a command targets when it names none.
 *
 * Order: the guild's `defaultServer`; otherwise the only server the guild
 * may target (a DM counts every configured server). A `defaultServer`
 * that names no running server is a configuration error, never silently
 * replaced. Throws with the available IDs when the choice is ambiguous.
 *
 * Callers still apply the tenant check to the returned ID.
 */
export function resolveDefaultServerId(
  guildId: string | undefined,
  runningServerIds: readonly string[],
): string {
  const configured = guildId
    ? loadConfig().guilds?.[guildId]?.defaultServer
    : undefined;
  if (configured) {
    if (runningServerIds.includes(configured)) return configured;
    throw new Error(
      t("target.defaultNotRunning", {
        server: configured,
        available: runningServerIds.join(", ") || t("target.none"),
      }),
    );
  }

  const candidates = guildId
    ? visibleServerIdsForGuild(guildId, runningServerIds)
    : [...runningServerIds];
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new Error(t("target.noneAvailable"));
  }
  throw new Error(
    t("target.several", { servers: candidates.join(", ") }),
  );
}
