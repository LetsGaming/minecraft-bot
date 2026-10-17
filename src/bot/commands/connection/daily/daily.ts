import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  rewardPoolForServer,
  loadClaimedStore,
  getServerClaims,
  updateClaimedStore,
  updatePendingRewards,
  getServerPending,
  MAX_PENDING_PER_PLAYER,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { t } from "@mcbot/core/utils/i18n.js";
import {
  getOnlinePlayers,
  isPlayerOnline,
} from "@mcbot/core/utils/minecraft/playerUtils.js";
import {
  isLinked,
  getLinkedAccount,
} from "@mcbot/core/utils/stores/linkUtils.js";
import { createInfoEmbed } from "../../../utils/embeds/embedUtils.js";
import {
  buildClaimEmbed,
  buildCooldownEmbed,
  buildQueuedEmbed,
  type GrantedRewards,
} from "./dailyEmbeds.js";
import { replyPrivate, withErrorHandling } from "../../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import type {
  DailyRewardItem,
  UserClaimData,
} from "@mcbot/core/types/index.js";
import {
  give,
  calcStreak,
  deriveMaxStreak,
  pick,
  DAILY_COOLDOWN_MS,
} from "@mcbot/core/utils/minecraft/rewards.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";

const claimLock = new Set<string>();

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward | Link required")
  .addStringOption((o) =>
    o
      .setName("server")
      .setDescription("Server to claim on (default: this guild's server)")
      .setAutocomplete(true),
  );

/**
 * A successful claim is public: showing off (or getting laughed at for) the
 * reward is the point of the command. Refusals and errors go to the invoker
 * only. The reply is deferred first because the online lookup and RCON
 * delivery can outlast Discord's 3 s window.
 */
export const execute = withErrorHandling(async (interaction) => {
    const userId = interaction.user.id;

    if (claimLock.has(userId)) {
      await replyPrivate(interaction, createInfoEmbed(t("daily.processing")));
      return;
    }
    claimLock.add(userId);

    try {
      await _execute(interaction, userId);
    } finally {
      claimLock.delete(userId);
    }
});

