/**
 * /challenge — advancement challenges (admin).
 *
 *   start   advancement:<name in chat> [reward:<text>] [item:<id>]
 *           [amount:<n>] [duration:<hours>] [server:<id>]
 *   status  show the active (or most recent) challenge
 *   cancel  cancel the active challenge
 *
 * The advancements watcher does the detection; this command owns the
 * lifecycle. One challenge per server at a time. Starting announces the
 * challenge to Discord (notifications event "challenge") and in-game;
 * every start/cancel writes an admin-audit entry.
 */
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { recordAdminAction } from "@mcbot/core/utils/adminAudit.js";
import { broadcastNotification } from "../../logWatcher/watchers/notifyGuilds.js";
import { loadConfig } from "@mcbot/core/config.js";
import {
  loadChallengeStore,
  saveChallengeStore,
  expireStale,
  getActiveChallenge,
  getLatestChallenge,
  addChallenge,
  type Challenge,
} from "@mcbot/core/utils/challengeStore.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";

const MAX_DURATION_HOURS = 24 * 14; // two weeks

export const data = new SlashCommandBuilder()
  .setName("challenge")
  .setDescription("Advancement challenges | Admin only")
  .addSubcommand((sc) =>
    sc
      .setName("start")
      .setDescription("Start a challenge: first player to earn X wins")
      .addStringOption((o) =>
        o
          .setName("advancement")
          .setDescription('Advancement name as shown in chat, e.g. "Stone Age"')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((o) =>
        o
          .setName("reward")
          .setDescription("Reward description shown in announcements")
          .setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName("item")
          .setDescription('Item bonus delivered on win, e.g. "diamond"'),
      )
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("Item amount (default 1)")
          .setMinValue(1)
          .setMaxValue(64),
      )
      .addIntegerOption((o) =>
        o
          .setName("duration")
          .setDescription("Hours until the challenge expires (default: none)")
          .setMinValue(1)
          .setMaxValue(MAX_DURATION_HOURS),
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
      .setName("status")
      .setDescription("Show the active (or most recent) challenge")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("cancel")
      .setDescription("Cancel the active challenge")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  );

function statusEmbed(challenge: Challenge, serverId: string) {
  const lines = [
    t("challenge.fieldAdvancement", { advancement: challenge.advancement }),
  ];
  if (challenge.reward) {
    lines.push(t("challenge.rewardLine", { reward: challenge.reward }));
  }
  if (challenge.item) {
    lines.push(
      t("challenge.fieldItem", {
        amount: challenge.amount ?? 1,
        item: challenge.item,
      }),
    );
  }
  lines.push(
    t("challenge.fieldStartedBy", {
      by: challenge.startedBy,
      when: `<t:${Math.floor(challenge.startedAt / 1000)}:R>`,
    }),
  );
  if (challenge.endsAt) {
    lines.push(
      t("challenge.fieldEnds", {
        when: `<t:${Math.floor(challenge.endsAt / 1000)}:R>`,
      }),
    );
  }
  if (challenge.status === "won" && challenge.wonBy) {
    lines.push(t("challenge.fieldWonBy", { player: challenge.wonBy }));
  }
  return createEmbed({
    title: t("challenge.statusTitle", {
      status: t(`challenge.status.${challenge.status}`),
    }),
    description: lines.join("\n"),
    color: challenge.status === "active" ? EmbedColor.Gold : EmbedColor.Info,
    footer: { text: serverId },
  });
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const server = resolveServer(interaction);
    const store = await loadChallengeStore();
    const expired = expireStale(store, server.id);

    if (sub === "status") {
      if (expired) await saveChallengeStore(store);
      const latest =
        getActiveChallenge(store, server.id) ??
        getLatestChallenge(store, server.id);
      if (!latest) {
        throw new Error(t("challenge.noneYet", { server: server.id }));
      }
      await interaction.editReply({ embeds: [statusEmbed(latest, server.id)] });
      return;
    }

    if (sub === "cancel") {
      const active = getActiveChallenge(store, server.id);
      if (!active) {
        if (expired) await saveChallengeStore(store);
        throw new Error(t("challenge.noneActive", { server: server.id }));
      }
      active.status = "cancelled";
      await saveChallengeStore(store);
      await recordAdminAction({
        action: "challenge cancel",
        server: server.id,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail: active.advancement,
      });
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: t("challenge.cancelledTitle"),
            description: t("challenge.cancelled", {
              advancement: active.advancement,
            }),
            color: EmbedColor.Error,
          }),
        ],
      });
      return;
    }

    // start
    const existing = getActiveChallenge(store, server.id);
    if (existing) {
      if (expired) await saveChallengeStore(store);
      throw new Error(
        t("challenge.alreadyActive", { advancement: existing.advancement }),
      );
    }

    const advancement = interaction.options
      .getString("advancement", true)
      .trim();
    const reward = interaction.options.getString("reward")?.trim();
    const item = interaction.options.getString("item")?.trim();
    const amount = interaction.options.getInteger("amount") ?? undefined;
    const duration = interaction.options.getInteger("duration");

    const challenge: Challenge = {
      advancement,
      ...(reward ? { reward } : {}),
      ...(item ? { item } : {}),
      ...(amount !== undefined ? { amount } : {}),
      startedBy: interaction.user.tag,
      startedById: interaction.user.id,
      startedAt: Date.now(),
      ...(duration ? { endsAt: Date.now() + duration * 3_600_000 } : {}),
      status: "active",
    };
    addChallenge(store, server.id, challenge);
    await saveChallengeStore(store);

    await recordAdminAction({
      action: "challenge start",
      server: server.id,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild?.id ?? null,
      detail: advancement,
    });

    const rewardLine = reward
      ? `\n${t("challenge.rewardLine", { reward })}`
      : "";
    await broadcastNotification(interaction.client, loadConfig().guilds, {
      serverId: server.id,
      event: "challenge",
      logTag: "challenges",
      buildEmbed: (withServerFooter) =>
        createEmbed({
          title: t("challenge.startedTitle"),
          description:
            t("challenge.startedEmbed", { advancement }) + rewardLine,
          color: EmbedColor.Gold,
          ...(withServerFooter ? { footer: { text: server.id } } : {}),
        }),
    });

    try {
      await server.sendCommand(
        `/tellraw @a ${JSON.stringify({
          text: t("challenge.startedInGame", { advancement }),
          color: "gold",
        })}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("challenges", `In-game announcement failed: ${msg}`);
    }

    await interaction.editReply({
      embeds: [statusEmbed(challenge, server.id)],
    });
  }),
);
