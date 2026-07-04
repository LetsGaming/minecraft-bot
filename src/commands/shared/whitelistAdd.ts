/**
 * /whitelist and /verify were byte-identical duplicates. The shared
 * implementation now lives here; both command files re-export it with their
 * own command name. The two names are kept as intentional aliases (the docs
 * document them as such) so existing muscle memory keeps working.
 */
import { SlashCommandBuilder } from "discord.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { invalidateWhitelistCache } from "../../utils/utils.js";
import { isValidMcName } from "../../utils/sanitize.js";
import { createSuccessEmbed } from "../../utils/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { recordAdd } from "../../utils/whitelistAudit.js";
import type { MojangProfile } from "../../types/index.js";

export function buildWhitelistAddData(commandName: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(commandName)
    .setDescription("Verify a Minecraft username and whitelist it")
    .addStringOption((o) =>
      o
        .setName("username")
        .setDescription("Minecraft username")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Server instance")
        .setAutocomplete(true),
    ) as SlashCommandBuilder;
}

export const executeWhitelistAdd = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const username = interaction.options.getString("username", true);
    const server = resolveServer(interaction);
    if (!server) throw new Error("Server not found.");

    // Validate the username format before it reaches a console
    // command or a Mojang API URL. Rejecting here also gives a clearer
    // error than a failed Mojang lookup for garbage input.
    if (!isValidMcName(username)) {
      throw new Error(`**${username}** is not a valid Minecraft username.`);
    }

    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
    );
    if (!res.ok) throw new Error(`Username **${username}** not found.`);

    const profile = (await res.json()) as MojangProfile;

    // Use the canonical capitalization Mojang returns so the
    // whitelist entry matches the in-game name exactly.
    const canonicalName = profile.name ?? username;

    await server.sendCommand(`/whitelist add ${canonicalName}`);
    await recordAdd(
      canonicalName,
      interaction.user.tag,
      interaction.user.id,
      server.id,
      profile.id,
    );

    // The whitelist cache would otherwise serve the stale (pre-add)
    // list until restart — making the new player invisible to /whitelisted,
    // autocomplete, findPlayer, and leaderboards.
    invalidateWhitelistCache(server.id);

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          `**${canonicalName}** has been whitelisted on **${server.id}**.`,
        ),
      ],
    });
  }),
);
