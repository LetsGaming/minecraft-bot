// ── Stat builder types ────────────────────────────────────────────────────────
// These are distinct from the core stats types (LeaderboardEntry, etc.) in
// index.ts — they describe the options/result shape for the buildLeaderboard
// utility function, which depends on ServerInstance.

import type { ServerInstance } from "../utils/server.js";
import type { LeaderboardEntry } from "./index.js";

export interface BuildLeaderboardOptions {
  limit?: number;
  baseline?: Record<string, Record<string, number>> | null;
  periodLabel?: string | null;
  /** Which server to pull stats from. Must be provided by the caller. */
  server: ServerInstance;
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  title: string;
  description: string;
  footerText: string;
}
