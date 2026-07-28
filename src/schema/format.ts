/**
 * Display formatting shared by the Node side and the browser bundle.
 *
 * `formatBytes` existed twice — once in core/utils/server/hostResources.ts
 * for the Discord embeds, once in web/frontend/src/utils/format.ts for the
 * dashboard — and the two had already drifted: the frontend copy dropped
 * the KB tier and rounded MB differently, so the same RSS figure rendered
 * as "512 KB" in Discord and "0 MB" in the dashboard. Both sides bundle
 * this package, so it is the one place a formatter can live without being
 * copied across the boundary.
 *
 * Plain strings and arithmetic only, per the package rule.
 */

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;

/** Bytes → a compact "8.6 GB" / "512 MB" / "64 KB" string. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${Math.round(bytes / KB)} KB`;
}
