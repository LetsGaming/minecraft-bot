// ── Daily reward types ────────────────────────────────────────────────────────

export interface DailyRewardItem {
  item: string;
  amount: number;
  weight?: number;
}

/** One reward pool: a weighted item list + optional streak milestones. */
export interface RewardPool {
  default?: DailyRewardItem[];
  // Each milestone awards an array of items (multi-item bonuses).
  streakBonuses?: Record<string, DailyRewardItem[]>;
}

export interface DailyRewardsConfig {
  default: DailyRewardItem[];
  // Each milestone awards an array of items (multi-item bonuses).
  streakBonuses?: Record<string, DailyRewardItem[]>;
  /**
   * Optional per-server pool overrides. A server listed here uses its own
   * item list and/or streak bonuses; anything it omits falls back to the
   * top-level pool, so economies can differ per server without
   * duplicating the whole file.
   */
  servers?: Record<string, RewardPool>;
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
