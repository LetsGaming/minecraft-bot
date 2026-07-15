/**
 * /whitelist and /verify were byte-identical duplicates. The shared
 * implementation now lives here; both command files re-export it with their
 * own command name. The two names are kept as intentional aliases (the docs
 * document them as such) so existing muscle memory keeps working.
 */
import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { invalidateWhitelistCache } from "@mcbot/core/utils/minecraft/whitelist.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { createSuccessEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { recordAdd } from "@mcbot/core/utils/stores/whitelistAudit.js";
import { fetchMojangProfile } from "@mcbot/core/utils/minecraft/mojang.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";

export function buildWhitelistAddData(
  commandName: string,
): SlashCommandOptionsOnlyBuilder {
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
    );
}

/**
 * The whitelist-add core, shared by the slash path below and the
 * whitelist-application approval flow: format check, Mojang lookup for
 * the canonical capitalization, console add, audit entry, cache
 * invalidation. Throws user-presentable errors.
 */
export async function performWhitelistAdd(
  server: ServerInstance,
  username: string,
  by: { tag: string; id: string },
): Promise<string> {
  // Validate the username format before it reaches a console
  // command or a Mojang API URL. Rejecting here also gives a clearer
  // error than a failed Mojang lookup for garbage input.
  if (!isValidMcName(username)) {
    throw new Error(`**${username}** is not a valid Minecraft username.`);
  }

  const profile = await fetchMojangProfile(username);
  if (!profile) throw new Error(`Username **${username}** not found.`);

  // Use the canonical capitalization Mojang returns so the
  // whitelist entry matches the in-game name exactly.
  const canonicalName = profile.name ?? username;

  await server.sendCommand(`/whitelist add ${canonicalName}`);
  await recordAdd(canonicalName, by.tag, by.id, server.id, profile.id);

  // The whitelist cache would otherwise serve the stale (pre-add)
  // list until restart — making the new player invisible to /whitelisted,
  // autocomplete, findPlayer, and leaderboards.
  invalidateWhitelistCache(server.id);

  return canonicalName;
}

export const executeWhitelistAdd = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const username = interaction.options.getString("username", true);
    const server = resolveServer(interaction);
    if (!server) throw new Error("Server not found.");

    const canonicalName = await performWhitelistAdd(server, username, {
      tag: interaction.user.tag,
      id: interaction.user.id,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          `**${canonicalName}** has been whitelisted on **${server.id}**.`,
        ),
      ],
    });
  }),
);
