/**
 * /note — admin notes on players (add | list | remove).
 *
 * Moderation memory: "warned about lag machines on 2026-05-01" gets a
 * durable home instead of living in someone's head. Notes are keyed by
 * Minecraft UUID (resolved through playerUtils, so they survive name
 * changes), every mutation goes through recordAdminAction, and /whois
 * renders the same notes inline for admin callers.
 *
 * Deliberately thin — annotations only, no ban database.
 */
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { findPlayer } from "@mcbot/core/utils/playerUtils.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { recordAdminAction } from "@mcbot/core/utils/adminAudit.js";
import { formatDatetime } from "@mcbot/core/utils/time.js";
import {
  loadNotesStore,
  saveNotesStore,
  addNote,
  removeNote,
  getNotesByUuid,
  findNotesByName,
  MAX_NOTES_PER_PLAYER,
  type PlayerNotesEntry,
} from "@mcbot/core/utils/noteStore.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { ChatInputCommandInteraction } from "discord.js";

const MAX_NOTE_LENGTH = 300;

export const data = new SlashCommandBuilder()
  .setName("note")
  .setDescription("Admin notes on players | Admin only")
  .addSubcommand((sc) =>
    sc
      .setName("add")
      .setDescription("Add a note to a player")
      .addStringOption((o) =>
        o
          .setName("player")
          .setDescription("Minecraft username")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName("text")
          .setDescription("Note text")
          .setRequired(true)
          .setMaxLength(MAX_NOTE_LENGTH),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("list")
      .setDescription("List a player's notes")
      .addStringOption((o) =>
        o
          .setName("player")
          .setDescription("Minecraft username")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("remove")
      .setDescription("Remove a note by its list index")
      .addStringOption((o) =>
        o
          .setName("player")
          .setDescription("Minecraft username")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o
          .setName("index")
          .setDescription("Note number from /note list")
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  );

/**
 * Resolve the note entry for a name: prefer the UUID via the server's
 * whitelist/usercache; fall back to the stored last-known name so notes
 * on players a server no longer knows stay reachable.
 */
async function resolveNotes(
  interaction: ChatInputCommandInteraction,
  playerName: string,
  store: Awaited<ReturnType<typeof loadNotesStore>>,
): Promise<{ uuid: string; name: string; entry: PlayerNotesEntry | null }> {
  const server = resolveServer(interaction);
  const known = await findPlayer(playerName, server).catch(() => null);
  if (known) {
    return {
      uuid: known.uuid,
      name: known.name,
      entry: getNotesByUuid(store, known.uuid),
    };
  }
  const byName = findNotesByName(store, playerName);
  if (byName) {
    return { uuid: byName.uuid, name: byName.entry.name, entry: byName.entry };
  }
  return { uuid: "", name: playerName, entry: null };
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const playerName = interaction.options.getString("player", true);
    if (!isValidMcName(playerName)) {
      throw new Error(t("common.invalidUsername", { username: playerName }));
    }

    const store = await loadNotesStore();
    const resolved = await resolveNotes(interaction, playerName, store);

    if (sub === "add") {
      if (!resolved.uuid) {
        throw new Error(t("note.unknownPlayer", { player: playerName }));
      }
      const text = interaction.options
        .getString("text", true)
        .trim()
        .slice(0, MAX_NOTE_LENGTH);
      if (!text) throw new Error(t("note.emptyText"));

      addNote(store, resolved.uuid, resolved.name, {
        text,
        author: interaction.user.tag,
        authorId: interaction.user.id,
        createdAt: formatDatetime(),
      });
      await saveNotesStore(store);

      await recordAdminAction({
        action: "note add",
        server: null,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail: `${resolved.name}: ${text.slice(0, 80)}`,
      });

      await interaction.editReply({
        embeds: [
          createEmbed({
            title: t("note.addedTitle"),
            description: t("note.added", { player: resolved.name }),
            color: EmbedColor.Success,
          }),
        ],
      });
      return;
    }

    if (sub === "remove") {
      const index = interaction.options.getInteger("index", true);
      if (!resolved.uuid || !removeNote(store, resolved.uuid, index)) {
        throw new Error(t("note.badIndex", { player: resolved.name }));
      }
      await saveNotesStore(store);

      await recordAdminAction({
        action: "note remove",
        server: null,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail: `${resolved.name}: #${index}`,
      });

      await interaction.editReply({
        embeds: [
          createEmbed({
            title: t("note.removedTitle"),
            description: t("note.removed", {
              index,
              player: resolved.name,
            }),
            color: EmbedColor.Success,
          }),
        ],
      });
      return;
    }

    // list
    const notes = resolved.entry?.notes ?? [];
    if (notes.length === 0) {
      throw new Error(t("note.none", { player: resolved.name }));
    }
    const lines = notes.map(
      (n, i) => `**${i + 1}.** [${n.createdAt}] ${n.author}: ${n.text}`,
    );
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: t("note.listTitle", { player: resolved.name }),
          description: lines.join("\n"),
          footer: {
            text: t("note.listFooter", {
              count: notes.length,
              max: MAX_NOTES_PER_PLAYER,
            }),
          },
        }),
      ],
    });
  }),
  { ephemeral: true },
);
