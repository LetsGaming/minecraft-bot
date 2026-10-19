/**
 * Guild router, resolves the target ServerInstance for a Discord interaction.
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
import { getServerInstance, getGuildServer } from "@mcbot/core/utils/server/server.js";
import {
  getAllowedServerIds,
  visibleServerIdsForGuild,
} from "@mcbot/core/utils/server/guildTargets.js";
import { isServerAdmin } from "./permissions.js";
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";

import { t } from "@mcbot/core/utils/i18n.js";
export { getAllowedServerIds };

/**
 * The interaction shape server-resolution needs: it only reads the `server`
 * string option and the guild, both of which a chat-command *and* an
 * autocomplete interaction expose. Accepting the union lets autocomplete reuse
 * the exact same guild→server resolution (to suggest player names) without
 * force-casting one interaction class into another.
 */
type ServerContextInteraction =
  | ChatInputCommandInteraction
  | AutocompleteInteraction;

/**
 * Does `serverId` fall inside a feature's server scope for this guild?
 * String → exact match, list → membership, unset → every server this
 * guild can see (all servers single-guild, the allowed set multi-guild :
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
 * Throw unless the issuing context may target this server.
 * Global admins (config.adminUsers) are exempt, they are the operator.
 */
function assertGuildMayTarget(
  interaction: ServerContextInteraction,
  server: ServerInstance,
): void {
  const allowed = getAllowedServerIds(interaction.guild?.id);
  if (!allowed || allowed.has(server.id)) return;

  // Operator-level admins may target any server from anywhere. Role-based
  // global admin entries can't be resolved without a guild member object,
  // so DMs match on user ID only, which is exactly the operator case.
  if (isServerAdmin(interaction.user.id)) return;

  if (!interaction.guild) {
    throw new Error(t("router.guildOnly"));
  }
  throw new Error(t("router.notAllowed", { server: server.id }));
}

/**
 * Assert that the issuing context may target the server with this ID :
 * the same tenant-isolation rule resolveServer applies, exposed for
 * commands that take an explicit LIST of servers (span polls). Throws on
 * unknown IDs and on IDs outside the guild's allowed set.
 */
export function assertMayTargetServerId(
  interaction: ServerContextInteraction,
  serverId: string,
): ServerInstance {
  const server = getServerInstance(serverId);
  if (!server) throw new Error(t("router.serverNotFound", { server: serverId }));
  assertGuildMayTarget(interaction, server);
  return server;
}

/**
 * The running server with this ID, only if the guild may target it. For
 * actions that carry a stored server ID (no interaction option to resolve),
 * so a server hidden from the guild since the ID was stored is not reachable.
 * The operator exemption of resolveServer does not apply: the stored ID acts
 * on behalf of the guild, not of a person.
 */
export function getGuildScopedServer(
  guildId: string | undefined,
  serverId: string,
): ServerInstance | null {
  if (visibleServerIdsForGuild(guildId, [serverId]).length === 0) return null;
  return getServerInstance(serverId);
}

/**
 * The subset of `serverIds` the issuing context may target, for commands
 * that list data across servers. Operators (config.adminUsers) see all.
 */
export function filterTargetableServerIds(
  interaction: ServerContextInteraction,
  serverIds: readonly string[],
): string[] {
  const allowed = getAllowedServerIds(interaction.guild?.id);
  if (!allowed || isServerAdmin(interaction.user.id)) return [...serverIds];
  return serverIds.filter((id) => allowed.has(id));
}

/**
 * Resolve the ServerInstance for an interaction.
 *
 * Resolution order:
 * 1. An explicit `server` string option.
 * 2. The guild's `defaultServer`; a stale one is a config error.
 * 3. The only server the guild may target (in a DM, the only configured one).
 * 4. Otherwise an error listing the available IDs.
 *
 * Whichever way the server was resolved, the issuing guild must be
 * allowed to target it (multi-guild deployments only).
 *
 * @throws {Error} if no server can be resolved, or if this guild may not
 *                 target the resolved server.
 */
export function resolveServer(
  interaction: ServerContextInteraction,
): ServerInstance {
  const explicit = interaction.options.getString("server");
  let server: ServerInstance | null;
  if (explicit) {
    server = getServerInstance(explicit);
    if (!server) throw new Error(t("router.serverNotFound", { server: explicit }));
  } else {
    server = getGuildServer(interaction.guild?.id);
  }

  assertGuildMayTarget(interaction, server);
  return server;
}

/**
 * Resolve the ServerInstance, returning null instead of throwing.
 * Use this when the command should handle the missing-server case itself.
 */
export function tryResolveServer(
  interaction: ServerContextInteraction,
): ServerInstance | null {
  try {
    return resolveServer(interaction);
  } catch {
    return null;
  }
}
