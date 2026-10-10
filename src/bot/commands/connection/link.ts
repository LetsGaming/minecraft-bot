import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction} from "discord.js";
import { randomBytes } from "crypto";
import { issueLinkCode } from "@mcbot/core/utils/stores/linkUtils.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId ?? undefined;

  // issueLinkCode is atomic: prune-expired + pending/linked checks + insert
  // happen in one transaction, so two concurrent /link invocations can't
  // race each other (or the in-game confirmation) anymore.
  const result = await issueLinkCode(userId, generateCode());

  if (result.status === "pending") {
    await interaction.reply({
      content: t("link.pending", { code: result.code }, guildId),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (result.status === "already-linked") {
    await interaction.reply({
      content: t("link.alreadyLinked", {}, guildId),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: t("link.instructions", { code: result.code }, guildId),
    flags: MessageFlags.Ephemeral,
  });
}

// Uses crypto.randomBytes for a cryptographically secure 8-char hex code
// (4 billion combinations). Replaces the old Math.random-based generator
// which was brute-forceable within the 5-minute expiry window.
function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
