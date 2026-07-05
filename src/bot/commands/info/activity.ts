/**
 * /activity — player-count history: a 24h sparkline plus the busiest
 * local hours, from the per-hour series the status/downtime passes sample
 * anyway. Answers "when is the server busy" without opening Grafana.
 */
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import {
  loadPlayerCountStore,
  buildActivitySparkline,
  busiestHours,
} from "../../../common/utils/playerCountHistory.js";
import { TZ } from "../../../common/utils/time.js";
import { t } from "../../../common/utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("activity")
  .setDescription("Player-count history: when is this server busy?")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const store = await loadPlayerCountStore();
  const series = store.servers[server.id] ?? [];

  if (series.length === 0) {
    throw new Error(t("activity.noData", { server: server.id }));
  }

  const now = Date.now();
  const { line, peak } = buildActivitySparkline(series, now, 24);
  const busy = busiestHours(series, 3);

  const busyLines = busy.map((b) =>
    t("activity.busyLine", {
      hour: String(b.hour).padStart(2, "0"),
      next: String((b.hour + 1) % 24).padStart(2, "0"),
      avg: b.avg.toFixed(1),
    }),
  );

  const embed = createEmbed({
    title: t("activity.title", { server: server.id }),
    description:
      `${t("activity.last24h")}\n\`${line}\`\n` +
      `${t("activity.peak", { peak })}\n\n` +
      `${t("activity.busiest", { tz: TZ })}\n` +
      (busyLines.length > 0 ? busyLines.join("\n") : t("activity.noBusyData")),
    color: 0x00bfff,
    footer: { text: server.id },
  });

  await interaction.editReply({ embeds: [embed] });
});
