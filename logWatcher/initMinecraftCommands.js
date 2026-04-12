import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync, readFileSync } from "fs";
import { LogWatcher, getGlobalWatchers } from "./logWatcher.js";
import { getAllInstances, getServerInstance } from "../utils/server.js";
import { loadConfig } from "../config.js";
import { log } from "../utils/logger.js";

// Watchers
import { registerChatBridge, setupDiscordToMc } from "./watchers/chatBridge.js";
import { registerJoinLeaveWatcher } from "./watchers/joinLeave.js";
import { registerDeathWatcher } from "./watchers/deaths.js";
import { registerAdvancementWatcher } from "./watchers/advancements.js";
import { registerServerEventWatcher } from "./watchers/serverEvents.js";
import { startTpsMonitor } from "./watchers/tpsMonitor.js";
import { startLeaderboardScheduler } from "./watchers/leaderboardScheduler.js";
import { startStatusEmbed } from "./watchers/statusEmbed.js";
import { startDowntimeMonitor } from "./watchers/downtimeMonitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let botConfig = {};
try { botConfig = JSON.parse(readFileSync(path.resolve(process.cwd(), "config.json"), "utf-8")); } catch { /* */ }

function getCommandFiles(dir) {
  let files = [];
  for (const file of readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (statSync(fullPath).isDirectory()) files = files.concat(getCommandFiles(fullPath));
    else if (file.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

export async function initMinecraftCommands(client) {
  const cfg = loadConfig();
  const guildConfigs = cfg.guilds || {};

  // ── 1. Load in-game !command definitions (registers them globally) ──
  const commandsDir = path.join(__dirname, "commands");
  const commandFiles = getCommandFiles(commandsDir);

  for (const file of commandFiles) {
    try {
      const mod = await import(path.resolve(file));
      if (typeof mod.init !== "function") continue;
      const name = path.basename(file, ".js");
      if ((botConfig.commands?.[name]?.enabled ?? true) === false) {
        log.info("commands", `Skipping disabled: !${name}`);
        continue;
      }
      await mod.init();
      log.info("commands", `Loaded !${name}`);
    } catch (err) {
      log.error("commands", `Failed to load ${file}: ${err.message}`);
    }
  }

  // ── 2. Create a LogWatcher for each server instance ──
  const globalWatchers = getGlobalWatchers();
  const instances = getAllInstances();

  for (const server of instances) {
    const watcher = new LogWatcher(server);

    // Register all global !commands
    for (const { regex, handler } of globalWatchers) {
      watcher.register(regex, handler);
    }

    // Register event watchers
    registerChatBridge(watcher, client, guildConfigs);
    registerJoinLeaveWatcher(watcher, client, guildConfigs);
    registerDeathWatcher(watcher, client, guildConfigs);
    registerAdvancementWatcher(watcher, client, guildConfigs);
    registerServerEventWatcher(watcher, client, guildConfigs);

    // Start watching
    await watcher.start(client);

    // Start TPS monitor (per server, only if RCON)
    startTpsMonitor(server, client, guildConfigs);
  }

  // ── 3. Discord → MC chat bridge ──
  setupDiscordToMc(client, guildConfigs, getServerInstance);

  // ── 4. Scheduled leaderboard auto-poster ──
  startLeaderboardScheduler(client, guildConfigs);

  // ── 5. Persistent status embed ──
  startStatusEmbed(client, guildConfigs);

  // ── 6. Downtime monitor ──
  startDowntimeMonitor(instances, client, guildConfigs);

  log.info("init", `${instances.length} server(s) initialized with all watchers`);
}
