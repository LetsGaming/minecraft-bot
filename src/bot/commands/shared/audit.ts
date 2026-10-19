import type { Interaction } from "discord.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";

/** Records an admin action attributed to whoever ran the interaction. Never throws. */
export function auditAdminAction(
  interaction: Pick<Interaction, "user" | "guild" | "guildId">,
  entry: { action: string; server?: string; detail?: string },
): Promise<void> {
  return recordAdminAction({
    action: entry.action,
    ...(entry.server !== undefined ? { server: entry.server } : {}),
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    by: interaction.user.tag,
    byId: interaction.user.id,
    guildId: interaction.guild?.id ?? interaction.guildId ?? null,
  });
}
