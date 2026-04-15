/**
 * Guild router — resolves the target ServerInstance for a Discord interaction.
 *
 * All commands must use resolveServer() instead of calling getServerInstance()
 * or getGuildServer() directly. This centralizes resolution logic and makes
 * commands trivially testable by swapping the resolver.
 */
import { getServerInstance, getGuildServer } from './server.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { ServerInstance } from './server.js';

/**
 * Resolve the ServerInstance for an interaction.
 *
 * Resolution order:
 * 1. If the interaction has an explicit `server` string option, use that ID.
 * 2. Otherwise, fall back to the guild's configured `defaultServer`.
 * 3. If neither is set, use the first registered server instance.
 *
 * @throws {Error} if no server can be resolved (misconfiguration or unknown ID).
 */
export function resolveServer(
  interaction: ChatInputCommandInteraction,
): ServerInstance {
  const explicit = interaction.options.getString('server');
  const server = explicit
    ? getServerInstance(explicit)
    : getGuildServer(interaction.guild?.id);

  if (!server) {
    throw new Error(
      explicit
        ? `Server "${explicit}" not found.`
        : 'No server configured for this guild.',
    );
  }
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
