/**
 * /poll — cross-platform polls (admin).
 *
 *   create   question + "options: A | B | C" + duration → posts a button
 *            embed in this channel and announces the poll in-game.
 *   status   live tallies for the open poll.
 *   close    force-close now (results announce both ways).
 *
 * Community decisions (world border, next event) usually exclude whoever
 * lives on the other platform; a poll votable via buttons AND `!vote <n>`
 * gets the actual playerbase heard. Linked accounts dedupe across both
 * sides (pollStore.voterKeyForMc). Admin-gated because creating a poll
 * broadcasts tellraw to the whole server.
 *
 * Span mode: `servers:"smp, creative"` (or `servers:all`) runs ONE poll
 * across several instances — merged tally, announcements on each
 * instance, `!vote` resolves it from any participant. The one-open-poll
 * invariant holds per participating server: creation fails while any
 * listed instance already has an open poll.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from "discord.js";
import { randomBytes } from "crypto";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import {
  resolveServer,
  assertMayTargetServerId,
  getAllowedServerIds,
} from "../../utils/guild/guildRouter.js";
import { getServerIds } from "@mcbot/core/config.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import {
  loadPollStore,
  savePollStore,
  getOpenPollForServer,
  pollServerIds,
  tallyPoll,
  MAX_POLL_OPTIONS,
  MIN_POLL_OPTIONS,
  type Poll,
} from "@mcbot/core/utils/stores/pollStore.js";
import {
  armPoll,
  attachCollectorToMessage,
  closePoll,
} from "../../logWatcher/watchers/schedulers/pollScheduler.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";

const DEFAULT_DURATION_HOURS = 24;
const MAX_DURATION_HOURS = 24 * 7;
const MAX_OPTION_LENGTH = 80;

export const data = new SlashCommandBuilder()
  .setName("poll")
  .setDescription("Cross-platform polls (Discord + in-game) | Admin only")
  .addSubcommand((sc) =>
    sc
      .setName("create")
      .setDescription("Create a poll votable via buttons and !vote")
      .addStringOption((o) =>
        o
          .setName("question")
          .setDescription("The question to vote on")
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName("options")
          .setDescription('2–5 options separated by "|", e.g. "Yes | No"')
          .setRequired(true)
          .setMaxLength(400),
      )
      .addIntegerOption((o) =>
        o
          .setName("duration")
          .setDescription(
            `Hours until the poll closes (default ${DEFAULT_DURATION_HOURS})`,
          )
          .setMinValue(1)
          .setMaxValue(MAX_DURATION_HOURS),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName("servers")
          .setDescription(
            'Span poll across several instances: "smp, creative" or "all"',
          )
          .setMaxLength(200),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("status")
      .setDescription("Show the open poll's current tallies")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("close")
      .setDescription("Close the open poll now")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  );

function parseOptions(raw: string): string[] {
  return raw
    .split(/[|;]/)
    .map((o) => o.trim().slice(0, MAX_OPTION_LENGTH))
    .filter(Boolean);
}

function pollEmbed(poll: Poll) {
  const optionLines = poll.options.map((o, i) => `**${i + 1}.** ${o}`);
  return createEmbed({
    title: `🗳️ ${poll.question}`,
    description: `${optionLines.join("\n")}\n\n${t("poll.howToVote")}\n⏳ ${t(
      "poll.ends",
    )} <t:${Math.floor(poll.endsAt / 1000)}:R>`,
    color: EmbedColor.Info,
    footer: { text: pollServerIds(poll).join(", ") },
  });
}

/**
 * Resolve the participating instances for `create`: the span list from
 * `servers:` ("all", or a comma/space separated set of IDs), otherwise
 * just the single resolved server. Every ID goes through the same
 * tenant-isolation check as resolveServer.
 */
