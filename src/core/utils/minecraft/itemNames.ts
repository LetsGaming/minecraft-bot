/**
 * Display names for items and stat keys. A vanilla item reads as the game
 * names it ("Steak", "Eye of Ender"), in German where a name is drafted; any
 * other id is built from the id alone: a modded "create:brass_ingot" becomes
 * "Brass Ingot".
 */
import type { DailyRewardItem } from "../../types/index.js";
import { splitItem } from "@mcbot/schema/dailyRewards.js";
import { MINECRAFT_ITEMS } from "@mcbot/schema/minecraftItems.js";
import { resolveLanguage } from "../i18n.js";
import { germanItemName } from "./itemNamesDe.js";

/**
 * Items whose game name drops what tells them apart: every music disc is
 * "Music Disc" and every armor trim template is "<Pattern> Armor Trim". They
 * keep the name built from the id.
 */
const NAME_FROM_ID = /^(?:music_disc_|disc_fragment_)|_smithing_template$/;

let stackSizes: Map<string, number> | undefined;
let englishNames: Map<string, string> | undefined;

/** The id of a vanilla item without namespace or components, or null for a modded id. */
function vanillaId(item: string): string | null {
  const { id } = splitItem(item.trim());
  const bare = id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
  return bare.includes(":") ? null : bare;
}

/** How many of a vanilla item fit in one stack, or null for a modded or unknown id. */
export function vanillaStackSize(item: string): number | null {
  const id = vanillaId(item);
  if (id === null) return null;
  stackSizes ??= new Map(MINECRAFT_ITEMS.map(([name, , size]) => [name, size]));
  return stackSizes.get(id) ?? null;
}

/** An id without its namespace, underscores as spaces, each word capitalised. */
export function humanizeId(id: string): string {
  const name = id.slice(id.lastIndexOf(":") + 1).replace(/_/g, " ").trim();
  if (!name) return "???";
  return name.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** The name of an item in the effective language, falling back to English and then to the id. */
export function itemDisplayName(item: string): string {
  const id = vanillaId(item);
  if (id === null) return humanizeId(splitItem(item.trim()).id);
  if (resolveLanguage() === "de") {
    const german = germanItemName(id);
    if (german) return german;
  }
  if (!NAME_FROM_ID.test(id)) {
    englishNames ??= new Map(MINECRAFT_ITEMS.map(([name, display]) => [name, display]));
    const english = englishNames.get(id);
    if (english) return english;
  }
  return humanizeId(id);
}

/** "3 × Diamond" */
export function formatItemStack({ item = "", amount = 1 }: DailyRewardItem): string {
  return `${amount} × ${itemDisplayName(item)}`;
}

/** "3 × Diamond, 16 × Steak" */
export function formatItemList(items: readonly DailyRewardItem[]): string {
  return items.map(formatItemStack).join(", ");
}
