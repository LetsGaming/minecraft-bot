import fs from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };
import { sendToServer } from "./sendToServer.js";

/**
 * Find a player object from whitelist by playerName (case insensitive)
 * @param {string} playerName
 * @returns {object|null} player object or null if not found
 */
export function findPlayer(playerName) {
  const whitelist = loadWhitelist();
  if (!whitelist || whitelist.length === 0) {
    return null;
  }
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

export function getLatestLogs(lines = null) {
  const logFile = path.join(config.serverDir, "logs", "latest.log");
  const logContent = fs.readFileSync(logFile, "utf-8");
  const logLines = logContent.split("\n");

  if (lines) {
    return logLines.slice(-lines).join("\n"); // 👈 always return a string
  }

  return logContent;
}

export async function getPlayerCount() {
  await sendToServer("/list");

  const logContent = getLatestLogs(100);
  if (!logContent) {
    return {
      playerCount: "unknown",
      maxPlayers: "unknown",
    };
  }
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

export function loadWhitelist() {
  const whitelistPath = path.resolve(config.serverDir, "whitelist.json");
  const whitelist = loadJson(whitelistPath);
  if (!Array.isArray(whitelist)) {
    console.error("Whitelist is not an array or does not exist.");
    return null;
  }
  if (whitelist.length === 0) {
    console.warn("Whitelist is empty.");
    return null;
  }
  return whitelist;
}

export function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
