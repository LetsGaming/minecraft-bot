// ── Uptime types ──────────────────────────────────────────────────────────────

export interface UptimeStats {
  /** Percentage 0–100, null if no data for the window */
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
  /** Total checks and online checks for each window */
  checks24h: { total: number; online: number };
  checks7d: { total: number; online: number };
  checks30d: { total: number; online: number };
  /** Current streak info */
  currentState: "online" | "offline" | "unknown";
  /** How long the server has been in its current state (ms) */
  currentStateDuration: number;
}
