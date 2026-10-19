import { buildLeaderboardData, executeLeaderboard } from "../shared/leaderboard.js";

export const data = buildLeaderboardData("top");
export const execute = executeLeaderboard;
