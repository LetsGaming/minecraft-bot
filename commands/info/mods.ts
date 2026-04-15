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
import { createEmbed } from "../../utils/embedUtils.js";
import { getModList, type ModInfo } from "../../utils/modUtils.js";
import { withErrorHandling } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";

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
  const serverId = interaction.options.getString("server");
  const server = resolveServer(interaction);

  if (!server) throw new Error("Server not found.");

  const cfg = server.config;

  if (!cfg.scriptDir) {
    throw new Error(
      "No `scriptDir` configured for this server.\n" +
        "The mods list is read from `{scriptDir}/common/downloaded_versions.json`.",
    );
  }

  const modList = await getModList(cfg.scriptDir);

  const total =
    modList.serverOnly.length +
    modList.clientOptional.length +
    modList.clientAndServer.length;

  const embed = createEmbed({
    title: `🧩 Installed Mods — ${server.id}`,
    description: `**${total}** mods installed`,
    color: 0x1bd96a, // Modrinth green
  });

  addModFields(embed, "📦 Client + Server", modList.clientAndServer);
  addModFields(embed, "🔧 Optional (client)", modList.clientOptional);
  addModFields(embed, "🔒 Server-only", modList.serverOnly);

  const fetchedAt = new Date(modList.fetchedAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  embed.setFooter({ text: `Data from Modrinth · last fetched ${fetchedAt}` });

  await interaction.editReply({ embeds: [embed] });
});
