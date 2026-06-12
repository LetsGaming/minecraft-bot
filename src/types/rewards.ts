// ── Daily reward types ────────────────────────────────────────────────────────

export interface DailyRewardItem {
  item: string;
  amount: number;
  weight?: number;
}

export interface DailyRewardsConfig {
  default: DailyRewardItem[];
  // Each milestone awards an array of items (multi-item bonuses).
  streakBonuses?: Record<string, DailyRewardItem[]>;
}

export interface UserClaimData {
  lastClaim: number;
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
  /** F-04: opt-in DM reminder when the 24h cooldown expires. */
  remind?: boolean;
  /** F-04: when the last reminder DM was sent (dedupe per claim cycle). */
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
