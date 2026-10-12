/**
 * Embed categories: what a Discord message is about, as opposed to the status
 * roles in `status.ts`, which say how something is doing. A category gives an
 * embed its title icon and default side-bar colour; admins may override the
 * colour per category (`embedColors` in the bot config). Status roles keep
 * driving server-state embeds and the dashboard chips.
 */

export const EmbedCategory = {
  Server: "server",
  Alert: "alert",
  Recovery: "recovery",
  Presence: "presence",
  Death: "death",
  Advancement: "advancement",
  Chat: "chat",
  Milestone: "milestone",
  Reward: "reward",
  Leaderboard: "leaderboard",
  Whitelist: "whitelist",
  Confirm: "confirm",
  Info: "info",
  Error: "error",
} as const;
export type EmbedCategory = (typeof EmbedCategory)[keyof typeof EmbedCategory];

export const EMBED_CATEGORIES: readonly EmbedCategory[] = Object.values(EmbedCategory);

/** Daily reward rarity, derived from an item's share of its pool's weight. */
export const RewardRarity = {
  Common: "common",
  Uncommon: "uncommon",
  Rare: "rare",
  Epic: "epic",
  Legendary: "legendary",
} as const;
export type RewardRarity = (typeof RewardRarity)[keyof typeof RewardRarity];

export const REWARD_RARITIES: readonly RewardRarity[] = Object.values(RewardRarity);

/** Every key an admin can recolour: the categories and the rarity tiers. */
export type EmbedColorKey = EmbedCategory | `rarity.${RewardRarity}`;

export interface EmbedStyle {
  /** Unicode emoji put in front of the title. */
  icon: string;
  /** Default side-bar colour as 0xRRGGBB. */
  color: number;
}

export const CATEGORY_STYLE: Readonly<Record<EmbedCategory, EmbedStyle>> = {
  server: { icon: "🖥️", color: 0x7cb4ff },
  alert: { icon: "🚨", color: 0xf87171 },
  recovery: { icon: "💚", color: 0x34d399 },
  presence: { icon: "👋", color: 0x5eead4 },
  death: { icon: "💀", color: 0x94a3b8 },
  advancement: { icon: "🏅", color: 0xfbbf24 },
  chat: { icon: "💬", color: 0xa5b4fc },
  milestone: { icon: "🎉", color: 0xffd700 },
  reward: { icon: "🎁", color: 0xf472b6 },
  leaderboard: { icon: "🏆", color: 0xfb923c },
  whitelist: { icon: "📋", color: 0xb7a1ff },
  confirm: { icon: "❓", color: 0xb7a1ff },
  info: { icon: "ℹ️", color: 0x7cb4ff },
  error: { icon: "⛔", color: 0xf87171 },
};

export const RARITY_STYLE: Readonly<
  Record<RewardRarity, EmbedStyle & { badge: string }>
> = {
  common: { icon: "⚪", color: 0x9aa1ac, badge: "COMMON" },
  uncommon: { icon: "🟢", color: 0x4ade80, badge: "UNCOMMON" },
  rare: { icon: "🔵", color: 0x60a5fa, badge: "RARE" },
  epic: { icon: "🟣", color: 0xa855f7, badge: "EPIC" },
  legendary: { icon: "🟡", color: 0xfbbf24, badge: "LEGENDARY" },
};

export function isEmbedColorKey(key: string): key is EmbedColorKey {
  if (key.startsWith("rarity.")) {
    return (REWARD_RARITIES as readonly string[]).includes(key.slice("rarity.".length));
  }
  return (EMBED_CATEGORIES as readonly string[]).includes(key);
}

/** Default colour of a category or rarity key. */
export function defaultEmbedColor(key: EmbedColorKey): number {
  return key.startsWith("rarity.")
    ? RARITY_STYLE[key.slice("rarity.".length) as RewardRarity].color
    : CATEGORY_STYLE[key as EmbedCategory].color;
}

/** `#rrggbb` string to 0xRRGGBB, or undefined when it is not strict hex. */
export function parseHexColor(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return parseInt(value.slice(1), 16);
}
