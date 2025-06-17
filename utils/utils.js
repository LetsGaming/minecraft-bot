import fs from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };
import { sendToServer } from "../../utils/sendToServer";

/**
 * Find a player object from whitelist by playerName (case insensitive)
 * @param {string} playerName
 * @returns {object|null} player object or null if not found
 */
export function findPlayer(playerName) {
  const whitelistPath = path.resolve(config.serverDir, "whitelist.json");
  if (!fs.existsSync(whitelistPath)) return null;

  const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf-8"));
  const player = whitelist.find(
    (p) => p.name.toLowerCase() === playerName.toLowerCase()
  );
  return player ?? null;
}

export function deleteStats(uuid) {
  const statsPath = path.resolve(
    config.serverDir,
    "world",
    "stats",
    `${uuid}.json`
  );
  if (fs.existsSync(statsPath)) {
    fs.unlinkSync(statsPath);
    return true;
  }
  return false;
}

export async function getPlayerCount() {
  await sendToServer("/list");
  const logFile = path.join(config.serverDir, "logs", "latest.log");
  const logContent = fs.readFileSync(logFile, "utf-8");
  const list = logContent
    .split("\n")
    .reverse()
    .find(
      (line) => line.includes("There are") && line.includes("players online")
    );
  const onlinePlayers = list.match(
    /There are (\d+) of a max of (\d+) players online/
  );
  const playerCount = onlinePlayers ? onlinePlayers[1] : "unknown";
  const maxPlayers = onlinePlayers ? onlinePlayers[2] : "unknown";
  return {
    playerCount,
    maxPlayers,
  };
}
