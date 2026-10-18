/**
 * When each guild's scheduled leaderboard was last posted: single owner of
 * kv_store["leaderboardSchedule"].
 *
 * Shape: { "<guildId>": epochMs }
 */
import type { LeaderboardScheduleState } from "../../types/index.js";
import { documentStore } from "./versionedStore.js";

const scheduleDoc = documentStore<LeaderboardScheduleState>(
  "leaderboardSchedule",
  (raw) =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as LeaderboardScheduleState)
      : {},
);

export function loadLeaderboardSchedule(): LeaderboardScheduleState {
  return scheduleDoc.load();
}

/** Record a post (or a failed attempt) for one guild without touching the others. */
export function recordLeaderboardPost(guildId: string, at: number): void {
  scheduleDoc.update((schedule) => {
    schedule[guildId] = at;
  });
}
