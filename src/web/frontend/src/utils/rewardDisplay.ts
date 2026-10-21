/**
 * How the rewards editor words and colours things: item names, chances,
 * rarity. Pure functions of the catalog and the entries, so every component
 * of the editor says the same thing the same way.
 */
import { REWARD_RARITIES, RARITY_STYLE, type RewardRarity } from "@mcbot/schema/embedCategories.js";
import { type DailyRewardItem } from "@mcbot/schema/dailyRewards.js";
import { lookupItem, nameFromId, vanillaId, type ItemCatalog } from "./minecraftItems";
import { t, type MessageKey } from "../i18n";

export function itemName(catalog: ItemCatalog | null, item: string): string {
  return lookupItem(catalog, item)?.name ?? nameFromId(item);
}

/** Vanilla items are checked against the list; a modded id is taken on trust. */
export function isKnownItem(catalog: ItemCatalog | null, item: string): boolean {
  if (!catalog || vanillaId(item) === null) return true;
  return lookupItem(catalog, item) !== undefined;
}

/** "3 × Diamond" */
export function stackText(catalog: ItemCatalog | null, entry: Pick<DailyRewardItem, "item" | "amount">): string {
  return `${entry.amount} × ${itemName(catalog, entry.item)}`;
}

/** "2 stacks" when the amount is more than one stack, else "". */
export function stackNote(catalog: ItemCatalog | null, entry: Pick<DailyRewardItem, "item" | "amount">): string {
  const stack = lookupItem(catalog, entry.item)?.stackSize;
  if (!stack || entry.amount <= stack) return "";
  return t("rewards.stacks", { count: Math.ceil(entry.amount / stack) });
}

export function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function formatPercent(value: number): string {
  return value >= 10 ? value.toFixed(1) : value >= 1 ? value.toFixed(2) : value.toPrecision(2);
}

/** "about 1 in 101 claims" */
export function oneInText(percent: number): string {
  return percent > 0 ? t("rewards.oneIn", { count: Math.max(1, Math.round(100 / percent)) }) : "";
}

export function rarityLabel(rarity: RewardRarity): string {
  return t(`appearance.key.rarity.${rarity}` as MessageKey);
}

/** The tier's own colour, the one its Discord embed uses. */
export function rarityColor(rarity: RewardRarity): string {
  return `#${RARITY_STYLE[rarity].color.toString(16).padStart(6, "0")}`;
}

/** 0 for common up to 4 for legendary, for sorting. */
export function rarityRank(rarity: RewardRarity): number {
  return REWARD_RARITIES.indexOf(rarity);
}

export { REWARD_RARITIES };
