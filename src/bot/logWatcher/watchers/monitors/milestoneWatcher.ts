/**
 * Milestone posts — "X just passed 1,000 hours" style announcements.
 *
 * Config (top level; values in the stat's native unit — playtime is
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
 * that get posted. data/milestones.json is the single owner of that
 * state.
 */
import { type Client } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import { getAllInstances } from "@mcbot/core/utils/server/server.js";
import {
  LEADERBOARD_STATS,
  loadAllStats,
  flattenStats,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { loadKnownPlayers } from "@mcbot/core/utils/minecraft/whitelist.js";
import { kvGet, kvSet } from "@mcbot/core/db/kv.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import { broadcastNotification } from "../notifyGuilds.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";

const CHECK_INTERVAL_MS = 60 * 60_000;
const INITIAL_DELAY_MS = 5 * 60_000;
/** Cap announcements per pass so a config change can't flood channels. */
const MAX_ANNOUNCEMENTS_PER_PASS = 10;

interface MilestoneState {
  /** serverId → statKey → uuid → highest announced (or seeded) value */
  servers: Record<string, Record<string, Record<string, number>>>;
  /** serverId → statKey → seeded flag */
  seeded: Record<string, Record<string, boolean>>;
}

async function loadState(): Promise<MilestoneState> {
  const raw = kvGet<Partial<MilestoneState>>("milestones");
  return { servers: raw?.servers ?? {}, seeded: raw?.seeded ?? {} };
}

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

async function runPass(client: Client): Promise<void> {
  const config = loadConfig();
  const milestones = config.milestones ?? {};
  const statKeys = Object.keys(milestones).filter(
    (k) => LEADERBOARD_STATS[k] && (milestones[k]?.length ?? 0) > 0,
  );
  if (statKeys.length === 0) return;

  const state = await loadState();
  let announced = 0;
  let dirty = false;

  for (const server of getAllInstances()) {
    let allStats: Awaited<ReturnType<typeof loadAllStats>>;
    let names: Record<string, string>;
    try {
      allStats = await loadAllStats(server);
      const players = await loadKnownPlayers(false, server);
      names = Object.fromEntries(players.map((p) => [p.uuid, p.name]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("milestones", `Stats unavailable for ${server.id}: ${msg}`);
      continue;
    }

    const serverState = (state.servers[server.id] ??= {});
    const serverSeeded = (state.seeded[server.id] ??= {});

    for (const statKey of statKeys) {
      const def = LEADERBOARD_STATS[statKey]!;
      const thresholds = milestones[statKey]!;
      const statState = (serverState[statKey] ??= {});
      const seeding = serverSeeded[statKey] !== true;

      for (const [uuid, statsFile] of Object.entries(allStats)) {
        const name = names[uuid];
        if (!name) continue;
        const value = def.extract(flattenStats(statsFile));
        const crossed = highestCrossed(thresholds, value);
        if (crossed === null) continue;

        const previous = statState[uuid] ?? 0;
        if (crossed <= previous) continue;

        statState[uuid] = crossed;
        dirty = true;
        if (seeding) continue; // first pass: record silently

        if (announced >= MAX_ANNOUNCEMENTS_PER_PASS) continue;
        announced += 1;
        await announce(client, server.id, name, def.label, def.format(crossed));
      }

      if (seeding) {
        serverSeeded[statKey] = true;
        dirty = true;
        log.info(
          "milestones",
          `${server.id}/${statKey}: baseline seeded — announcements start with the next crossing`,
        );
      }
    }
  }

  if (dirty) kvSet("milestones", state);
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
    try {
      await server.sendCommand(
        `/say ${t("milestone.inGame", { player, value: formatted, stat: statLabel })}`,
      );
    } catch {
      /* offline server — the Discord post still lands */
    }
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
        color: EmbedColor.Gold,
      });
      if (withServerFooter) embed.setFooter({ text: serverId });
      return embed;
    },
    logTag: "milestones",
  });
}

export function startMilestoneWatcher(
  client: Client,
): ReturnType<typeof setInterval> | null {
  try {
    const milestones = loadConfig().milestones ?? {};
    if (Object.keys(milestones).length === 0) return null;
  } catch {
    return null;
  }

  const tick = (): void => {
    runPass(client).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("milestones", `Pass failed: ${msg}`);
    });
  };
  setTimeout(tick, INITIAL_DELAY_MS);
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  log.info("milestones", "Milestone watcher active (hourly)");
  return timer;
}
