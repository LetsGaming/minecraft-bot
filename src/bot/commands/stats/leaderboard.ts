import { buildLeaderboardData, executeLeaderboard } from "../shared/leaderboard.js";

export const data = buildLeaderboardData("leaderboard");
export const execute = executeLeaderboard;
