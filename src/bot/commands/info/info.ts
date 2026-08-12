/**
 * /info — what a player needs in order to join.
 *
 * The one question members ask that the bot could not answer: the address,
 * the Minecraft version, the loader, and whatever they have to install first.
 * `/status` reports whether the server is healthy, `/mods` lists every mod
 * including the server-only ones nobody needs to download. Neither answers
 * "what do I type and what do I install", so it was answered by a human in
 * chat, repeatedly, per new member.
 *
 * Everything here is best-effort and says which parts it could not establish,
 * because a confidently wrong join address or loader costs someone an evening.
 */

import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { withErrorHandling } from "../middleware.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { pingServer } from "@mcbot/core/utils/server/serverAccess.js";
import { parseVersionName } from "@mcbot/core/utils/minecraft/versionName.js";
import { getModList } from "@mcbot/core/utils/minecraft/modUtils.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { serverIsUp } from "@mcbot/schema/serverState.js";

export const data = new SlashCommandBuilder()
  .setName("info")
  .setDescription("How to join: address, version, loader and required mods")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const guildId = interaction.guild?.id;
  const cfg = server.config;

  const health = await server.getHealth();

  // The ping is the only channel that reports a version string, and it works
  // with the wrapper down. A server that is off cannot be asked at all, which
  // is why the version line has an explicit "unknown" rather than an omission.
  const ping = serverIsUp(health) ? await pingServer(cfg) : null;
  const version = parseVersionName(
    ping?.kind === "status" ? ping.result.version : null,
  );

  const embed = createEmbed({
    title: t("info.title", { server: server.id }, guildId),
    color: EmbedColor.Info,
  });

  embed.addFields({
    name: t("info.address", {}, guildId),
    value: cfg.publicAddress
      ? `\`${cfg.publicAddress}\``
      : t("info.addressUnset", {}, guildId),
    inline: false,
  });

  embed.addFields({
    name: t("info.version", {}, guildId),
    value: version.minecraftVersion ?? t("info.versionUnknown", {}, guildId),
    inline: true,
  });

  embed.addFields({
    name: t("info.loader", {}, guildId),
    value: version.loader ?? t("info.loaderUnknown", {}, guildId),
    inline: true,
  });

  if (cfg.modpack) {
    const { name, version: packVersion, url } = cfg.modpack;
    const label = packVersion ? `${name} ${packVersion}` : name;
    embed.addFields({
      name: t("info.modpack", {}, guildId),
      value: url ? `[${label}](${url})` : label,
      inline: false,
    });
  } else {
    // No modpack configured does not mean no mods: fall back to counting the
    // ones a client actually has to install, which is the number that decides
    // whether joining is a one-click job or an evening.
    embed.addFields({
      name: t("info.required", {}, guildId),
      value: await requiredModsSummary(server, guildId),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
});

/**
 * How many mods a client must install, as a sentence.
 *
 * Only the client-required sides count. Listing all of them here would
 * duplicate `/mods`, which already groups and links them properly, so this
 * gives the number and points there.
 */
async function requiredModsSummary(
  server: Parameters<typeof getModList>[0],
  guildId: string | undefined,
): Promise<string> {
  try {
    const mods = await getModList(server);
    // Only what a client must install to connect. `clientOptional` is a
    // choice and `serverOnly` is none of the player's business, so counting
    // either would inflate the answer to "what do I need".
    const required = mods.clientAndServer.length;
    if (required === 0) return t("info.vanillaJoin", {}, guildId);
    return t("info.requiredCount", { count: String(required) }, guildId);
  } catch {
    // The mod list needs the wrapper. Its absence is not worth failing the
    // whole command over — the address and version are still useful.
    return t("info.requiredUnknown", {}, guildId);
  }
}
