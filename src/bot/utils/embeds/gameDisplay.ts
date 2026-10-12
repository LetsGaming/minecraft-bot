/**
 * Small text widgets that give embeds a game feel: progress bars and milestone
 * tracks. Pure functions, no Discord types, so they are
 * cheap to test and reuse.
 */

const BAR_FULL = "▰";
const BAR_EMPTY = "▱";

/** `▰▰▰▱▱▱▱` for `value` of `max`, clamped to `width` cells. */
export function progressBar(value: number, max: number, width = 7): string {
  if (max <= 0 || width <= 0) return BAR_EMPTY.repeat(Math.max(0, width));
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(width - filled);
}

/**
 * One node per milestone day, filled once reached, with the day under it:
 * `●──●──○──○` and a second line of day numbers padded to match.
 */
export function milestoneTrack(current: number, milestones: readonly number[]): string {
  const days = [...milestones].sort((a, b) => a - b);
  if (days.length === 0) return "";
  const node = (d: number): string => (current >= d ? "●" : "○");
  const cells = days.map((d) => ({ node: node(d), label: String(d) }));
  const width = Math.max(...cells.map((c) => c.label.length)) + 1;
  const top = cells.map((c) => c.node.padEnd(width, "─")).join("").replace(/─+$/, "");
  const bottom = cells.map((c) => c.label.padEnd(width, " ")).join("").trimEnd();
  return `\`${top}\`\n\`${bottom}\``;
}
