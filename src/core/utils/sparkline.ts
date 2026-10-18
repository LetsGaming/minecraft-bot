/**
 * Block-character sparklines for embeds. One glyph table and one rounding
 * rule for every chart that draws one.
 */

const LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Shown for a bucket that holds no data (as opposed to a zero value). */
export const SPARKLINE_GAP = "·";

/**
 * Render one glyph per value. Values are fractions of the chart's full scale
 * (0 to 1; out-of-range values are clamped); `null` marks an empty bucket.
 */
export function renderSparkline(
  fractions: ReadonlyArray<number | null>,
): string {
  return fractions
    .map((fraction) => {
      if (fraction === null) return SPARKLINE_GAP;
      const clamped = Math.min(1, Math.max(0, fraction));
      return LEVELS[Math.round(clamped * (LEVELS.length - 1))]!;
    })
    .join("");
}
