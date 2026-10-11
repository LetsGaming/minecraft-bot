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
  saveClaimedStore,
  loadPendingRewards,
  savePendingRewards,
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
import { createInfoEmbed, createSuccessEmbed } from "../../../utils/embeds/embedUtils.js";
import { replyPrivate, withErrorHandling } from "../../middleware.js";
import { clockTimestamp, relativeTimestamp } from "../../../utils/discordTime.js";
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
import { formatItemList, formatItemStack } from "@mcbot/core/utils/minecraft/itemNames.js";

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
  const pool = rewardPoolForServer(rewardsCfg, server.id, rewardsOverride);

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
      createInfoEmbed(cooldownMsg(now + DAILY_COOLDOWN_MS - delta), {
        title: t("daily.cooldownTitle"),
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

  // Persisting the claim is shared between the online and offline paths;
  // it must only run once delivery is confirmed (online) or queued
  // (offline) — never before, so a failed give still allows a retry.
  const persistClaim = async (): Promise<void> => {
    // Cap the per-claim history so the file can't grow forever. Streaks
    // live in their own counters, so trimming old records loses nothing.
    const MAX_REWARD_HISTORY = 30;

    claimed[userId] = {
      // Spread first so optional fields (remind / lastReminderAt) survive
      // the claim instead of being rebuilt away.
      ...userData,
      lastClaim: now,
      currentStreak,
      bonusStreak,
      longestStreak,
      rewards: [
        ...userData.rewards,
        {
          date: now,
          items: grantedRewards,
          streak: currentStreak,
        },
      ].slice(-MAX_REWARD_HISTORY),
    };
    await saveClaimedStore(store);
  };

  if (!online) {
    // Offline claim: consume the claim (streak preserved), queue the
    // rolled reward, and let the joinLeave watcher deliver it on the
    // next join. A full queue rejects WITHOUT consuming the cooldown.
    const pendingStore = await loadPendingRewards();
    const queue = getServerPending(pendingStore, server.id);
    const key = username.toLowerCase();
    const list = (queue[key] ??= []);

    if (list.length >= MAX_PENDING_PER_PLAYER) {
      throw new CommandError({
        title: t("daily.queueFullTitle"),
        problem: t("daily.queueFull", { max: MAX_PENDING_PER_PLAYER }),
      });
    }

    list.push({ discordId: userId, items: grantedRewards, queuedAt: now });
    await savePendingRewards(pendingStore);
    await persistClaim();

    await interaction.editReply(
      response(granted, currentStreak, now, t("daily.queued", { server: server.id })),
    );
    return;
  }

  // Reward delivery used to be fire-and-forget — RCON could drop
  // between the online check and the give, or an invalid item ID could fail
  // server-side, and the claim was consumed anyway. Verify delivery before
  // persisting; on failure the cooldown is NOT written so the user can retry.
  for (const reward of grantedRewards) {
    const ok = await give(server, username, reward);
    if (!ok) {
      throw new CommandError({
        title: t("daily.deliveryFailedTitle"),
        problem: t("daily.deliveryFailed"),
        recovery: t("common.retryLater"),
      });
    }
  }

  await persistClaim();
  await interaction.editReply(
    response(granted, currentStreak, now),
  );
}

/** When the next reward is ready, as Discord timestamps in each reader's zone. */
function cooldownMsg(readyAt: number): string {
  return t("daily.cooldown", {
    relative: relativeTimestamp(readyAt),
    time: clockTimestamp(readyAt),
  });
}

interface GrantedRewards {
  main: DailyRewardItem;
  randomBonus: DailyRewardItem | null;
  streakBonus: DailyRewardItem[];
  bonusStreak: number;
}

function response(
  granted: GrantedRewards,
  cs: number,
  claimedAt: number,
  note?: string,
): { embeds: ReturnType<typeof createSuccessEmbed>[] } {
  const lines: string[] = [t("daily.reward", { reward: formatItemStack(granted.main) })];
  if (granted.randomBonus) {
    lines.push(t("daily.randomBonus", { reward: formatItemStack(granted.randomBonus) }));
  }
  if (granted.streakBonus.length > 0) {
    lines.push(
      t("daily.bonus", { days: granted.bonusStreak, rewards: formatItemList(granted.streakBonus) }),
    );
  }
  if (note) lines.push(note);

  const embed = createSuccessEmbed(lines.join("\n"), {
    title: t("daily.claimedTitle"),
  }).addFields(
    { name: t("daily.streakField"), value: t("streak.days", { count: cs }), inline: true },
    { name: t("daily.nextField"), value: relativeTimestamp(claimedAt + DAILY_COOLDOWN_MS), inline: true },
  );
  return { embeds: [embed] };
}
