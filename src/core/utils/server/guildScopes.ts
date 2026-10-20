/**
 * Which server IDs a guild's config names, field by field. Pure config logic
 * with no config loading, so the validator and the runtime tenant check read
 * the same list of fields instead of each enumerating them.
 */
import type { GuildChatBridgeConfig, GuildConfig } from "../../types/index.js";

export function scopeToList(scope: string | string[] | undefined): string[] {
  if (typeof scope === "string") return [scope];
  if (Array.isArray(scope)) return scope;
  return [];
}

/** The guild's chat bridges as a list, whether configured as one object or an array. */
export function bridgesOf(guild: GuildConfig): GuildChatBridgeConfig[] {
  if (Array.isArray(guild.chatBridge)) return guild.chatBridge;
  return guild.chatBridge ? [guild.chatBridge] : [];
}

/**
 * The one server a chat bridge is bound to: its own `server`, else the guild's
 * `defaultServer`, else the only configured server. Undefined when none of
 * those names it, which the validator reports as ambiguous.
 */
export function bridgeServerOf(
  guild: GuildConfig,
  bridge: GuildChatBridgeConfig,
  knownServers?: ReadonlySet<string> | null,
): string | undefined {
  if (bridge.server) return bridge.server;
  if (guild.defaultServer) return guild.defaultServer;
  return knownServers && knownServers.size === 1 ? [...knownServers][0] : undefined;
}

export interface GuildServerScope {
  /** Config path under the guild, e.g. "notifications.server". */
  field: string;
  ids: string[];
}

/**
 * Every field through which a guild names servers, except the explicit
 * `allowedServers` policy list. A field that names nothing has no ids.
 * Empty `defaultServer` and bridge `server` values name nothing.
 */
export function guildServerScopes(guild: GuildConfig): GuildServerScope[] {
  const named = (value: string | undefined): string[] => (value ? [value] : []);
  return [
    { field: "defaultServer", ids: named(guild.defaultServer) },
    ...bridgesOf(guild).map((b) => ({
      field: "chatBridge.server",
      ids: named(b?.server),
    })),
    { field: "notifications.server", ids: scopeToList(guild.notifications?.server) },
    { field: "leaderboard.server", ids: scopeToList(guild.leaderboard?.server) },
    { field: "tpsAlerts.server", ids: scopeToList(guild.tpsAlerts?.server) },
    { field: "downtimeAlerts.server", ids: scopeToList(guild.downtimeAlerts?.server) },
    { field: "reports.server", ids: scopeToList(guild.reports?.server) },
  ];
}

/**
 * Derive the set of server IDs a guild's config references.
 * Used as the default allowed set when `allowedServers` is not explicit.
 */
export function referencedServerIds(guild: GuildConfig): Set<string> {
  const ids = new Set<string>();
  for (const scope of guildServerScopes(guild)) {
    for (const id of scope.ids) ids.add(id);
  }
  return ids;
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
