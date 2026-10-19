/**
 * Milestone posts: "X just passed 1,000 hours" style announcements.
 *
 * Config (top level; values in the stat's native unit: playtime is
 * ticks, distances are cm, counters are counts):
 *
 *   "milestones": {
 *     "playtime": [7200000, 72000000],   // 100h, 1000h in ticks
 *     "diamonds": [100, 1000]
 *   }
 *
 * Hourly pass per server: read the stats files (same loaders as the
 * leaderboards), extract each configured stat per player, and announce
 * the highest newly-crossed threshold in-game (/say) and to each guild's
 * notifications channel (event "milestone").
 *
 * First activation would otherwise blast every veteran's whole history
 * at once, so the first pass per server+stat SEEDS silently: current
 * values are recorded as already-announced, and only crossings after
 * that get posted. The milestone store is the single owner of that state.
 */
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { MS } from "@mcbot/schema";
import { type Client } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import { getAllInstances } from "@mcbot/core/utils/server/server.js";
import {
  LEADERBOARD_STATS,
  loadAllStats,
  flattenStats,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { loadKnownPlayers } from "@mcbot/core/utils/minecraft/whitelist.js";
import {
  loadMilestoneState,
  updateMilestoneState,
} from "@mcbot/core/utils/stores/milestoneStore.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { broadcastNotification } from "../notifyGuilds.js";
import { startPoller, type Poller } from "../poller.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { announce as sayInGame } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const CHECK_INTERVAL_MS = MS.hour;
const INITIAL_DELAY_MS = 5 * MS.minute;
/** Cap announcements per pass so a config change can't flood channels. */
const MAX_ANNOUNCEMENTS_PER_PASS = 10;

/** The highest configured threshold that `value` has reached, if any. */
export function highestCrossed(
  thresholds: number[],
  value: number,
): number | null {
  let best: number | null = null;
  for (const t of thresholds) {
    if (value >= t && (best === null || t > best)) best = t;
  }
  return best;
}

interface Recorded {
  serverId: string;
  statKey: string;
  uuid: string;
  value: number;
}

async function runPass(client: Client): Promise<void> {
  const config = loadConfig();
  const milestones = config.milestones ?? {};
  const statKeys = Object.keys(milestones).filter(
    (k) => LEADERBOARD_STATS[k] && (milestones[k]?.length ?? 0) > 0,
  );
  if (statKeys.length === 0) return;

  const state = loadMilestoneState();
  const recorded: Recorded[] = [];
  const seeded: Array<{ serverId: string; statKey: string }> = [];
  let announced = 0;

  for (const server of getAllInstances()) {
    let allStats: Awaited<ReturnType<typeof loadAllStats>>;
    let names: Record<string, string>;
    try {
      allStats = await loadAllStats(server);
      const players = await loadKnownPlayers(server);
      names = Object.fromEntries(players.map((p) => [p.uuid, p.name]));
    } catch (err) {
      log.warn("milestones", `Stats unavailable for ${server.id}: ${errMsg(err)}`);
      continue;
    }

    // An empty map means the stats were unreadable, not that nobody has
    // played: seeding from it would later announce every veteran's history.
    if (Object.keys(allStats).length === 0) continue;

    for (const statKey of statKeys) {
      const def = LEADERBOARD_STATS[statKey]!;
      const thresholds = milestones[statKey]!;
      const known = state.servers[server.id]?.[statKey] ?? {};
      const seeding = state.seeded[server.id]?.[statKey] !== true;

      for (const [uuid, statsFile] of Object.entries(allStats)) {
        const name = names[uuid];
        if (!name) continue;
        const value = def.extract(flattenStats(statsFile));
        const crossed = highestCrossed(thresholds, value);
        if (crossed === null) continue;
        if (crossed <= (known[uuid] ?? 0)) continue;

        if (seeding) {
          recorded.push({ serverId: server.id, statKey, uuid, value: crossed });
          continue; // first pass: record silently
        }

        // Left unrecorded past the cap, so the next pass announces it.
        if (announced >= MAX_ANNOUNCEMENTS_PER_PASS) continue;
        announced += 1;
        recorded.push({ serverId: server.id, statKey, uuid, value: crossed });
        await announce(client, server.id, name, def.label, def.format(crossed));
      }

      if (seeding) {
        seeded.push({ serverId: server.id, statKey });
        log.info(
          "milestones",
          `${server.id}/${statKey}: baseline seeded, announcements start with the next crossing`,
        );
      }
    }
  }

  if (recorded.length === 0 && seeded.length === 0) return;
  updateMilestoneState((current) => {
    for (const { serverId, statKey, uuid, value } of recorded) {
      const serverState = (current.servers[serverId] ??= {});
      (serverState[statKey] ??= {})[uuid] = value;
    }
    for (const { serverId, statKey } of seeded) {
      (current.seeded[serverId] ??= {})[statKey] = true;
    }
  });
}

async function announce(
  client: Client,
  serverId: string,
  player: string,
  statLabel: string,
  formatted: string,
): Promise<void> {
  const server = getAllInstances().find((s) => s.id === serverId);
  if (server) {
    await sayInGame(
      server,
      t("milestone.inGame", { player, value: formatted, stat: statLabel }),
    );
  }

  await broadcastNotification(client, loadConfig().guilds, {
    serverId,
    event: "milestone",
    buildEmbed: (withServerFooter) => {
      const embed = createEmbed({
        title: t("milestone.title"),
        description: t("milestone.body", {
          player,
          value: formatted,
          stat: statLabel,
        }),
        category: EmbedCategory.Milestone,
      });
      if (withServerFooter) embed.setFooter({ text: serverId });
      return embed;
    },
    logTag: "milestones",
  });
}

/**
 * Always armed: each pass reads the live config and does nothing while no
 * milestones are configured, so adding some later needs no restart.
 */
export function startMilestoneWatcher(client: Client): Poller {
  const poller = startPoller("milestones", () => runPass(client), CHECK_INTERVAL_MS, {
    initialDelayMs: INITIAL_DELAY_MS,
  });
  log.info("milestones", "Milestone watcher active (hourly)");
  return poller;
}
