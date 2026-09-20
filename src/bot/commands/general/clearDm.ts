/**
 * /clear-dm — deletes the bot's own messages from the invoking user's DM.
 *
 * Self-service only: it only ever touches the DM between the bot and
 * whoever ran the command, so no admin gate is needed — a user can only
 * ever clean up their own conversation with the bot.
 *
 * DM channels have no bulk-delete API (unlike guild text channels, see
 * /clear), so messages are collected first, then deleted one at a time
 * with a delay to stay under Discord's per-message rate limit.
 */
import {
  SlashCommandBuilder,
  AttachmentBuilder,
  type DMChannel,
  type Message,
} from "discord.js";
import { withErrorHandling } from "../middleware.js";
import {
  createSuccessEmbed,
  createInfoEmbed,
} from "../../utils/embeds/embedUtils.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";

const FETCH_PAGE_SIZE = 100; // Discord's per-request fetch cap
const DELETE_DELAY_MS = 350; // stays under the per-channel delete rate limit

export const data = new SlashCommandBuilder()
  .setName("clear-dm")
  .setDescription("Delete the bot's own messages from your DM with it")
  .addIntegerOption((o) =>
    o
      .setName("amount")
      .setDescription("How many to delete (omit for all)")
      .setMinValue(1),
  )
  .addBooleanOption((o) =>
    o
      .setName("save_history")
      .setDescription("Send a .txt backup of the deleted messages first"),
  );

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Every message the bot authored in `dm`, newest first, up to `amount`. */
async function collectBotMessages(
  dm: DMChannel,
  botId: string,
  amount: number,
): Promise<Message[]> {
  const matched: Message[] = [];
  let before: string | undefined;

  while (matched.length < amount) {
    const page = await dm.messages.fetch({ limit: FETCH_PAGE_SIZE, before });
    if (page.size === 0) break;
    before = page.last()?.id;
    for (const msg of page.values()) {
      if (msg.author.id === botId) matched.push(msg);
    }
    if (page.size < FETCH_PAGE_SIZE) break;
  }

  if (matched.length > amount) matched.length = amount;
  return matched;
}

/** A plain-text transcript of the deleted messages, oldest first. */
function buildBackup(messages: readonly Message[]): Buffer {
  const lines = [...messages].reverse().map((msg) => {
    const body = msg.cleanContent || "[attachment/embed]";
    const links = msg.attachments.map((a) => `  > ${a.url}`).join("\n");
    return `[${msg.createdAt.toISOString()}]\n${body}${links ? `\n${links}` : ""}`;
  });
  return Buffer.from(lines.join("\n\n"), "utf-8");
}

export const execute = withErrorHandling(
  async (interaction) => {
    const amount = interaction.options.getInteger("amount") ?? Infinity;
    const saveHistory =
      interaction.options.getBoolean("save_history") ?? false;

    const dm = await interaction.user.createDM();
    const matched = await collectBotMessages(
      dm,
      interaction.client.user.id,
      amount,
    );

    if (matched.length === 0) {
      await interaction.editReply({
        embeds: [createInfoEmbed(t("clearDm.none"))],
      });
      return;
    }

    let deleted = 0;
    for (const msg of matched) {
      try {
        await msg.delete();
        deleted++;
      } catch (err) {
        log.warn(
          "clear-dm",
          `Failed to delete message ${msg.id}: ${errMsg(err)}`,
        );
      }
      await sleep(DELETE_DELAY_MS);
    }

    const embed = createSuccessEmbed(t("clearDm.deleted", { count: deleted }));
    if (!saveHistory) {
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    await interaction.editReply({
      embeds: [embed],
      files: [
        new AttachmentBuilder(buildBackup(matched), {
          name: "clear-dm-backup.txt",
        }),
      ],
    });
  },
  { ephemeral: true },
);
