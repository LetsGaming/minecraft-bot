/**
 * M-03: the daily commands used to call loadJson/saveJson directly, violating
 * the documented "commands must not use loadJson directly" layer rule. This
 * module is now the single owner of daily-reward persistence (rewards config
 * + per-user claim data), the same pattern utils.ts uses for the whitelist.
 */
import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";
import type { DailyRewardsConfig, UserClaimData } from "../types/index.js";

const dataDir = path.resolve(getRootDir(), "data");
const REWARDS_PATH = path.join(dataDir, "dailyRewards.json");
const CLAIMED_PATH = path.join(dataDir, "claimedDaily.json");

export type ClaimedDailyMap = Record<string, UserClaimData>;

export async function loadDailyRewardsConfig(): Promise<DailyRewardsConfig> {
  return (await loadJson(REWARDS_PATH).catch(
    () => ({}),
  )) as DailyRewardsConfig;
}

export async function loadClaimedDaily(): Promise<ClaimedDailyMap> {
  return (await loadJson(CLAIMED_PATH).catch(() => ({}))) as ClaimedDailyMap;
}

export async function saveClaimedDaily(data: ClaimedDailyMap): Promise<void> {
  return saveJson(CLAIMED_PATH, data);
}
