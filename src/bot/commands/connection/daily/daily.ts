import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadDailyRewardsConfig,
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
import { getOnlinePlayers, isPlayerOnline } from "@mcbot/core/utils/minecraft/playerUtils.js";
import { isLinked, getLinkedAccount } from "@mcbot/core/utils/stores/linkUtils.js";
import { createErrorEmbed } from "../../../utils/embeds/embedUtils.js";
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
import { formatTime } from "@mcbot/core/utils/time.js";

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

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  if (claimLock.has(userId)) {
    await interaction.reply({
      content: "⏳ Already processing your claim — please wait.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  claimLock.add(userId);

  try {
    await _execute(interaction, userId);
  } finally {
    claimLock.delete(userId);
  }
}

async function _execute(
  interaction: ChatInputCommandInteraction,
  userId: string,
): Promise<void> {
  if (!(await isLinked(userId))) {
    await interaction.reply(
      errorReply("You must link your Discord account first.", "Link Required"),
    );
    return;
  }

  const username = await getLinkedAccount(userId);
  if (!username) {
    await interaction.reply(
      errorReply("Could not resolve linked account.", "Link Error"),
    );
    return;
  }

  const server = resolveServer(interaction);

  // Cooldown, streak, and history are all per server.
  const [rewardsCfg, store] = await Promise.all([
    loadDailyRewardsConfig(),
    loadClaimedStore(),
  ]);
  const claimed = getServerClaims(store, server.id);
  const pool = rewardPoolForServer(rewardsCfg, server.id);

  if (!pool.default.length) {
    await interaction.reply(
      errorReply("Daily rewards data unavailable.", "Data Error"),
    );
    return;
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
    await interaction.reply({
      content: cooldownMsg(DAILY_COOLDOWN_MS - delta),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const online = isPlayerOnline(await getOnlinePlayers(server), username);

  const { currentStreak, bonusStreak, longestStreak } = calcStreak(
    userData,
    delta,
    deriveMaxStreak(pool.streakBonuses),
  );

  const grantedRewards: DailyRewardItem[] = [];
  const mainReward = pick(pool.default);
  grantedRewards.push(mainReward);

  const bonus = pool.streakBonuses?.[String(bonusStreak)] ?? null;
  if (bonus && bonus.length > 0) {
    grantedRewards.push(...bonus);
  }

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
      await interaction.reply(
        errorReply(
          t("daily.queueFull", { max: MAX_PENDING_PER_PLAYER }),
          "Delivery Queue Full",
        ),
      );
      return;
    }

    list.push({ discordId: userId, items: grantedRewards, queuedAt: now });
    await savePendingRewards(pendingStore);
    await persistClaim();

    await interaction.reply(
      response(
        grantedRewards,
        currentStreak,
        bonusStreak,
        !!bonus && bonus.length > 0,
        t("daily.queued", { server: server.id }),
      ),
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
      await interaction.reply(
        errorReply(
          "Reward delivery failed — your claim was not consumed. Please try again in a moment.",
          "Delivery Failed",
        ),
      );
      return;
    }
  }

  await persistClaim();
  await interaction.reply(
    response(
      grantedRewards,
      currentStreak,
      bonusStreak,
      !!bonus && bonus.length > 0,
    ),
  );
}

function errorReply(
  msg: string,
  footer: string,
): { embeds: [ReturnType<typeof createErrorEmbed>]; flags: number } {
  return {
    embeds: [
      createErrorEmbed(msg, {
        footer: { text: footer },
        timestamp: new Date(),
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function cooldownMsg(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const readyAt = new Date(Date.now() + ms);
  return `⏳ Next claim in ${h}h ${m}m. | Ready at ${formatTime(readyAt)}`;
}





function response(
  items: DailyRewardItem[],
  cs: number,
  bs: number,
  hasBonus: boolean,
  note?: string,
): { content: string } {
  const lines: string[] = [];
  const main = items[0];

  if (main) {
    lines.push(`🎁 **Daily Reward:** ${fmt(main)}`);
  }

  if (hasBonus && items.length > 1) {
    const bonusItems = items.slice(1);
    const bonusList = bonusItems.map(fmt).join(", ");
    lines.push(`🔥 **${bs}-day bonus:** ${bonusList}`);
  }

  lines.push(`📈 Streak: ${cs} days`);
  if (note) lines.push(note);
  return { content: lines.join("\n") };
}

function fmt({ item = "???", amount = 1 }: DailyRewardItem): string {
  const cleanName = item.replace(/^minecraft:/, "").replace(/_/g, " ");
  return `${amount}x ${cleanName}`;
}


