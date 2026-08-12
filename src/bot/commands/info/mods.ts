/**
 * /mods command — lists all installed server mods, grouped by client-side requirement.
 *
 * Groups:
 *   🔒 Server-only      — clients do not need to install these
 *   📦 Client + Server  — clients must install these to join
 *   🔧 Optional (client)— clients may install for extra features
 *
 * Mod metadata is fetched from Modrinth in a single batched request and cached
 * in memory; the cache is invalidated automatically when downloaded_versions.json
 * changes on disk.
 */

import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { getModList, type ModInfo } from "@mcbot/core/utils/minecraft/modUtils.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { relativeAge } from "@mcbot/core/utils/relativeTime.js";
import { withErrorHandling } from "../middleware.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { requireCapability } from "@mcbot/core/utils/server/capabilities.js";
import { formatTime } from "@mcbot/core/utils/time.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Discord limits a single embed field value to 1024 characters. */
const FIELD_CHAR_LIMIT = 1024;

/**
 * Formats a list of mods as clickable Markdown links, split into chunks
 * that each fit within Discord's embed field limit.
 */
function formatModChunks(mods: ModInfo[]): string[] {
  if (mods.length === 0) return ["*None*"];

  const lines = mods.map((m) => `[${m.name}](${m.url})`);
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > FIELD_CHAR_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Adds one or more fields for a mod category, splitting across multiple
 * fields if the content exceeds Discord's per-field character limit.
 */
function addModFields(
  embed: ReturnType<typeof createEmbed>,
  label: string,
  mods: ModInfo[],
): void {
  const chunks = formatModChunks(mods);
  chunks.forEach((chunk, i) => {
    const name = i === 0 ? `${label} (${mods.length})` : `${label} (cont.)`;
    embed.addFields({ name, value: chunk, inline: false });
  });
}

// ── Command definition ────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("mods")
  .setDescription(
    "List all installed server mods, grouped by client-side requirement",
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);

  if (!server) throw new Error("Server not found.");

  // Friendly gate — /mods needs the suite's mod manifest.
  requireCapability(
    server,
    (c) => c.modManifest,
    "a mod manifest (common/downloaded_versions.json)",
  );

  // Read through the shared last-known cache, so a wrapper blip shows the mod
  // list from the last successful read rather than an error. The list a client
  // needs changes only on a mod update, so a slightly old one is still right
  // far more often than not. Same cache the dashboard uses — one source, one
  // behaviour.
  const { value: modList, stale } = await readThrough(
    server.id,
    "modList",
    () => getModList(server),
  );

  const total =
    modList.serverOnly.length +
    modList.clientOptional.length +
    modList.clientAndServer.length;

  const embed = createEmbed({
    title: `🧩 Installed Mods — ${server.id}`,
    description: `**${total}** mods installed`,
    color: EmbedColor.Modrinth, // Modrinth green
  });

  addModFields(embed, "📦 Client + Server", modList.clientAndServer);
  addModFields(embed, "🔧 Optional (client)", modList.clientOptional);
  addModFields(embed, "🔒 Server-only", modList.serverOnly);

  // When this came from the cache during an outage, say so — the same honesty
  // the dashboard's stale banner gives: an old list shown as current is worse
  // than an old list labelled old.
  const fetchedAt = formatTime(modList.fetchedAt);
  embed.setFooter({
    text: stale
      ? `Last known list from ${relativeAge(stale.asOf)} — the server isn't answering right now`
      : `Data from Modrinth · last fetched ${fetchedAt}`,
  });

  await interaction.editReply({ embeds: [embed] });
});
