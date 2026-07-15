/**
 * The one embed-colour palette (QUAL-09, 2026-07 audit). Every embed's colour
 * comes from here rather than a raw `0x…` literal, so the semantic colours have
 * a single definition and can't drift (the old code had two different "info"
 * blues). Semantic names first, then the few brand/one-off colours.
 *
 * Kept in its own module — separate from embedUtils' embed *builders* — because
 * it is pure data with no discord.js dependency: tests mock the builders but
 * still get the real palette, and non-bot code can reference a colour without
 * pulling in embed machinery.
 */
export const EmbedColor = {
  Success: 0x55ff55,
  Error: 0xff5555,
  Info: 0x00bfff,
  Warning: 0xffaa00,
  Gold: 0xffd700,
  Critical: 0xff0000, // severe alert — stronger than Error
  Neutral: 0x888888, // offline / unknown / muted
  Challenge: 0xa020f0, // advancement challenge (purple)
  Blurple: 0x5865f2, // Discord brand
  Modrinth: 0x1bd96a, // Modrinth brand green
} as const;

export type EmbedColorValue = (typeof EmbedColor)[keyof typeof EmbedColor];
