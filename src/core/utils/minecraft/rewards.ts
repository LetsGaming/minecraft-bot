/**
 * Daily-reward domain rules: streaks, the weighted pool draw, and getting
 * items into a player's inventory. Nothing here knows about Discord.
 */
import {
  hasPending,
  takePending,
  requeuePending,
  recordFailed,
  MAX_DELIVERY_ATTEMPTS,
  type FailedRewardEntry,
  type PendingRewardEntry,
} from "../stores/dailyStore.js";
import type { ServerInstance } from "../server/server.js";
import { COMMAND_NOT_RUN } from "../server/commandOutcome.js";
import { consoleCommand, tellraw } from "./serverMessages.js";
import { errMsg } from "../error.js";
import { formatItemList } from "./itemNames.js";
import type {
  DailyRewardItem,
  RewardPool,
  UserClaimData,
} from "../../types/index.js";
import { t } from "../i18n.js";
import { type RewardRarity, REWARD_RARITIES } from "@mcbot/schema/embedCategories.js";
import { rarityOf, milestoneDays, splitItem } from "@mcbot/schema/dailyRewards.js";
import { DEFAULT_MAX_STREAK, deriveMaxStreak, pick } from "@mcbot/schema/rewardRoll.js";
import { log } from "../logger.js";
import { MS } from "@mcbot/schema/time.js";

/** One claim per 24h. */
export const DAILY_COOLDOWN_MS = MS.day;

/** A gap of more than this since the last claim (two cooldowns) breaks the streak. */
export const STREAK_GRACE_MS = 2 * DAILY_COOLDOWN_MS;

interface StreakResult {
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
}

/**
 * The streak as it stands now. The stored `currentStreak` only changes on a
 * claim, so someone who stopped claiming kept showing their old streak on
 * `/streak` and the leaderboard until they claimed again. Past the grace
 * window (two cooldowns, the same rule calcStreak breaks it by) it is 0.
 */
export function liveStreak(
  data: Pick<UserClaimData, "currentStreak" | "lastClaim">,
  now = Date.now(),
): number {
  if (!data.lastClaim || now - data.lastClaim > STREAK_GRACE_MS) return 0;
  return data.currentStreak ?? 0;
}

export function calcStreak(
  {
    currentStreak,
    bonusStreak,
    longestStreak,
  }: Pick<UserClaimData, "currentStreak" | "bonusStreak" | "longestStreak">,
  delta: number,
  cycleMax: number = DEFAULT_MAX_STREAK,
): StreakResult {
  const broken = delta > STREAK_GRACE_MS;
  const cs = broken ? 1 : currentStreak + 1;

  let bs: number;
  if (broken) {
    bs = 1;
  } else if (bonusStreak >= cycleMax) {
    bs = 1;
  } else {
    bs = bonusStreak + 1;
  }

  return {
    currentStreak: cs,
    bonusStreak: bs,
    longestStreak: Math.max(longestStreak, cs),
  };
}

// The draw lives in the schema so the dashboard's claim preview rolls the same way.
export { DEFAULT_MAX_STREAK, deriveMaxStreak, pick };

/**
 * How a /give ended, which tells a retry from a dead end:
 * - `delivered`: the RCON reply says "Gave ...". Servers with no reply
 *   channel give no signal and are assumed successful.
 * - `unreachable`: the command did not reach the server. Retry; this says
 *   nothing about the item.
 * - `unconfirmed`: the server answered with something else (a player that is
 *   not online yet, an unknown reply). Retry, but only a few times.
 * - `rejected`: the server or the command builder refused the item itself
 *   (unknown id, bad components). No retry can fix that.
 */
export type GiveStatus = "delivered" | "unreachable" | "unconfirmed" | "rejected";

/** Replies to /give that name a problem with the item, not with the moment. */
const GIVE_REJECTED = /^(Unknown item|Unknown component|Expected|Invalid)/i;

/**
 * Give a reward item to a player. IDs get a "minecraft:" prefix only when
 * they have no namespace, so modded IDs like "create:brass_ingot" pass
 * through unchanged. The raw reply of a failed give is logged so bad item
 * IDs surface.
 */
export async function give(
  server: ServerInstance,
  player: string,
  { item, amount = 1 }: DailyRewardItem,
): Promise<GiveStatus> {
  if (!player || !item) {
    log.error(
      "daily",
      `Invalid reward params for player=${player} item=${item}`,
    );
    return "rejected";
  }
  const { id, suffix } = splitItem(item);
  const name = `${id.includes(":") ? id : `minecraft:${id}`}${suffix}`;

  let command: string;
  try {
    command = consoleCommand("give", { player }, { item: name }, { count: amount });
  } catch (err) {
    log.error("daily", `Refused to give ${item} x${amount} to ${player}: ${errMsg(err)}`);
    return "rejected";
  }
  const outcome = await server.send(command);

  // The command may never have reached the server. Report it so the reward
  // stays queued and is retried, rather than being marked delivered.
  if (outcome.kind === "unreachable") {
    log.error(
      "daily",
      `Give failed for ${player} (item=${name}): ${outcome.reason}: ${outcome.detail}`,
    );
    return "unreachable";
  }

  // Sent over a channel with no reply: the command reached the server but its
  // outcome cannot be read. Reporting failure here would re-queue a reward
  // the player already holds and re-give it on every join.
  if (outcome.kind === "sent") return "delivered";

  if (/\bGave\b/i.test(outcome.output)) return "delivered";

  const output = outcome.output.trim();
  log.error(
    "daily",
    `Give not confirmed for ${player} (item=${name}): ${output}`,
  );
  return COMMAND_NOT_RUN.test(output) || GIVE_REJECTED.test(output)
    ? "rejected"
    : "unconfirmed";
}

