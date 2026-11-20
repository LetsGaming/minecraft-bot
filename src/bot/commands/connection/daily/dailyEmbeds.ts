import type { EmbedBuilder } from "discord.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { DailyRewardItem, RewardPool } from "@mcbot/core/types/index.js";
import type { GrantedRewards } from "@mcbot/core/utils/minecraft/dailyClaim.js";
import { formatItemStack } from "@mcbot/core/utils/minecraft/itemNames.js";
import {
  DAILY_COOLDOWN_MS,
  STREAK_GRACE_MS,
  deriveMaxStreak,
  nextMilestone,
  rarest,
  rarityOf,
} from "@mcbot/core/utils/minecraft/rewards.js";
import { MS } from "@mcbot/schema/time.js";
import { EmbedCategory, type RewardRarity } from "@mcbot/schema/embedCategories.js";
import { createEmbed, createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor, embedColorFor } from "../../../utils/embeds/embedColors.js";
import { progressBar } from "../../../utils/embeds/gameDisplay.js";
import { heroBlock, itemBullets, milestoneBlock, subtext, tierLabel } from "../../../utils/embeds/itemBlocks.js";
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

/** The extra reward from the bonus-chance draw, on its own line under the main reward. */
function luckyLine(item: DailyRewardItem): string {
  return `🍀 **${t("daily.luckyField")}**  ${formatItemStack(item)} · ${tierLabel(rarityOf(item))}`;
}

/** The rarest tier among the rolled items; a streak bonus counts as a milestone. */
function claimRarity(view: ClaimView): RewardRarity {
  return rarest(
    [view.granted.main, ...(view.granted.randomBonus ? [view.granted.randomBonus] : [])].map(rarityOf),
  );
}

/** The public embed for a successful (or queued) claim. */
export function buildClaimEmbed(view: ClaimView): EmbedBuilder {
  const { granted, pool } = view;
  const mainRarity = rarityOf(granted.main);
  const hitMilestone = granted.streakBonus.length > 0;

  const find = heroBlock(granted.main);
  if (mainRarity === "dirt") find.push(subtext(t("daily.dirtLine")));
  const sections = [find.join("\n")];
  if (granted.randomBonus) sections.push(luckyLine(granted.randomBonus));
  if (hitMilestone) {
    sections.push(milestoneBlock(t("daily.bonusHeading", { days: granted.bonusStreak }), granted.streakBonus));
  }
  const notes: string[] = [];
  if (view.lostStreak > 1) notes.push(`💔 ${t("daily.streakLost", { previous: view.lostStreak })}`);
  if (view.note) notes.push(view.note);
  if (notes.length > 0) sections.push(notes.join("\n"));

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
    description: sections.join("\n\n"),
    category: EmbedCategory.Reward,
    color,
    footer: { text: lucky ? `🍀 ${t("daily.luckyFooter")} ${tip}` : tip },
  })
    .addFields(
      {
        name: `🔥 ${t("daily.streakField")}`,
        value: `${progressBar(granted.bonusStreak, barMax)}\n${t("streak.days", { count: view.currentStreak })}`,
        inline: true,
      },
      {
        name: `🎯 ${t("daily.nextMilestoneField")}`,
        value: next
          ? `${t("daily.nextMilestoneValue", { day: next.day })}\n${itemBullets(next.items)}`
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
  /** The main draw, when it is among the queued items. */
  main?: DailyRewardItem | null;
  /** The bonus-chance draw, when it hit and is among the queued items. */
  lucky?: DailyRewardItem | null;
  /** Replaces the "you are offline" line, e.g. for items a give could not deliver. */
  notice?: string;
}): EmbedBuilder {
  const same = (a: DailyRewardItem, b: DailyRewardItem | null | undefined): boolean =>
    b != null && (a === b || (a.item === b.item && a.amount === b.amount));
  const main = opts.main ?? null;
  const rest = opts.rewards.filter((item) => !same(item, main) && !same(item, opts.lucky));

  const sections: string[] = [];
  if (main) sections.push(heroBlock(main).join("\n"));
  if (opts.lucky) sections.push(luckyLine(opts.lucky));
  if (rest.length > 0) {
    sections.push(main ? milestoneBlock(t("daily.bonusHeadingPlain"), rest) : itemBullets(rest));
  }
  sections.push(
    `${opts.notice ?? t("daily.queued", { server: opts.server })}\n${subtext(t("daily.queueSize", { count: opts.queued, max: opts.max }))}`,
  );

  return createPlayerEmbed(opts.player, {
    title: `📦 ${t("daily.queuedTitle")}`,
    description: sections.join("\n\n"),
    color: EmbedColor.Pending,
  }).addFields(
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