function resolveParticipants(
  interaction: Parameters<typeof resolveServer>[0],
  primary: ServerInstance,
): ServerInstance[] {
  const raw = interaction.options.getString("servers")?.trim();
  if (!raw) return [primary];

  let ids: string[];
  if (raw.toLowerCase() === "all") {
    // "all" means every server THIS guild can see — in a multi-guild
    // deployment that is the guild's allowed set, never other tenants'.
    const allowed = getAllowedServerIds(interaction.guild?.id);
    ids = getServerIds().filter((id) => !allowed || allowed.has(id));
  } else {
    ids = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  }

  if (ids.length === 0) return [primary];
  // Explicit lists still go through the same tenant-isolation check as
  // resolveServer, per ID.
  return ids.map((id) => assertMayTargetServerId(interaction, id));
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const server = resolveServer(interaction);
    const store = await loadPollStore();
    const open = getOpenPollForServer(store, server.id);

    if (sub === "status") {
      if (!open) throw new Error(t("poll.noneActive", { server: server.id }));
      const counts = tallyPoll(open);
      const total = counts.reduce((a, b) => a + b, 0);
      const lines = open.options.map(
        (o, i) => `**${i + 1}.** ${o} — ${counts[i]}`,
      );
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: `🗳️ ${open.question}`,
            description: `${lines.join("\n")}\n\n${t("poll.resultTotal", {
              total,
            })}\n⏳ ${t("poll.ends")} <t:${Math.floor(open.endsAt / 1000)}:R>`,
            footer: { text: server.id },
          }),
        ],
      });
      return;
    }

    if (sub === "close") {
      if (!open) throw new Error(t("poll.noneActive", { server: server.id }));
      await closePoll(interaction.client, open.id);
      await recordAdminAction({
        action: "poll close",
        server: server.id,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail: open.question.slice(0, 80),
      });
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: t("poll.closedTitle"),
            description: t("poll.closed", { question: open.question }),
            color: EmbedColor.Success,
          }),
        ],
      });
      return;
    }

    // create
    if (!interaction.channelId) {
      throw new Error(t("poll.needChannel"));
    }

    const participants = resolveParticipants(interaction, server);
    // One open poll per PARTICIPATING server — a span poll may not
    // overlap any instance that already has one running.
    for (const inst of participants) {
      const existing = getOpenPollForServer(store, inst.id);
      if (existing) {
        throw new Error(
          t("poll.alreadyActiveOn", {
            server: inst.id,
            question: existing.question,
          }),
        );
      }
    }

    const question = interaction.options.getString("question", true).trim();
    const options = parseOptions(interaction.options.getString("options", true));
    if (
      options.length < MIN_POLL_OPTIONS ||
      options.length > MAX_POLL_OPTIONS
    ) {
      throw new Error(
        t("poll.badOptions", {
          min: MIN_POLL_OPTIONS,
          max: MAX_POLL_OPTIONS,
        }),
      );
    }
    const duration =
      interaction.options.getInteger("duration") ?? DEFAULT_DURATION_HOURS;

    const participantIds = participants.map((p) => p.id);
    const poll: Poll = {
      id: randomBytes(4).toString("hex"),
      question,
      options,
      guildId: interaction.guild?.id ?? null,
      channelId: interaction.channelId,
      messageId: "", // set right after the reply is sent
      serverId: participantIds[0] ?? server.id,
      ...(participantIds.length > 1 ? { serverIds: participantIds } : {}),
      createdBy: interaction.user.tag,
      createdById: interaction.user.id,
      createdAt: Date.now(),
      endsAt: Date.now() + duration * 3_600_000,
      votes: {},
      status: "open",
    };

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      options.map((o, i) =>
        new ButtonBuilder()
          .setCustomId(`poll:${poll.id}:${i}`)
          .setLabel(`${i + 1}. ${o}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      ),
    );

    const message = await interaction.editReply({
      embeds: [pollEmbed(poll)],
      components: [row],
    });
    poll.messageId = message.id;

    store.polls.push(poll);
    await savePollStore(store);
    armPoll(interaction.client, poll);
    attachCollectorToMessage(poll.id, message, poll.endsAt);

    await recordAdminAction({
      action: "poll create",
      server: participantIds.join(","),
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild?.id ?? null,
      detail: question.slice(0, 80),
    });

    // In-game announcement on every participating instance — a span
    // poll that only tells one server about itself defeats the point.
    for (const inst of participants) {
      try {
        await inst.sendCommand(
          `/tellraw @a ${JSON.stringify({
            text: t("poll.announceInGame", { question }),
            color: "gold",
          })}`,
        );
        for (let i = 0; i < options.length; i++) {
          await inst.sendCommand(
            `/tellraw @a ${JSON.stringify({
              text: `  ${i + 1}. ${options[i]}`,
              color: "yellow",
            })}`,
          );
        }
        await inst.sendCommand(
          `/tellraw @a ${JSON.stringify({
            text: t("poll.voteHint"),
            color: "gray",
          })}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          "polls",
          `In-game poll announcement failed on ${inst.id}: ${msg}`,
        );
      }
    }
  }),
);
