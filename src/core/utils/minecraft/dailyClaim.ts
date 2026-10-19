/**
 * The `/daily` claim as a service: roll the reward, write the claim, then
 * deliver now (player online) or queue for the next join (offline). It
 * returns a tagged outcome and knows nothing about Discord; the command maps
 * outcomes to replies.
 */
import {
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  rewardPoolForServer,
  loadClaimedStore,
  getServerClaims,
  updateClaimedStore,
  enqueuePending,
  removePending,
  MAX_PENDING_PER_PLAYER,
  type ResolvedRewardPool,
} from "../stores/dailyStore.js";
import { getLinkedAccount } from "../stores/linkUtils.js";
import type { ServerInstance } from "../server/server.js";
import type { DailyRewardItem, UserClaimData } from "../../types/index.js";
import { getOnlinePlayers, isPlayerOnline } from "./playerUtils.js";
import {
  give,
  calcStreak,
  deriveMaxStreak,
  pick,
  DAILY_COOLDOWN_MS,
  STREAK_GRACE_MS,
} from "./rewards.js";

/** Per-claim history kept per user; streaks live in their own counters. */
const MAX_REWARD_HISTORY = 30;

export interface GrantedRewards {
  main: DailyRewardItem;
  randomBonus: DailyRewardItem | null;
  streakBonus: DailyRewardItem[];
  bonusStreak: number;
}

export interface ClaimRoll {
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
  /** The previous streak, when this claim starts over after a miss. */
  lostStreak: number;
  granted: GrantedRewards;
  /** Everything handed out by this claim, in delivery order. */
  items: DailyRewardItem[];
}

/** The record of a user who has never claimed. */
export function emptyClaim(): UserClaimData {
  return { lastClaim: 0, currentStreak: 0, bonusStreak: 0, longestStreak: 0, rewards: [] };
}

/**
 * Roll one claim: advance the streak and draw the main reward, the optional
 * random bonus (`bonusChance` is a percentage) and the streak milestone bonus.
 * Pure apart from `Math.random`.
 */
export function rollClaim(
  pool: ResolvedRewardPool,
  userData: Pick<
    UserClaimData,
    "lastClaim" | "currentStreak" | "bonusStreak" | "longestStreak"
  >,
  now: number,
): ClaimRoll {
  const delta = now - userData.lastClaim;
  const { currentStreak, bonusStreak, longestStreak } = calcStreak(
    userData,
    delta,
    deriveMaxStreak(pool.streakBonuses),
  );
  const lostStreak = delta > STREAK_GRACE_MS ? userData.currentStreak : 0;

  const main = pick(pool.default);
  const randomBonus =
    pool.bonusChance && Math.random() * 100 < pool.bonusChance ? pick(pool.default) : null;
  const streakBonus = pool.streakBonuses?.[String(bonusStreak)] ?? [];

  return {
    currentStreak,
    bonusStreak,
    longestStreak,
    lostStreak,
    granted: { main, randomBonus, streakBonus, bonusStreak },
    items: [main, ...(randomBonus ? [randomBonus] : []), ...streakBonus],
  };
}

export type ClaimOutcome =
  | { kind: "not-linked" }
  | { kind: "no-rewards" }
  | { kind: "cooldown"; lastClaim: number; now: number; currentStreak: number }
  /** A claim for this user landed between the read and the write. */
  | { kind: "already-claimed"; now: number; currentStreak: number }
  | { kind: "queue-full"; max: number }
  | {
      kind: "queued";
      player: string;
      /** Entries now waiting for this player. */
      queued: number;
      max: number;
      currentStreak: number;
      claimedAt: number;
      /** The items waiting: the whole roll offline, only the failed ones online. */
      rewards: DailyRewardItem[];
      /** True when the player was online and only some items failed to arrive. */
      partial: boolean;
    }
  | {
      kind: "claimed";
      player: string;
      granted: GrantedRewards;
      pool: ResolvedRewardPool;
      currentStreak: number;
      longestStreak: number;
      lostStreak: number;
      claimedAt: number;
    };

/**
 * Write the claim against the store as it is now, not a copy loaded earlier:
 * saving a stale copy would overwrite every other user's claim (and reminder
 * flag) made in between. Returns false, writing nothing, when a claim for this
 * user landed since `previous` was read.
 */