async function _execute(
  interaction: ChatInputCommandInteraction,
  userId: string,
): Promise<void> {
  if (!(await isLinked(userId))) {
    throw new CommandError({
      title: t("daily.linkRequiredTitle"),
      problem: t("daily.linkRequired"),
      recovery: t("daily.linkRequiredRecovery"),
    });
  }

  const username = await getLinkedAccount(userId);
  if (!username) {
    throw new CommandError({
      problem: t("daily.linkError"),
      recovery: t("daily.linkErrorRecovery"),
    });
  }

  const server = resolveServer(interaction);

  // Cooldown, streak, and history are all per server.
  const [rewardsCfg, rewardsOverride, store] = await Promise.all([
    loadDailyRewardsConfig(),
    loadServerRewardsOverride(server.id),
    loadClaimedStore(),
  ]);
  const claimed = getServerClaims(store, server.id);
  const pool = rewardPoolForServer(rewardsCfg, rewardsOverride);

  if (!pool.default.length) {
    throw new CommandError({
      problem: t("daily.dataError"),
      recovery: t("daily.dataErrorRecovery"),
    });
  }

  const now = Date.now();
  const userData: UserClaimData = claimed[userId] ?? {
    lastClaim: 0,
    currentStreak: 0,
    bonusStreak: 0,
    longestStreak: 0,
    rewards: [],
  };
  const delta = now - userData.lastClaim;

  if (delta < DAILY_COOLDOWN_MS) {
    await replyPrivate(
      interaction,
      buildCooldownEmbed({
        lastClaim: userData.lastClaim,
        now,
        currentStreak: userData.currentStreak,
      }),
    );
    return;
  }

  const online = isPlayerOnline(await getOnlinePlayers(server), username);

  const { currentStreak, bonusStreak, longestStreak } = calcStreak(
    userData,
    delta,
    deriveMaxStreak(pool.streakBonuses),
  );

  // The previous streak, shown when this claim starts over after a miss.
  const lostStreak = delta > 2 * DAILY_COOLDOWN_MS ? userData.currentStreak : 0;

  const mainReward = pick(pool.default);

  // bonusChance is a percentage (0-100) for an extra roll from the same pool,
  // independent of the streak bonus.
  const randomBonus =
    pool.bonusChance && Math.random() * 100 < pool.bonusChance
      ? pick(pool.default)
      : null;

  const bonus = pool.streakBonuses?.[String(bonusStreak)] ?? null;
  const streakBonus = bonus && bonus.length > 0 ? bonus : [];

  const grantedRewards: DailyRewardItem[] = [
    mainReward,
    ...(randomBonus ? [randomBonus] : []),
    ...streakBonus,
  ];
  const granted: GrantedRewards = { main: mainReward, randomBonus, streakBonus, bonusStreak };

  // AUD-005: the claim is written inside one transaction against the store
  // as it is now, not the copy loaded above. Saving that copy after the
  // awaits in between wrote it over every other user's claim (and reminder
  // flag) made in the meantime. Returns false when a claim landed for this
  // user since we looked, in which case nothing is written.
  const persistClaim = (): Promise<boolean> =>
    updateClaimedStore((current) => {
      // Cap the per-claim history so the file can't grow forever. Streaks
      // live in their own counters, so trimming old records loses nothing.
      const MAX_REWARD_HISTORY = 30;
      const claims = getServerClaims(current, server.id);
      const fresh = claims[userId] ?? userData;
      if (fresh.lastClaim !== userData.lastClaim) return false;

      claims[userId] = {
        // Spread first so optional fields (remind / lastReminderAt) survive
        // the claim instead of being rebuilt away.
        ...fresh,
        lastClaim: now,
        currentStreak,
        bonusStreak,
        longestStreak,
        rewards: [
          ...fresh.rewards,
          {
            date: now,
            items: grantedRewards,
            streak: currentStreak,
          },
        ].slice(-MAX_REWARD_HISTORY),
      };
      return true;
    });

  const replyAlreadyClaimed = (): Promise<unknown> =>
    replyPrivate(
      interaction,
      buildCooldownEmbed({ lastClaim: now, now, currentStreak }),
    );

  const key = username.toLowerCase();
  const entry = { discordId: userId, items: grantedRewards, queuedAt: now };

  if (!online) {
    // Offline claim: consume the claim (streak preserved), queue the
    // rolled reward, and let the joinLeave watcher deliver it on the
    // next join. A full queue rejects WITHOUT consuming the cooldown.
    const queued = await updatePendingRewards((pendingStore) => {
      const list = (getServerPending(pendingStore, server.id)[key] ??= []);
      if (list.length >= MAX_PENDING_PER_PLAYER) return null;
      list.push(entry);
      return list.length;
    });
    if (queued === null) {
      throw new CommandError({
        title: t("daily.queueFullTitle"),
        problem: t("daily.queueFull", { max: MAX_PENDING_PER_PLAYER }),
      });
    }

    if (!(await persistClaim())) {
      await updatePendingRewards((pendingStore) => {
        const queue = getServerPending(pendingStore, server.id);
        const list = queue[key]?.filter(
          (e) => !(e.discordId === userId && e.queuedAt === now),
        );
        if (list && list.length > 0) queue[key] = list;
        else delete queue[key];
      });
      await replyAlreadyClaimed();
      return;
    }

    await interaction.editReply({
      embeds: [
        buildQueuedEmbed({
          player: username,
          server: server.id,
          queued,
          max: MAX_PENDING_PER_PLAYER,
          currentStreak,
          claimedAt: now,
          rewards: grantedRewards,
        }),
      ],
    });
    return;
  }

  // AUD-022: the claim is written before anything is given. Giving first
  // and writing the claim only after every item arrived meant that a
  // failure on item 2 left item 1 delivered and the claim open, so a retry
  // handed out item 1 again plus a fresh roll. Items that don't arrive now
  // wait in the offline queue for the next join instead.
  if (!(await persistClaim())) {
    await replyAlreadyClaimed();
    return;
  }

  const undelivered: DailyRewardItem[] = [];
  for (const reward of grantedRewards) {
    if (!(await give(server, username, reward))) undelivered.push(reward);
  }

  if (undelivered.length > 0) {
    const queued = await updatePendingRewards((pendingStore) => {
      // Not capped: the claim is already used, so these items are owed.
      const list = (getServerPending(pendingStore, server.id)[key] ??= []);
      list.push({ ...entry, items: undelivered });
      return list.length;
    });
    await interaction.editReply({
      embeds: [
        buildQueuedEmbed({
          player: username,
          server: server.id,
          queued,
          max: MAX_PENDING_PER_PLAYER,
          currentStreak,
          claimedAt: now,
          rewards: undelivered,
          notice: t("daily.partlyQueued", { server: server.id }),
        }),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      buildClaimEmbed({
        player: username,
        granted,
        pool,
        currentStreak,
        longestStreak,
        lostStreak,
        claimedAt: now,
      }),
    ],
  });
}
