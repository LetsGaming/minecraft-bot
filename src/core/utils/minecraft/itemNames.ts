/**
 * Display names for reward items, built from the item id alone so they read
 * the same in every language: "minecraft:cooked_beef" becomes "Cooked Beef",
 * a modded "create:brass_ingot" becomes "Brass Ingot".
 */
import type { DailyRewardItem } from "../../types/index.js";

export function itemDisplayName(id: string): string {
  const name = id.slice(id.lastIndexOf(":") + 1).replace(/_/g, " ").trim();
  if (!name) return "???";
  return name.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** "3 × Diamond" */
export function formatItemStack({ item = "", amount = 1 }: DailyRewardItem): string {
  return `${amount} × ${itemDisplayName(item)}`;
}

/** "3 × Diamond, 16 × Cooked Beef" */
export function formatItemList(items: readonly DailyRewardItem[]): string {
  return items.map(formatItemStack).join(", ");
}
