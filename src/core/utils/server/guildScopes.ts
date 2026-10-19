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
