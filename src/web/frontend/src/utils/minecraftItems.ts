/**
 * The vanilla item list the reward editor searches, so nobody has to know
 * that a "Bottle o' Enchanting" is `experience_bottle`.
 *
 * Loaded on demand (it is ~70 KB) from data/minecraftItems.json, which
 * scripts/sync-minecraft-items.mjs generates. It is a search aid, never a
 * gate: any item id is accepted, so modded items and items newer than the
 * list still save, they just show their id instead of a name.
 */
import { splitItem } from "@mcbot/schema/dailyRewards.js";

export interface CatalogItem {
  /** Id without the `minecraft:` namespace. */
  id: string;
  name: string;
  stackSize: number;
}

export interface ItemCatalog {
  version: string;
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
}

interface RawCatalog {
  version: string;
  items: Array<[string, string, number]>;
}

let loading: Promise<ItemCatalog> | null = null;

export function loadItemCatalog(): Promise<ItemCatalog> {
  loading ??= import("../data/minecraftItems.json").then((mod) => {
    const raw = (mod.default ?? mod) as unknown as RawCatalog;
    const items = raw.items.map(([id, name, stackSize]) => ({ id, name, stackSize }));
    return { version: raw.version, items, byId: new Map(items.map((i) => [i.id, i])) };
  });
  return loading;
}

/** The vanilla id of an item string (`minecraft:diamond[...]` → `diamond`), or null for a modded id. */
export function vanillaId(item: string): string | null {
  const { id } = splitItem(item.trim());
  if (!id.includes(":")) return id;
  return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : null;
}

/** A readable name from the id alone, the way the bot names rewards in Discord. */
export function nameFromId(item: string): string {
  const { id } = splitItem(item);
  const name = id.slice(id.lastIndexOf(":") + 1).replace(/_/g, " ").trim();
  return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : item;
}

/** The catalog entry for an item string, when it is a known vanilla item. */
export function lookupItem(catalog: ItemCatalog | null, item: string): CatalogItem | undefined {
  const id = vanillaId(item);
  return id && catalog ? catalog.byId.get(id) : undefined;
}

/**
 * Items matching a query, best first: an exact id, then names and ids that
 * start with it, then any word that starts with it, then anything containing it.
 */
export function searchItems(catalog: ItemCatalog, query: string, limit = 30): CatalogItem[] {
  const q = query.trim().toLowerCase().replace(/^minecraft:/, "");
  if (!q) return catalog.items.slice(0, limit);
  const qId = q.replace(/\s+/g, "_");
  const scored: Array<[number, CatalogItem]> = [];
  for (const item of catalog.items) {
    const name = item.name.toLowerCase();
    let score = -1;
    if (item.id === qId) score = 0;
    else if (name === q) score = 1;
    else if (name.startsWith(q) || item.id.startsWith(qId)) score = 2;
    else if (name.split(/[\s']+/).some((w) => w.startsWith(q))) score = 3;
    else if (name.includes(q) || item.id.includes(qId)) score = 4;
    if (score >= 0) scored.push([score, item]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, item]) => item);
}
