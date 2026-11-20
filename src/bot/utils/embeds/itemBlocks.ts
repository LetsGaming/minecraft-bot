/**
 * How a reward item reads in an embed. One set of builders, so the claim, the
 * queued reply, `/streak` and `/daily-history` show items the same way:
 *
 *   ## 128 × Oak Log
 *   -# 🟣 EPIC · 4/5  ◆◆◆◆◇ · 2 stacks
 *
 * The `##` and `-#` markers only belong in an embed description. A field value
 * gets bullets, and a title or footer gets plain text.
 */
import { CATEGORY_STYLE, EmbedCategory, REWARD_RARITIES, RARITY_STYLE, type RewardRarity } from "@mcbot/schema/embedCategories.js";
import { rarityOf } from "@mcbot/schema/dailyRewards.js";
import type { DailyRewardItem } from "@mcbot/core/types/index.js";
import { formatItemStack, vanillaStackSize } from "@mcbot/core/utils/minecraft/itemNames.js";
import { t } from "@mcbot/core/utils/i18n.js";

/** Small text under a line. The only place that writes the `-#` marker. */
export function subtext(text: string): string {
  return `-# ${text}`;
}

/** Meter slots: common to legendary. Dirt fills none. */
const METER_SLOTS = REWARD_RARITIES.length - 1;

/** Items that stack to 64 are counted in stacks from this amount up. */
const FULL_STACK = 64;

export function tierMeter(tier: RewardRarity): string {
  const filled = REWARD_RARITIES.indexOf(tier);
  return "◆".repeat(filled) + "◇".repeat(METER_SLOTS - filled);
}

/** The tier icon and its name: "🟣 Epic". */
export function tierLabel(tier: RewardRarity): string {
  return `${RARITY_STYLE[tier].icon} ${t(`daily.rarity.${tier}`)}`;
}

/** "2 stacks" or "1 stack + 20", only for items that stack to 64 and amounts from one stack up. */
export function stackHint(item: DailyRewardItem): string | null {
  if (vanillaStackSize(item.item) !== FULL_STACK || item.amount < FULL_STACK) return null;
  const stacks = Math.floor(item.amount / FULL_STACK);
  const rest = item.amount % FULL_STACK;
  return rest === 0 ? t("daily.stacks", { count: stacks }) : t("daily.stacksPlus", { stacks, rest });
}

/** The line under the item: tier, rank out of five, meter and stack hint. */
export function tierLine(item: DailyRewardItem): string {
  const tier = rarityOf(item);
  const rank = REWARD_RARITIES.indexOf(tier);
  const parts = [
    `${RARITY_STYLE[tier].icon} ${t(`daily.rarity.${tier}`).toUpperCase()} · ${rank}/${METER_SLOTS}  ${tierMeter(tier)}`,
  ];
  const hint = stackHint(item);
  if (hint) parts.push(hint);
  return subtext(parts.join(" · "));
}

/** The item as the focal line of an embed description, with its tier line below. */
export function heroBlock(item: DailyRewardItem): string[] {
  return [`## ${formatItemStack(item)}`, tierLine(item)];
}

/** One bullet per item, for field values and milestone lists. */
export function itemBullets(items: readonly DailyRewardItem[]): string {
  return items.map((item) => `- ${formatItemStack(item)}`).join("\n");
}

/** One line for a history entry: the tier icon when the item has a tier, then the stack. */
export function itemWithTier(item: DailyRewardItem): string {
  return item.tier === undefined ? formatItemStack(item) : `${RARITY_STYLE[item.tier].icon} ${formatItemStack(item)}`;
}

/** The milestone items under a heading, one bullet per item. The only place that writes the `###` marker. */
export function milestoneBlock(heading: string, items: readonly DailyRewardItem[]): string {
  return `### ${CATEGORY_STYLE[EmbedCategory.Milestone].icon} ${heading}\n${itemBullets(items)}`;
}

/**
 * The lines of one `/daily-history` entry. A claim stores `[main, lucky?, ...milestone]`: the
 * main and lucky stacks carry a tier and milestone items do not, so the roles can be read back
 * without a stored marker. The main reward is the first line; the lucky bonus and the milestone
 * items follow on a second line. A claim whose first item has no tier (from before tiers
 * existed) stays one plain list.
 */
export function historyEntry(items: readonly DailyRewardItem[]): { main: string; extras: string | null } {
  const [first, ...rest] = items;
  if (first === undefined || first.tier === undefined) {
    return { main: items.map(itemWithTier).join(", "), extras: null };
  }
  const lucky = rest[0]?.tier !== undefined ? rest[0] : undefined;
  const milestone = lucky === undefined ? rest : rest.slice(1);
  const milestoneIcon = CATEGORY_STYLE[EmbedCategory.Milestone].icon;
  const parts = [
    ...(lucky === undefined ? [] : [`🍀 ${itemWithTier(lucky)}`]),
    ...milestone.map((item) => `${milestoneIcon} ${formatItemStack(item)}`),
  ];
  return { main: itemWithTier(first), extras: parts.length > 0 ? `↳ ${parts.join(" · ")}` : null };
}
