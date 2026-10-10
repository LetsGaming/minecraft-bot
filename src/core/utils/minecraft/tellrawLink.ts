/**
 * Clickable-link components for `/tellraw`.
 *
 * Minecraft 1.21.5 renamed the click component: `clickEvent` with a `value`
 * became `click_event` with a per-action field (`url` for open_url). Each
 * side silently ignores the other's key, so a link built for the wrong
 * version renders but does nothing when clicked.
 */

export type ClickFormat = "legacy" | "modern" | "both";

const MODERN_SINCE = [1, 21, 5];

/**
 * `legacy` below 1.21.5, `modern` from 1.21.5. With no usable version,
 * `both`: every version ignores the key it does not know, so emitting both
 * is the one choice that works wherever the server turns out to be.
 */
export function clickFormatForVersion(version: string | null): ClickFormat {
  if (!version) return "both";
  const parts = version.split(".").map((n) => parseInt(n, 10));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return "both";
  for (let i = 0; i < MODERN_SINCE.length; i++) {
    const have = parts[i] ?? 0;
    const need = MODERN_SINCE[i]!;
    if (have !== need) return have > need ? "modern" : "legacy";
  }
  return "modern";
}

/** The click-event keys for an open_url action, to spread into a component. */
export function openUrlClick(
  url: string,
  format: ClickFormat,
): Record<string, unknown> {
  const legacy = { clickEvent: { action: "open_url", value: url } };
  const modern = { click_event: { action: "open_url", url } };
  if (format === "legacy") return legacy;
  if (format === "modern") return modern;
  return { ...legacy, ...modern };
}
