/**
 * !report <message> — in-game problem reports routed to Discord.
 *
 * Posts an embed (player head, server ID, timestamp, sanitized message)
 * to every guild that configured `reports.channelId` and whose report
 * scope covers this server, optionally mentioning `reports.mentionRole`.
 * The reporter gets a tellraw confirmation; if no guild is wired up for
 * this server they are told so instead of reporting into the void.
 *
 * First consumer of defineCommand's greedy last argument — report bodies
 * are free text, not single tokens. Aggressive per-player cooldown (120s)
 * keeps the channel spam-resistant.
 */
import { defineCommand } from "../defineCommand.js";
import { loadConfig } from "@mcbot/core/config.js";
import { serverInScope } from "../../utils/guildRouter.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import { stripControlChars } from "@mcbot/core/utils/sanitize.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";

const MAX_REPORT_LENGTH = 500;

const cmd = defineCommand({
  name: "report",
  description: "Report a problem to the admins: !report <message>",
  args: ["message..."],
  cooldown: 120,
  handler: async (username, { message }, client, server) => {
    const text = stripControlChars(message ?? "")
      .trim()
      .slice(0, MAX_REPORT_LENGTH);
    if (!text) {
      await server.sendCommand(`/msg ${username} ${t("report.usage")}`);
      return;
    }

    const guilds = loadConfig().guilds;
    let delivered = 0;

    for (const [guildId, gcfg] of Object.entries(guilds)) {
      const reports = gcfg.reports;
      if (!reports?.channelId) continue;
      if (!serverInScope(reports.server, server.id, guildId)) continue;

      try {
        const channel = await client.channels.fetch(reports.channelId);
        if (!channel || !("send" in channel)) continue;

        const embed = createPlayerEmbed(username, {
          title: t("report.embedTitle", { player: username }),
          description: text,
          color: 0xffa500,
          footer: { text: server.id },
        });

        await channel.send({
          ...(reports.mentionRole
            ? { content: `<@&${reports.mentionRole}>` }
            : {}),
          embeds: [embed],
        });
        delivered++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("report", `Failed to deliver report to ${guildId}: ${msg}`);
      }
    }

    if (delivered > 0) {
      await server.sendCommand(
        `/tellraw ${username} ${JSON.stringify({
          text: t("report.sent"),
          color: "green",
        })}`,
      );
    } else {
      await server.sendCommand(`/msg ${username} ${t("report.noChannel")}`);
    }
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
