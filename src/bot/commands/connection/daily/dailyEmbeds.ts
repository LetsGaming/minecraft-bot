import type { EmbedBuilder } from "discord.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { DailyRewardItem, RewardPool } from "@mcbot/core/types/index.js";
import type { GrantedRewards } from "@mcbot/core/utils/minecraft/dailyClaim.js";
import { formatItemList, formatItemStack } from "@mcbot/core/utils/minecraft/itemNames.js";
import {
  DAILY_COOLDOWN_MS,
  STREAK_GRACE_MS,
  deriveMaxStreak,
  nextMilestone,
  rarest,
  rarityOf,
} from "@mcbot/core/utils/minecraft/rewards.js";
import { MS } from "@mcbot/schema/time.js";
import {
  CATEGORY_STYLE,
  RARITY_STYLE,
  EmbedCategory,
  type RewardRarity,
} from "@mcbot/schema/embedCategories.js";
import { createEmbed, createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor, embedColorFor } from "../../../utils/embeds/embedColors.js";
import { progressBar } from "../../../utils/embeds/gameDisplay.js";
import { clockTimestamp, formatLastSeen } from "../../../utils/discordTime.js";

export interface ClaimView {
  player: string;
  granted: GrantedRewards;
  pool: RewardPool;
  currentStreak: number;
  longestStreak: number;
  /** Streak before this claim, when this claim started a new one after a break. */
  lostStreak: number;
  claimedAt: number;
  note?: string;
}

function rarityLabel(rarity: RewardRarity): string {
  const { icon } = RARITY_STYLE[rarity];
  return `${icon} ${t(`daily.rarity.${rarity}`)}`;
}

/** The extra reward from the bonus-chance draw, set apart from the main reward. */
function luckyField(
  item: DailyRewardItem,
  pool: readonly DailyRewardItem[],
): { name: string; value: string; inline: false } {
  return {
    name: `🍀 ${t("daily.luckyField")}`,
    value: t("daily.headline", {
      reward: formatItemStack(item),
      rarity: rarityLabel(rarityOf(item, pool)),
    }),
    inline: false,
  };
}

/** The rarest tier among the rolled items; a streak bonus counts as a milestone. */
function claimRarity(view: ClaimView): RewardRarity {
  const items = view.pool.default ?? [];
  return rarest(
    [view.granted.main, ...(view.granted.randomBonus ? [view.granted.randomBonus] : [])].map((i) =>
      rarityOf(i, items),
    ),
  );
}

/** The public embed for a successful (or queued) claim. */
export function buildClaimEmbed(view: ClaimView): EmbedBuilder {
  const { granted, pool } = view;
  const mainRarity = rarityOf(granted.main, pool.default ?? []);
  const hitMilestone = granted.streakBonus.length > 0;

  const lines = [
    t("daily.headline", {
      reward: formatItemStack(granted.main),
      rarity: rarityLabel(mainRarity),
    }),
  ];
  if (hitMilestone) {
    lines.push(
      `${CATEGORY_STYLE[EmbedCategory.Milestone].icon} ${t("daily.bonus", {
        days: granted.bonusStreak,
        rewards: formatItemList(granted.streakBonus),
      })}`,
    );
  }
  if (view.lostStreak > 1) {
    lines.push(`💔 ${t("daily.streakLost", { previous: view.lostStreak })}`);
  }
  if (view.note) lines.push(view.note);

  const lucky = granted.randomBonus;
  const color = hitMilestone
    ? embedColorFor(EmbedCategory.Milestone)
    : lucky
      ? EmbedColor.Success
      : embedColorFor(`rarity.${claimRarity(view)}`);

  const cycle = deriveMaxStreak(pool.streakBonuses);
  const next = nextMilestone(granted.bonusStreak, pool.streakBonuses);
  const barMax = next?.day ?? cycle;

  const tip = t("daily.footerTip", { hours: streakWindowHours() });
  return createPlayerEmbed(view.player, {
    title: t("daily.claimedTitle"),
    description: lines.join("\n"),
    category: EmbedCategory.Reward,
    color,
    footer: { text: lucky ? `🍀 ${t("daily.luckyFooter")} ${tip}` : tip },
  })
    .addFields(
      ...(lucky ? [luckyField(lucky, pool.default ?? [])] : []),
      {
        name: `🔥 ${t("daily.streakField")}`,
        value: `${progressBar(granted.bonusStreak, barMax)}\n${t("streak.days", { count: view.currentStreak })}`,
        inline: true,
      },
      {
        name: `🎯 ${t("daily.nextMilestoneField")}`,
        value: next
          ? t("daily.nextMilestoneValue", { day: next.day, rewards: formatItemList(next.items) })
          : t("streak.na"),
        inline: true,
      },
      {
        name: `⏰ ${t("daily.nextField")}`,
        value: formatLastSeen(view.claimedAt + DAILY_COOLDOWN_MS),
        inline: true,
      },
    );
}

/** The private embed when a claim is not ready yet. */
export function buildCooldownEmbed(opts: {
  lastClaim: number;
  now: number;
  currentStreak: number;
}): EmbedBuilder {
  const readyAt = opts.lastClaim + DAILY_COOLDOWN_MS;
  const deadline = opts.lastClaim + STREAK_GRACE_MS;
  const lines = [
    t("daily.cooldown", { relative: formatLastSeen(readyAt), time: clockTimestamp(readyAt) }),
    progressBar(opts.now - opts.lastClaim, DAILY_COOLDOWN_MS, 10),
  ];
  if (opts.currentStreak > 1) {
    lines.push(
      `⚠️ ${t("daily.streakDeadline", { time: clockTimestamp(deadline), streak: opts.currentStreak })}`,
    );
  }
  return createEmbed({
    title: `⏳ ${t("daily.cooldownTitle")}`,
    description: lines.join("\n"),
    color: EmbedColor.Pending,
  });
}

/** The embed when the player is offline and the reward waits for the next join. */
export function buildQueuedEmbed(opts: {
  player: string;
  server: string;
  queued: number;
  max: number;
  currentStreak: number;
  claimedAt: number;
  rewards: readonly DailyRewardItem[];
  /** The bonus-chance draw, when it hit and is among the queued items. */
  lucky?: DailyRewardItem | null;
  /** Replaces the "you are offline" line, e.g. for items a give could not deliver. */
  notice?: string;
}): EmbedBuilder {
  return createPlayerEmbed(opts.player, {
    title: `📦 ${t("daily.queuedTitle")}`,
    description: [
      opts.notice ?? t("daily.queued", { server: opts.server }),
      `📋 ${formatItemList(opts.rewards)}`,
      t("daily.queueSize", { count: opts.queued, max: opts.max }),
    ].join("\n"),
    color: EmbedColor.Pending,
  }).addFields(
    ...(opts.lucky
      ? [{ name: `🍀 ${t("daily.luckyField")}`, value: formatItemStack(opts.lucky), inline: false }]
      : []),
    {
      name: `🔥 ${t("daily.streakField")}`,
      value: t("streak.days", { count: opts.currentStreak }),
      inline: true,
    },
    {
      name: `⏰ ${t("daily.nextField")}`,
      value: formatLastSeen(opts.claimedAt + DAILY_COOLDOWN_MS),
      inline: true,
    },
  );
}

function streakWindowHours(): number {
  return Math.round(STREAK_GRACE_MS / MS.hour);
}