function recordClaim(
  serverId: string,
  userId: string,
  previous: UserClaimData,
  roll: ClaimRoll,
  now: number,
): Promise<boolean> {
  return updateClaimedStore((current) => {
    const claims = getServerClaims(current, serverId);
    const fresh = claims[userId] ?? previous;
    if (fresh.lastClaim !== previous.lastClaim) return false;

    claims[userId] = {
      // Spread first so optional fields (remind / lastReminderAt) survive.
      ...fresh,
      lastClaim: now,
      currentStreak: roll.currentStreak,
      bonusStreak: roll.bonusStreak,
      longestStreak: roll.longestStreak,
      rewards: [
        ...fresh.rewards,
        { date: now, items: roll.items, streak: roll.currentStreak },
      ].slice(-MAX_REWARD_HISTORY),
    };
    return true;
  });
}

export async function claimDaily(
  server: ServerInstance,
  userId: string,
  now = Date.now(),
): Promise<ClaimOutcome> {
  const player = await getLinkedAccount(userId);
  if (!player) return { kind: "not-linked" };

  // Cooldown, streak and history are all per server.
  const [rewardsCfg, rewardsOverride, store] = await Promise.all([
    loadDailyRewardsConfig(),
    loadServerRewardsOverride(server.id),
    loadClaimedStore(),
  ]);
  const pool = rewardPoolForServer(rewardsCfg, rewardsOverride);
  if (!pool.default.length) return { kind: "no-rewards" };

  const userData: UserClaimData = getServerClaims(store, server.id)[userId] ?? emptyClaim();
  if (now - userData.lastClaim < DAILY_COOLDOWN_MS) {
    return {
      kind: "cooldown",
      lastClaim: userData.lastClaim,
      now,
      currentStreak: userData.currentStreak,
    };
  }

  const online = isPlayerOnline(await getOnlinePlayers(server), player);
  const roll = rollClaim(pool, userData, now);
  const entry = { discordId: userId, items: roll.items, queuedAt: now };
  const alreadyClaimed: ClaimOutcome = {
    kind: "already-claimed",
    now,
    currentStreak: roll.currentStreak,
  };

  if (!online) {
    // The claim is consumed (streak preserved) and the roll queued for the
    // next join. A full queue rejects WITHOUT consuming the cooldown.
    const queued = await enqueuePending(server.id, player, entry, {
      cap: MAX_PENDING_PER_PLAYER,
    });
    if (queued === null) return { kind: "queue-full", max: MAX_PENDING_PER_PLAYER };

    if (!(await recordClaim(server.id, userId, userData, roll, now))) {
      await removePending(
        server.id,
        player,
        (e) => e.discordId === userId && e.queuedAt === now,
      );
      return alreadyClaimed;
    }
    return {
      kind: "queued",
      player,
      queued,
      max: MAX_PENDING_PER_PLAYER,
      currentStreak: roll.currentStreak,
      claimedAt: now,
      rewards: roll.items,
      partial: false,
    };
  }

  // The claim is written before anything is given: giving first meant a
  // failure on item 2 left item 1 delivered and the claim open, so a retry
  // handed out item 1 again plus a fresh roll.
  if (!(await recordClaim(server.id, userId, userData, roll, now))) return alreadyClaimed;

  const undelivered: DailyRewardItem[] = [];
  for (const reward of roll.items) {
    if (!(await give(server, player, reward))) undelivered.push(reward);
  }

  if (undelivered.length > 0) {
    // Not capped: the claim is already used, so these items are owed.
    const queued = await enqueuePending(server.id, player, { ...entry, items: undelivered });
    return {
      kind: "queued",
      player,
      queued: queued ?? 0,
      max: MAX_PENDING_PER_PLAYER,
      currentStreak: roll.currentStreak,
      claimedAt: now,
      rewards: undelivered,
      partial: true,
    };
  }

  return {
    kind: "claimed",
    player,
    granted: roll.granted,
    pool,
    currentStreak: roll.currentStreak,
    longestStreak: roll.longestStreak,
    lostStreak: roll.lostStreak,
    claimedAt: now,
  };
}
