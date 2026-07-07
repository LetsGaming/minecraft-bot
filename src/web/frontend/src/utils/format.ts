// Small presentation helpers shared across views, so formatting logic
// lives in one place rather than being copy-pasted per component.

/** Bytes → a compact "8.6 GB" / "512 MB" string. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * A raw disk path with a bare "4%" means nothing in a UI. Derive a role
 * label from the path so a metric reads "Backups disk 4% used"; callers
 * keep the full path available on hover.
 */
export function diskLabel(path: string): string {
  const p = path.toLowerCase();
  if (p.includes("backup")) return "Backups disk";
  if (p.includes("instance") || p.includes("server")) return "Server disk";
  return "Disk";
}

/** TPS → a PrimeVue severity for tags/accents. */
export function tpsSeverity(tps: number): "success" | "warn" | "danger" {
  return tps >= 18 ? "success" : tps >= 12 ? "warn" : "danger";
}
