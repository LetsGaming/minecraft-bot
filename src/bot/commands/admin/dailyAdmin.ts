/**
 * /daily-admin: operator tooling for per-server daily-claim records, to move,
 * reset or inspect a user's streak without hand-editing the store:
 *
 *   /daily-admin move user:@x from:<server> to:<server> [overwrite]
 *   /daily-admin reset user:@x [server:<server>]
 *   /daily-admin show user:@x
 *   /daily-admin queue action:show|clear|retry [user:@x | player:<name>] [server:<server>]
 *
 * Servers outside the issuing guild's allowed set are refused. Every
 * mutation lands in the admin audit log.
 */
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import {
  createSuccessEmbed,
  createEmbed,
} from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import {
  loadClaimedStore,
  updateClaimedStore,
  getServerClaims,
  peekPlayerQueue,
  clearPlayerQueue,
  retryFailed,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { getLinkedAccount } from "@mcbot/core/utils/stores/linkStore.js";
import { formatItemList } from "@mcbot/core/utils/minecraft/itemNames.js";
import {
  assertMayTargetServerId,
  filterTargetableServerIds,
  resolveServer,
} from "../../utils/guild/guildRouter.js";
import { auditAdminAction } from "../shared/audit.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { formatDatetime } from "@mcbot/core/utils/time.js";

export const data = new SlashCommandBuilder()
  .setName("daily-admin")
  .setDescription("Manage per-server daily claim records (admin)")
  .addSubcommand((sub) =>
    sub
      .setName("move")
      .setDescription("Move a user's claim record from one server to another")
      .addUserOption((o) =>
        o.setName("user").setDescription("The Discord user").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("from")
          .setDescription("Server the record currently lives under")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("to")
          .setDescription("Server the record should move to")
          .setRequired(true),
      )
      .addBooleanOption((o) =>
        o
          .setName("overwrite")
          .setDescription("Replace an existing record on the target server"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Delete a user's claim record on one server")
      .addUserOption((o) =>
        o.setName("user").setDescription("The Discord user").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server to reset the record on")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show a user's claim records across all servers")
      .addUserOption((o) =>
        o.setName("user").setDescription("The Discord user").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("queue")
      .setDescription("Show, clear or retry a player's queued and failed rewards")
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("What to do with the queue")
          .setRequired(true)
          .addChoices(
            { name: "show", value: "show" },
            { name: "clear", value: "clear" },
            { name: "retry", value: "retry" },
          ),
      )
      .addUserOption((o) => o.setName("user").setDescription("The Discord user"))
      .addStringOption((o) =>
        o
          .setName("player")
          .setDescription("Minecraft name, for rewards without a Discord user"),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server to look at")
          .setAutocomplete(true),
      ),
  );

/** Lines shown per list; the rest are summarised so the embed stays under Discord's limit. */
const QUEUE_LINES_SHOWN = 15;

async function runQueue(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString("action", true);
  const user = interaction.options.getUser("user");
  let player = interaction.options.getString("player")?.trim();
  if (!player) {
    if (!user) throw new Error(t("dailyAdmin.queueNeedsTarget"));
    const linked = await getLinkedAccount(user.id);
    if (!linked) throw new Error(t("dailyAdmin.queueNotLinked", { user: user.tag }));
    player = linked;
  }
  const server = resolveServer(interaction).id;

  if (action === "clear") {
    const count = await clearPlayerQueue(server, player);
    await auditAdminAction(interaction, {
      action: "daily-queue-clear",
      server,
      detail: `${player}: ${count} entries`,
    });
    await interaction.editReply({
      embeds: [
        createSuccessEmbed(t("dailyAdmin.queueCleared", { count, player, server }), {
          title: t("dailyAdmin.queueClearedTitle"),
        }),
      ],
    });
    return;
  }

  if (action === "retry") {
    const count = await retryFailed(server, player);
    if (count === 0) throw new Error(t("dailyAdmin.queueRetryNone", { player, server }));
    await auditAdminAction(interaction, {
      action: "daily-queue-retry",
      server,
      detail: `${player}: ${count} entries`,
    });
    await interaction.editReply({
      embeds: [
        createSuccessEmbed(t("dailyAdmin.queueRetried", { count, player, server }), {
          title: t("dailyAdmin.queueRetriedTitle"),
        }),
      ],
    });
    return;
  }

  const { pending, failed } = peekPlayerQueue(server, player);
  const sections: string[] = [];
  const cut = (lines: string[]): string[] =>
    lines.length > QUEUE_LINES_SHOWN
      ? [...lines.slice(0, QUEUE_LINES_SHOWN), `… +${lines.length - QUEUE_LINES_SHOWN}`]
      : lines;
  if (pending.length > 0) {
    sections.push(
      [
        t("dailyAdmin.queuePending", { count: pending.length }),
        ...cut(
          pending.map((e) => `• ${formatItemList(e.items)} · ${formatDatetime(e.queuedAt)}`),
        ),
      ].join("\n"),
    );
  }
  if (failed.length > 0) {
    sections.push(
      [
        t("dailyAdmin.queueFailed", { count: failed.length }),
        ...cut(
          failed.map(
            (e) =>
              `• ${formatItemList(e.items)} · ${t(`dailyAdmin.queueReason.${e.reason}`)} · ${formatDatetime(e.failedAt)}`,
          ),
        ),
      ].join("\n"),
    );
  }

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: t("dailyAdmin.queueTitle", { player, server }),
        description:
          sections.length > 0
            ? sections.join("\n\n")
            : t("dailyAdmin.queueEmpty", { player, server }),
        color: EmbedColor.Info,
      }),
    ],
  });
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === "queue") {
      await runQueue(interaction);
      return;
    }
    const user = interaction.options.getUser("user", true);

    if (sub === "move") {
      const from = interaction.options.getString("from", true);
      const to = interaction.options.getString("to", true);
      const overwrite = interaction.options.getBoolean("overwrite") ?? false;
      assertMayTargetServerId(interaction, from);
      assertMayTargetServerId(interaction, to);
      if (from === to) throw new Error(t("dailyAdmin.samServer"));

      await updateClaimedStore((current) => {
        const fromClaims = getServerClaims(current, from);
        const record = fromClaims[user.id];
        if (!record) {
          throw new Error(
            t("dailyAdmin.noRecord", { user: user.tag, server: from }),
          );
        }

        const toClaims = getServerClaims(current, to);
        if (toClaims[user.id] && !overwrite) {
          throw new Error(
            t("dailyAdmin.targetExists", { user: user.tag, server: to }),
          );
        }

        toClaims[user.id] = record;
        delete fromClaims[user.id];
      });

      await auditAdminAction(interaction, {
        action: "daily-move",
        server: to,
        detail: `${user.tag} (${user.id}): ${from} → ${to}`,
      });

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(t("dailyAdmin.moved", { user: user.tag, from, to }), {
            title: t("dailyAdmin.movedTitle"),
          }),
        ],
      });
      return;
    }

    if (sub === "reset") {
      const server = resolveServer(interaction).id;

      await updateClaimedStore((current) => {
        const claims = getServerClaims(current, server);
        if (!claims[user.id]) {
          throw new Error(
            t("dailyAdmin.noRecord", { user: user.tag, server }),
          );
        }
        delete claims[user.id];
      });

      await auditAdminAction(interaction, {
        action: "daily-reset",
        server,
        detail: `${user.tag} (${user.id})`,
      });

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(t("dailyAdmin.reset", { user: user.tag, server }), {
            title: t("dailyAdmin.resetTitle"),
          }),
        ],
      });
      return;
    }

    // show
    const store = await loadClaimedStore();
    const lines: string[] = [];
    const visible = filterTargetableServerIds(
      interaction,
      Object.keys(store.servers),
    );
    for (const serverId of visible) {
      const record = store.servers[serverId]?.[user.id];
      if (!record) continue;
      lines.push(
        t("dailyAdmin.showLine", {
          server: serverId,
          streak: record.currentStreak,
          longest: record.longestStreak,
          last: formatDatetime(record.lastClaim),
        }),
      );
    }

    const embed = createEmbed({
      title: t("dailyAdmin.showTitle", { user: user.tag }),
      description:
        lines.length > 0 ? lines.join("\n") : t("dailyAdmin.showNone"),
      color: EmbedColor.Info,
    });
    await interaction.editReply({ embeds: [embed] });
  }),
  { ephemeral: true },
);
