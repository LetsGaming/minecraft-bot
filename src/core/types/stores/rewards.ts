// ── Daily reward types ────────────────────────────────────────────────────────

import type { DailyRewardItem, RewardPool } from "@mcbot/schema/dailyRewards.js";

// The pool shape is shared with the dashboard (@mcbot/schema/dailyRewards.ts).
export type { DailyRewardItem, RewardPool };

/** The shared dailyRewards.json: a pool whose item list is always present. */
export interface DailyRewardsConfig extends RewardPool {
  default: DailyRewardItem[];
}

export interface UserClaimData {
  lastClaim: number;
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
  /** Opt-in DM reminder when the 24h cooldown expires. */
  remind?: boolean;
  /** When the last reminder DM was sent (dedupe per claim cycle). */
  lastReminderAt?: number;
  rewards: Array<{
    date: number;
    // First entry is the random main reward; remaining entries are the
    // streak-bonus items (zero or more, depending on whether today hit a
    // milestone and how many items that milestone awards).
    items: DailyRewardItem[];
    streak: number;
  }>;
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  bonusStreak: number;
}

export interface NextBonusStreak {
  streak: number;
  reward: DailyRewardItem[];
}
