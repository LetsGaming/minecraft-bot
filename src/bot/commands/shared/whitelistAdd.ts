/**
 * The shared implementation of /whitelist and /verify, which are intentional
 * aliases (the docs document them as such). Both command files re-export it
 * under their own command name.
 */
import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { invalidateWhitelistCache } from "@mcbot/core/utils/minecraft/whitelist.js";
import { assertMcName, playerConsoleCommand } from "./mcName.js";
import { createSuccessEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { recordAdd } from "@mcbot/core/utils/stores/whitelistAudit.js";
import { fetchMojangProfile } from "@mcbot/core/utils/minecraft/mojang.js";
import {
  requireAccepted,
  withUnverifiedNote,
} from "@mcbot/core/utils/server/commandOutcome.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";

import { t } from "@mcbot/core/utils/i18n.js";
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

export interface WhitelistAddResult {
  name: string;
  /** True when the server has no reply channel, so the add is unconfirmed. */
  unverified: boolean;
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
): Promise<WhitelistAddResult> {
  // Validated before the Mojang lookup: a clearer error than a failed
  // lookup for garbage input, and the name is part of the lookup URL.
  const name = assertMcName(username);

  const profile = await fetchMojangProfile(name);
  if (!profile) throw new Error(t("whitelist.notFound", { username: name }));

  // Use the canonical capitalization Mojang returns so the
  // whitelist entry matches the in-game name exactly.
  const canonicalName = profile.name ?? name;

  const verdict = requireAccepted(
    await server.send(
      playerConsoleCommand(canonicalName, "/whitelist", { text: "add" }, { player: canonicalName }),
    ),
    server.id,
    { refusal: /^That player does not exist/i },
  );
  await recordAdd(canonicalName, by.tag, by.id, server.id, profile.id);

  // The whitelist cache would otherwise serve the stale (pre-add)
  // list until restart — making the new player invisible to /whitelisted,
  // autocomplete, findPlayer, and leaderboards.
  invalidateWhitelistCache(server.id);

  return { name: canonicalName, ...verdict };
}

export const executeWhitelistAdd = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const username = interaction.options.getString("username", true);
    const server = resolveServer(interaction);
    const added = await performWhitelistAdd(server, username, {
      tag: interaction.user.tag,
      id: interaction.user.id,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          withUnverifiedNote(
            t("whitelist.added", { name: added.name, server: server.id }),
            added,
          ),
          { title: t("whitelist.addedTitle") },
        ),
      ],
    });
  }),
);
