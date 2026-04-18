import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync } from "fs";
import { LogWatcher, getGlobalWatchers } from "./logWatcher.js";
import { RemoteLogWatcher } from "./RemoteLogWatcher.js";
import { getAllInstances, getServerInstance } from "../utils/server.js";
import { loadConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { Client } from "discord.js";
import type { InGameCommandResult } from "../types/index.js";

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
import { startChannelPurge } from "./watchers/channelPurge.js";
import { registerSleepWatcher } from "./watchers/sleepWatcher.js";
import { startUptimeFlushScheduler } from "../utils/uptimeTracker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getCommandFiles(dir: string): string[] {
  let files: string[] = [];
  for (const file of readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (statSync(fullPath).isDirectory())
      files = files.concat(getCommandFiles(fullPath));
    else if (file.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

export async function initMinecraftCommands(client: Client): Promise<void> {
  const cfg = loadConfig();
  const guildConfigs = cfg.guilds;
  const commandOverrides = cfg.commands ?? {};

  // ── 1. Load in-game !command definitions (registers them globally) ──
  const commandsDir = path.join(__dirname, "commands");
  const commandFiles = getCommandFiles(commandsDir);

  for (const file of commandFiles) {
    try {
      const mod = (await import(
        path.resolve(file)
      )) as Partial<InGameCommandResult> & {
        init?: () => void | Promise<void>;
      };
      if (typeof mod.init !== "function") continue;
      const name = path.basename(file, ".js");
      if ((commandOverrides[name]?.enabled ?? true) === false) {
        log.info("commands", `Skipping disabled: !${name}`);
        continue;
      }
      await mod.init();
      log.info("commands", `Loaded !${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("commands", `Failed to load ${file}: ${msg}`);
    }
  }

  // ── 2. Create a LogWatcher for each server instance ──
  const globalWatchers = getGlobalWatchers();
  const instances = getAllInstances();

  for (const server of instances) {
    // Remote instances stream logs over SSE; local instances watch the file directly.
    const watcher = server.config.apiUrl
      ? new RemoteLogWatcher(server)
      : new LogWatcher(server);

    for (const { regex, handler } of globalWatchers) {
      watcher.register(regex, handler);
    }

    registerChatBridge(watcher, client, guildConfigs);
    registerJoinLeaveWatcher(watcher, client, guildConfigs);
    registerDeathWatcher(watcher, client, guildConfigs);
    registerAdvancementWatcher(watcher, client, guildConfigs);
    registerServerEventWatcher(watcher, client, guildConfigs);
    registerSleepWatcher(watcher);

    await watcher.start(client);

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

  // ── 7. Uptime flush scheduler ──
  startUptimeFlushScheduler();

  // ── 8. Daily channel purge ──
  startChannelPurge(client, guildConfigs);

  log.info(
    "init",
    `${instances.length} server(s) initialized with all watchers`,
  );
}
