/**
 * The one definition of "is this person a bot admin". A leaf module (it
 * imports only core), so the router, the middleware, the interaction
 * handlers and the hint registry can all depend on it without a cycle.
 */
import type { Interaction } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import {
  loadLinkedAccountsOrEmpty,
  findDiscordIdByMcName,
} from "@mcbot/core/utils/stores/linkUtils.js";

/**
 * Checks whether a Discord user is an admin.
 *
 * Admin lists may contain user IDs and role IDs (both are snowflakes): a
 * user qualifies if their ID is listed or they carry a listed role.
 *
 * Two scopes exist: `config.adminUsers` is operator level and valid
 * everywhere; `config.guilds[guildId].adminUsers` only counts for commands
 * issued from that guild (and, via resolveServer, only against servers the
 * guild may target). In DMs only the global list applies.
 */
export function isServerAdmin(
  discordUserId: string,
  memberRoleIds: readonly string[] = [],
  guildId?: string,
): boolean {
  const cfg = loadConfig();
  const matches = (list: readonly string[] | undefined): boolean =>
    !!list &&
    (list.includes(discordUserId) ||
      memberRoleIds.some((roleId) => list.includes(roleId)));

  if (matches(cfg.adminUsers)) return true;
  if (guildId && matches(cfg.guilds?.[guildId]?.adminUsers)) return true;
  return false;
}

/**
 * Extract the role IDs from an interaction's member, handling both the
 * cached GuildMember shape (roles.cache Map) and the raw API shape
 * (roles as a string array).
 *
 * Typed by the only field it reads, `member`, so any interaction that
 * carries one (chat command, button, autocomplete) can be passed directly.
 */
export function getMemberRoleIds(
  interaction: Pick<Interaction, "member">,
): string[] {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  return [...roles.cache.keys()];
}

/** Is the user behind this interaction an admin in the interaction's guild? */
export function isInvokerAdmin(
  interaction: Pick<Interaction, "user" | "member" | "guild">,
): boolean {
  return isServerAdmin(
    interaction.user.id,
    getMemberRoleIds(interaction),
    interaction.guild?.id,
  );
}

/**
 * In-game side: is this Minecraft player a bot admin? Requires a linked
 * Discord account; game chat has no guild, so only the global admin list
 * applies.
 */
export async function isLinkedPlayerAdmin(mcName: string): Promise<boolean> {
  const linked = await loadLinkedAccountsOrEmpty();
  const discordId = findDiscordIdByMcName(linked, mcName);
  return discordId !== null && isServerAdmin(discordId);
}
