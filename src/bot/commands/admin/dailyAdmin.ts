/**
 * /daily-admin — operator tooling for per-server daily-claim records.
 *
 * The v2 claim migration moved every existing streak under the FIRST
 * configured server: correct for single-server setups, arbitrary for
 * multi-server ones. This command fixes stranded data without hand-editing
 * claimedDaily.json:
 *
 *   /daily-admin move user:@x from:<server> to:<server> [overwrite]
 *   /daily-admin reset user:@x server:<server>
 *   /daily-admin show user:@x
 *
 * Every mutation lands in the admin audit log.
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import {
  createSuccessEmbed,
  createEmbed,
} from "../../utils/embedUtils.js";
import {
  loadClaimedStore,
  saveClaimedStore,
  getServerClaims,
} from "../../../common/utils/dailyStore.js";
import { getServerIds } from "../../../common/config.js";
import { recordAdminAction } from "../../../common/utils/adminAudit.js";
import { t } from "../../../common/utils/i18n.js";
import { formatDatetime } from "../../../common/utils/time.js";

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
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show a user's claim records across all servers")
      .addUserOption((o) =>
        o.setName("user").setDescription("The Discord user").setRequired(true),
      ),
  );

function assertKnownServer(id: string): void {
  if (!getServerIds().includes(id)) {
    throw new Error(
      t("dailyAdmin.unknownServer", {
        server: id,
        servers: getServerIds().join(", "),
      }),
    );
  }
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user", true);
    const store = await loadClaimedStore();

    if (sub === "move") {
      const from = interaction.options.getString("from", true);
      const to = interaction.options.getString("to", true);
      const overwrite = interaction.options.getBoolean("overwrite") ?? false;
      assertKnownServer(from);
      assertKnownServer(to);
      if (from === to) throw new Error(t("dailyAdmin.samServer"));

      const fromClaims = getServerClaims(store, from);
      const record = fromClaims[user.id];
      if (!record) {
        throw new Error(
          t("dailyAdmin.noRecord", { user: user.tag, server: from }),
        );
      }

      const toClaims = getServerClaims(store, to);
      if (toClaims[user.id] && !overwrite) {
        throw new Error(
          t("dailyAdmin.targetExists", { user: user.tag, server: to }),
        );
      }

      toClaims[user.id] = record;
      delete fromClaims[user.id];
      await saveClaimedStore(store);

      await recordAdminAction({
        action: "daily-move",
        server: to,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail: `${user.tag} (${user.id}): ${from} → ${to}`,
      });

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            t("dailyAdmin.moved", { user: user.tag, from, to }),
          ),
        ],
      });
      return;
    }

    if (sub === "reset") {
      const server = interaction.options.getString("server", true);
      assertKnownServer(server);

      const claims = getServerClaims(store, server);
      if (!claims[user.id]) {
        throw new Error(
          t("dailyAdmin.noRecord", { user: user.tag, server }),
        );
      }
      delete claims[user.id];
      await saveClaimedStore(store);

      await recordAdminAction({
        action: "daily-reset",
        server,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail: `${user.tag} (${user.id})`,
      });

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(t("dailyAdmin.reset", { user: user.tag, server })),
        ],
      });
      return;
    }

    // show
    const lines: string[] = [];
    for (const serverId of Object.keys(store.servers)) {
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
      color: 0x3498db,
    });
    await interaction.editReply({ embeds: [embed] });
  }),
  { ephemeral: true },
);
