// ── Daily reward types ────────────────────────────────────────────────────────

export interface DailyRewardItem {
  item: string;
  amount: number;
  weight?: number;
}

export interface DailyRewardsConfig {
  default: DailyRewardItem[];
  streakBonuses?: Record<string, DailyRewardItem>;
}

export interface UserClaimData {
  lastClaim: number;
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
  rewards: Array<{
    date: number;
    reward: DailyRewardItem;
    bonus: DailyRewardItem | null;
  }>;
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  bonusStreak: number;
}

export interface NextBonusStreak {
  streak: number;
  reward: DailyRewardItem;
}
