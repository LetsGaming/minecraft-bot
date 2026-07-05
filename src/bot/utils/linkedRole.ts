/**
 * Auto-role on link — assign each guild's configured `linkedRole` when a
 * member links their Minecraft account, remove it on unlink.
 *
 * Contract from the plan: role failures (missing Manage Roles, role above
 * the bot in the hierarchy, member not in the guild) go to the admin
 * audit log and NEVER fail the link itself — this function does not
 * throw. Role validation happens at config time (validateCandidateConfig
 * checks the shape); the hierarchy can only be checked here at runtime.
 */
import type { Client } from "discord.js";
import type { GuildConfig } from "../../common/types/index.js";
import { loadConfig } from "../../common/config.js";
import { recordAdminAction } from "../../common/utils/adminAudit.js";
import { log } from "../../common/utils/logger.js";

export async function syncLinkedRole(
  client: Client,
  discordId: string,
  action: "add" | "remove",
): Promise<void> {
  // Whole-body guard: even a broken config read must not fail the link.
  let guilds: Record<string, GuildConfig>;
  try {
    guilds = loadConfig().guilds;
  } catch {
    return;
  }

  for (const [guildId, gcfg] of Object.entries(guilds)) {
    const roleId = gcfg.linkedRole;
    if (!roleId) continue;

    try {
      const guild =
        client.guilds.cache.get(guildId) ??
        (await client.guilds.fetch(guildId));
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue; // linked user isn't in this guild — fine

      if (action === "add") {
        if (member.roles.cache.has(roleId)) continue;
        await member.roles.add(roleId, "Minecraft account linked");
      } else {
        if (!member.roles.cache.has(roleId)) continue;
        await member.roles.remove(roleId, "Minecraft account unlinked");
      }
      log.info(
        "linkedRole",
        `${action === "add" ? "Assigned" : "Removed"} role ${roleId} for ${discordId} in ${guildId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        "linkedRole",
        `Failed to ${action} role ${roleId} for ${discordId} in ${guildId}: ${msg}`,
      );
      await recordAdminAction({
        action: `linkedRole ${action} failed`,
        server: null,
        by: "bot",
        byId: client.user?.id ?? "-",
        guildId,
        detail: `${discordId}: ${msg.slice(0, 120)}`,
      });
    }
  }
}