/**
 * Deliver queued offline claims for a player who just joined, called by
 * the joinLeave watcher. Entries are removed once ALL their items are
 * confirmed delivered; on partial failure the entry stays with only the
 * undelivered items, so the next join retries exactly what's missing.
 *
 * An item the server rejects moves to the failed list at once. An entry that
 * stays unconfirmed for MAX_DELIVERY_ATTEMPTS runs moves there too, so one bad
 * entry cannot sit in the queue forever. A run where the wrapper is
 * unreachable does not count as an attempt.
 *
 * Returns the number of items delivered.
 */
export async function deliverPendingRewards(
  server: ServerInstance,
  player: string,
): Promise<number> {
  // Taken in one transaction before giving anything, so two joins close
  // together cannot both deliver them; only what failed is put back.
  // Most joins have nothing queued: the plain read keeps them off the write lock.
  if (!(await hasPending(server.id, player))) return 0;

  const list = await takePending(server.id, player);
  if (list.length === 0) return 0;

  const delivered: DailyRewardItem[] = [];
  const work = list.map((entry) => ({
    entry,
    todo: [...entry.items],
    retry: [] as DailyRewardItem[],
    rejected: [] as DailyRewardItem[],
    unconfirmed: false,
  }));

  let failedCount = 0;
  try {
    for (const w of work) {
      while (w.todo.length > 0) {
        const item = w.todo[0]!;
        const status = await give(server, player, item);
        if (status === "delivered") delivered.push(item);
        else if (status === "rejected") w.rejected.push(item);
        else {
          w.retry.push(item);
          if (status === "unconfirmed") w.unconfirmed = true;
        }
        w.todo.shift();
      }
    }
  } finally {
    // If give throws, the item in flight and everything not yet attempted
    // stay in `todo` and are re-queued with the ones that need a retry.
    const now = Date.now();
    const requeue: PendingRewardEntry[] = [];
    const failed: FailedRewardEntry[] = [];
    for (const w of work) {
      const { discordId, queuedAt } = w.entry;
      if (w.rejected.length > 0) {
        failed.push({ discordId, queuedAt, failedAt: now, items: w.rejected, reason: "rejected" });
      }
      const left = [...w.retry, ...w.todo];
      if (left.length === 0) continue;
      const attempts = (w.entry.attempts ?? 0) + (w.unconfirmed ? 1 : 0);
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        failed.push({ discordId, queuedAt, failedAt: now, items: left, reason: "attempts" });
      } else {
        requeue.push({ ...w.entry, items: left, attempts });
      }
    }
    for (const f of failed) {
      failedCount += f.items.length;
      log.error(
        "daily",
        `Gave up on ${f.items.length} reward item(s) for ${player} (${f.reason}): ${formatItemList(f.items)}`,
      );
    }
    await requeuePending(server.id, player, requeue);
    await recordFailed(server.id, player, failed);
  }

  if (delivered.length > 0) {
    await tellraw(server, player, {
      text: t("daily.delivered", {
        count: delivered.length,
        items: formatItemList(delivered),
      }),
      color: "green",
    });
  }
  if (failedCount > 0) await tellUndeliverable(server, player, failedCount);
  return delivered.length;
}

/** Tells a player that reward items could not be delivered and an admin can see why. */
export async function tellUndeliverable(
  server: ServerInstance,
  player: string,
  count: number,
): Promise<void> {
  await tellraw(server, player, {
    text: t("daily.undeliverable", { count }),
    color: "red",
  });
}

// Rarity and the milestone list are shared with the dashboard's editor.
export { rarityOf, milestoneDays };

/** The rarest of a set of tiers, in the order dirt < common < ... < legendary. */
export function rarest(tiers: readonly RewardRarity[]): RewardRarity {
  return tiers.reduce<RewardRarity>(
    (best, tier) => (REWARD_RARITIES.indexOf(tier) > REWARD_RARITIES.indexOf(best) ? tier : best),
    REWARD_RARITIES[0]!,
  );
}

/** The first bonus after `bonusStreak`, or null when none is left in this cycle. */
export function nextMilestone(
  bonusStreak: number,
  streakBonuses: RewardPool["streakBonuses"],
): { day: number; items: DailyRewardItem[] } | null {
  const day = milestoneDays(streakBonuses).find((d) => d > bonusStreak);
  if (day === undefined) return null;
  return { day, items: streakBonuses?.[String(day)] ?? [] };
}

/**
 * The bonus streak as `/streak` should show it: past the same grace window
 * `liveStreak` uses (two cooldowns), the stored value is stale and reads as 0.
 */
export function liveBonusStreak(
  data: Pick<UserClaimData, "bonusStreak" | "lastClaim">,
  now = Date.now(),
): number {
  if (!data.lastClaim || now - data.lastClaim > STREAK_GRACE_MS) return 0;
  return data.bonusStreak ?? 0;
}