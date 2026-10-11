/**
 * /players: every player who ever played on a server, with last activity.
 *
 * Stats files are the most complete "ever played" set; the whitelist and
 * usercache supply names; the session store supplies last-seen and online
 * state, but only since the bot began tracking.
 */
import { SlashCommandBuilder } from "discord.js";
import type { EmbedBuilder } from "discord.js";
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { formatLastSeen } from "../../utils/discordTime.js";
import { withErrorHandling } from "../middleware.js";
import {
  loadAllStats,
  flattenStats,
  findPlayTimeStat,
  formatPlaytime,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { loadKnownPlayers } from "@mcbot/core/utils/minecraft/whitelist.js";
import {
  loadSessionStore,
  getServerSessions,
} from "@mcbot/core/utils/stores/sessionStore.js";
import {
  buildRoster,
  filterInactive,
  sortRoster,
  type RosterEntry,
  type RosterSort,
} from "@mcbot/core/utils/minecraft/playerRoster.js";
import { t } from "@mcbot/core/utils/i18n.js";

const PER_PAGE = 20;
const MAX_DESCRIPTION = 4000;

export const data = new SlashCommandBuilder()
  .setName("players")
  .setDescription("List every player who has played on a server, with last activity")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  )
  .addStringOption((o) =>
    o
      .setName("sort")
      .setDescription("Order of the list (default: last seen)")
      .addChoices(
        { name: "Last seen", value: "last-seen" },
        { name: "Playtime", value: "playtime" },
        { name: "Name", value: "name" },
      ),
  )
  .addIntegerOption((o) =>
    o
      .setName("inactive")
      .setDescription("Only players whose last activity is older than this many days")
      .setMinValue(1)
      .setMaxValue(3650),
  )
  .addBooleanOption((o) =>
    o
      .setName("include_unknown")
      .setDescription("With inactive: also list players with no tracked activity"),
  );

function describeEntry(e: RosterEntry): string {
  const name = `**${e.name}**`;
  const playtime =
    e.playtimeTicks !== null && e.playtimeTicks > 0
      ? ` · ${formatPlaytime(e.playtimeTicks)}`
      : "";
  if (e.online) return `${name} · ${t("players.online")}${playtime}`;
  if (e.lastSeen !== null) {
    return `${name} · ${formatLastSeen(e.lastSeen)}${playtime}`;
  }
  return `${name} · ${t("players.beforeTracking")}${playtime}`;
}

function clamp(text: string): string {
  return text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
}

export function buildPages(
  entries: RosterEntry[],
  serverId: string,
): EmbedBuilder[] {
  const pages: EmbedBuilder[] = [];
  const count = t("players.count", { count: entries.length });
  for (let i = 0; i < entries.length; i += PER_PAGE) {
    const slice = entries.slice(i, i + PER_PAGE);
    pages.push(
      createEmbed({
        title: t("players.title", { server: serverId }),
        description: clamp(`${count}\n\n${slice.map(describeEntry).join("\n")}`),
      }),
    );
  }
  return pages;
}

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const sort = (interaction.options.getString("sort") ?? "last-seen") as RosterSort;
  const inactiveDays = interaction.options.getInteger("inactive");
  const includeUnknown = interaction.options.getBoolean("include_unknown") ?? false;

  const [allStats, known, sessionStore] = await Promise.all([
    loadAllStats(server),
    loadKnownPlayers(false, server),
    loadSessionStore(),
  ]);

  const statsPlaytime: Record<string, number> = {};
  for (const [uuid, file] of Object.entries(allStats)) {
    statsPlaytime[uuid] = findPlayTimeStat(flattenStats(file));
  }

  let roster = buildRoster({
    statsPlaytime,
    known,
    sessions: getServerSessions(sessionStore, server.id),
  });
  if (inactiveDays !== null) {
    roster = filterInactive(roster, inactiveDays, includeUnknown);
  }
  roster = sortRoster(roster, sort);

  if (roster.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: t("players.title", { server: server.id }),
          description:
            inactiveDays !== null
              ? t("players.noneInactive", { days: inactiveDays })
              : t("players.none"),
        }),
      ],
    });
    return;
  }

  const pages = buildPages(roster, server.id);
  const message = await interaction.editReply({
    embeds: [pages[0]!],
    components:
      pages.length > 1 ? [createPaginationButtons(0, pages.length)] : [],
  });
  if (pages.length > 1) {
    await handlePagination(message, interaction, pages);
  }
});
