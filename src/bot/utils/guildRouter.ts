/**
 * Guild router — resolves the target ServerInstance for a Discord interaction.
 *
 * All commands must use resolveServer() instead of calling getServerInstance()
 * or getGuildServer() directly. This centralizes resolution logic and makes
 * commands trivially testable by swapping the resolver.
 *
 * resolveServer() is also the single enforcement point for tenant
 * isolation: in multi-guild deployments, a command issued from guild A must
 * not be able to target guild B's server via the explicit `server:` option,
 * so every resolved server is checked against the issuing guild's allowed set.
 */
import { getServerInstance, getGuildServer } from "@mcbot/core/utils/server.js";
import { loadConfig } from "@mcbot/core/config.js";
import { isServerAdmin } from "../commands/middleware.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { ServerInstance } from "@mcbot/core/utils/server.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";

/** Normalize a ServerScope (string | string[] | undefined) to a list. */
function scopeToList(scope: string | string[] | undefined): string[] {
  if (typeof scope === "string") return [scope];
  if (Array.isArray(scope)) return scope;
  return [];
}

/**
 * Derive the set of server IDs a guild's config references.
 * Used as the default allowed set when `allowedServers` is not explicit.
 */
function referencedServerIds(guild: GuildConfig): Set<string> {
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
 * Does `serverId` fall inside a feature's server scope for this guild?
 * String → exact match, list → membership, unset → every server this
 * guild can see (all servers single-guild, the allowed set multi-guild —
 * so an omitted scope can never leak another tenant's events).
 */
export function serverInScope(
  scope: string | string[] | undefined,
  serverId: string,
  guildId: string | undefined,
): boolean {
  if (typeof scope === "string") return scope === serverId;
  if (Array.isArray(scope)) return scope.includes(serverId);
  const allowed = getAllowedServerIds(guildId);
  return !allowed || allowed.has(serverId);
}

/**
 * Which server IDs may commands from this guild target?
 *
 * `null` means unrestricted: single-tenant setups, or a guild that
 * references no servers and sets no allowedServers (a startup warning
 * nudges the operator). An empty set means deny — DMs and unconfigured
 * guilds in multi-guild deployments; resolveServer layers the
 * global-admin exception on top.
 */
export function getAllowedServerIds(
  guildId: string | undefined,
): Set<string> | null {
  const cfg = loadConfig();
  const guilds = cfg.guilds ?? {};
  if (Object.keys(guilds).length <= 1) return null; // single-tenant

  if (!guildId) return new Set(); // DM in a multi-guild deployment
  const guild = guilds[guildId];
  if (!guild) return new Set(); // unconfigured guild in a multi-guild deployment

  const allowed = guild.allowedServers
    ? new Set(guild.allowedServers)
    : referencedServerIds(guild);
  // The guild's own default must always be reachable, even if the operator
  // set an explicit allowedServers list that forgot to repeat it.
  if (guild.defaultServer) allowed.add(guild.defaultServer);

  if (allowed.size === 0) return null; // guild references nothing — legacy
  return allowed;
}

/**
 * Throw unless the issuing context may target this server.
 * Global admins (config.adminUsers) are exempt — they are the operator.
 */
function assertGuildMayTarget(
  interaction: ChatInputCommandInteraction,
  server: ServerInstance,
): void {
  const allowed = getAllowedServerIds(interaction.guild?.id);
  if (!allowed || allowed.has(server.id)) return;

  // Operator-level admins may target any server from anywhere. Role-based
  // global admin entries can't be resolved without a guild member object,
  // so DMs match on user ID only — which is exactly the operator case.
  if (isServerAdmin(interaction.user.id)) return;

  if (!interaction.guild) {
    throw new Error(
      "In a multi-server setup, commands must be used inside a Discord server.",
    );
  }
  throw new Error(
    `Server "${server.id}" is not available from this Discord server. ` +
      `An operator can allow it by adding it to this guild's ` +
      `"allowedServers" in config.json.`,
  );
}

/**
 * Assert that the issuing context may target the server with this ID —
 * the same tenant-isolation rule resolveServer applies, exposed for
 * commands that take an explicit LIST of servers (span polls). Throws on
 * unknown IDs and on IDs outside the guild's allowed set.
 */
export function assertMayTargetServerId(
  interaction: ChatInputCommandInteraction,
  serverId: string,
): ServerInstance {
  const server = getServerInstance(serverId);
  if (!server) throw new Error(`Server "${serverId}" not found.`);
  assertGuildMayTarget(interaction, server);
  return server;
}

/**
 * Resolve the ServerInstance for an interaction.
 *
 * Resolution order:
 * 1. If the interaction has an explicit `server` string option, use that ID.
 * 2. Otherwise, fall back to the guild's configured `defaultServer`.
 * 3. If neither is set, use the first registered server instance.
 *
 * Whichever way the server was resolved, the issuing guild must be
 * allowed to target it (multi-guild deployments only).
 *
 * @throws {Error} if no server can be resolved (misconfiguration or unknown
 *                 ID), or if this guild may not target the resolved server.
 */
export function resolveServer(
  interaction: ChatInputCommandInteraction,
): ServerInstance {
  const explicit = interaction.options.getString("server");
  const server = explicit
    ? getServerInstance(explicit)
    : getGuildServer(interaction.guild?.id);

  if (!server) {
    throw new Error(
      explicit
        ? `Server "${explicit}" not found.`
        : "No server configured for this guild.",
    );
  }

  assertGuildMayTarget(interaction, server);
  return server;
}

/**
 * Resolve the ServerInstance, returning null instead of throwing.
 * Use this when the command should handle the missing-server case itself.
 */
export function tryResolveServer(
  interaction: ChatInputCommandInteraction,
): ServerInstance | null {
  try {
    return resolveServer(interaction);
  } catch {
    return null;
  }
}
