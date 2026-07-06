import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync } from "fs";
import { LogWatcher, getGlobalWatchers } from "./logWatcher.js";
import { RemoteLogWatcher } from "./RemoteLogWatcher.js";
import {
  getAllInstances,
  getFirstInstance,
  getServerInstance,
  addServerInstance,
  removeServerInstance,
} from "@mcbot/core/utils/server.js";
import { loadConfig, getServerIds } from "@mcbot/core/config.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { Client } from "discord.js";
import type {
  BotConfig,
  GuildConfig,
  InGameCommandResult,
} from "@mcbot/core/types/index.js";

// Watchers
import { registerChatBridge, setupDiscordToMc } from "./watchers/chatBridge.js";
import { registerJoinLeaveWatcher } from "./watchers/joinLeave.js";
import { registerDeathWatcher } from "./watchers/deaths.js";
import { registerAdvancementWatcher } from "./watchers/advancements.js";
import { registerServerEventWatcher } from "./watchers/serverEvents.js";
import { startTpsMonitor } from "./watchers/tpsMonitor.js";
import { startLeaderboardScheduler } from "./watchers/leaderboardScheduler.js";
import {
  startStatusEmbed,
  reconcileStatusEmbed,
} from "./watchers/statusEmbed.js";
import { startDowntimeMonitor } from "./watchers/downtimeMonitor.js";
import { startDailyReminderScheduler } from "./watchers/dailyReminderScheduler.js";
import { startChannelPurge } from "./watchers/channelPurge.js";
import { startHostResourcesMonitor } from "./watchers/hostResourcesMonitor.js";
import { startPollScheduler } from "./watchers/pollScheduler.js";
import { registerSleepWatcher } from "./watchers/sleepWatcher.js";
import { registerConsoleRelay } from "./watchers/consoleRelay.js";
import { startUptimeFlushScheduler } from "@mcbot/core/utils/uptimeTracker.js";
import { startUpdateNotifier } from "./watchers/updateNotifier.js";
import { startPlayerCountSampler } from "@mcbot/core/utils/playerCountHistory.js";
import { commandEnabledAnywhere } from "@mcbot/core/utils/commandPolicy.js";
import {
  registerManifestCommands,
  flushCommandManifest,
} from "@mcbot/core/utils/commandManifest.js";
import { reconcileRestartSchedules } from "./watchers/restartScheduler.js";
import { startMilestoneWatcher } from "./watchers/milestoneWatcher.js";
import { ensureApplicationPrompts } from "../interactions/whitelistApplications.js";

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

// ── Per-server watcher lifecycle ──────────────────────────────────────────
// Every resource wired for a server instance is tracked here so config-reload
// reconciliation can tear it down again when the server is removed.

interface ServerHandles {
  watcher: LogWatcher | RemoteLogWatcher;
  tpsTimer: ReturnType<typeof setInterval> | null;
}

const serverHandles = new Map<string, ServerHandles>();

async function wireServer(
  server: ReturnType<typeof getAllInstances>[number],
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): Promise<void> {
  // Remote instances stream logs over SSE; local instances watch the file directly.
  const watcher = server.config.apiUrl
    ? new RemoteLogWatcher(server)
    : new LogWatcher(server);

  for (const { regex, handler } of getGlobalWatchers()) {
    watcher.register(regex, handler);
  }

  registerChatBridge(watcher, client, guildConfigs, getServerIds());
  registerJoinLeaveWatcher(watcher, client, guildConfigs);
  registerDeathWatcher(watcher, client, guildConfigs);
  registerAdvancementWatcher(watcher, client, guildConfigs);
  registerServerEventWatcher(watcher, client, guildConfigs);
  registerSleepWatcher(watcher);
  registerConsoleRelay(watcher, client, server.id);

  await watcher.start(client);

  const tpsTimer = startTpsMonitor(server, client, guildConfigs);

  serverHandles.set(server.id, { watcher, tpsTimer });
}

function unwireServer(serverId: string): void {
  const handles = serverHandles.get(serverId);
  if (!handles) return;
  try {
    handles.watcher.stop();
  } catch {
    // best-effort — a watcher that failed to start has nothing to stop
  }
  if (handles.tpsTimer) clearInterval(handles.tpsTimer);
  serverHandles.delete(serverId);
}

export async function initMinecraftCommands(client: Client): Promise<void> {
  const cfg = loadConfig();
  const guildConfigs = cfg.guilds;

  // ── 1. Load in-game !command definitions (registers them globally) ──
  const commandsDir = path.join(__dirname, "commands");
  const commandFiles = getCommandFiles(commandsDir);

  const manifestIngame: Array<{ name: string; description: string }> = [];
  for (const file of commandFiles) {
    try {
      const mod = (await import(
        path.resolve(file)
      )) as Partial<InGameCommandResult> & {
        init?: () => void | Promise<void>;
      };
      if (typeof mod.init !== "function") continue;
      const name = path.basename(file, ".js");
      manifestIngame.push({
        name,
        description: mod.COMMAND_INFO?.description ?? "",
      });
      // Only skip when disabled in EVERY scope; per-server enablement is
      // enforced live at dispatch inside defineCommand.
      if (!commandEnabledAnywhere(name)) {
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
  registerManifestCommands("ingame", manifestIngame);
  await flushCommandManifest();

  // ── 2. Create a LogWatcher for each server instance ──
  const instances = getAllInstances();

  for (const server of instances) {
    await wireServer(server, client, guildConfigs);
  }

  // ── 3. Discord → MC chat bridge ──
  // Every bridge is bound to exactly one server (resolveGuildBridges):
  // the channel a message is typed in decides which server it reaches.
  setupDiscordToMc(
    client,
    guildConfigs,
    (id) => (id ? getServerInstance(id) : getFirstInstance()),
    getServerIds(),
  );

  // ── 4. Scheduled leaderboard auto-poster ──
  startLeaderboardScheduler(client, guildConfigs);

  // ── 5. Persistent status embed ──
  startStatusEmbed(client, guildConfigs);

  // ── 5b. Daily claim reminders ──
  startDailyReminderScheduler(client);

  // ── 6. Downtime monitor ──
  // Pass the provider so reconciled server additions/removals are
  // monitored without restarting the timer.
  startDowntimeMonitor(getAllInstances, client, guildConfigs);

  // Disk-full early warning for local instances (hostAlerts config).
  startHostResourcesMonitor(getAllInstances, client, guildConfigs);

  // Re-arm open polls (close timers + button collectors) after restart.
  startPollScheduler(client);

  // ── 7. Uptime flush scheduler ──
  startUptimeFlushScheduler();

  // ── 8. Daily channel purge ──
  startChannelPurge(client, guildConfigs);

  // ── 9. Daily release check (opt-out via updateNotifier.enabled) ──
  startUpdateNotifier(client);

  // ── 10. Player-count history sampler ──
  // No-ops per server while the status pass keeps feeding fresh samples;
  // covers deployments that run neither status embed nor presence.
  startPlayerCountSampler(getAllInstances);

  // ── 11. Scheduled restarts ──
  reconcileRestartSchedules(client, cfg);

  // ── 12. Milestone announcements (only when configured) ──
  startMilestoneWatcher(client);

  // ── 13. Whitelist application prompts ──
  await ensureApplicationPrompts(client, guildConfigs).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("wlapp", `Prompt setup failed: ${msg}`);
  });

  log.info(
    "init",
    `${instances.length} server(s) initialized with all watchers`,
  );
}

// ── Config-reload reconciliation ──────────────────────────────────────────

export interface ReconcileResult {
  /** Server IDs added to the registry and fully wired (watchers + TPS). */
  added: string[];
  /** Server IDs whose watchers were stopped and instances dropped. */
  removed: string[];
  /**
   * Server IDs that exist in both old and new config but whose settings
   * differ. Live instances keep their original config object (RCON client,
   * watcher, etc. were built from it), so these still need a restart.
   */
  changed: string[];
}

// Reconciliations are serialized: /config reload and the config file
// watcher can fire near-simultaneously for the same edit, and interleaved
// add/remove of the same server ID would corrupt the handle registry.
let reconcileChain: Promise<unknown> = Promise.resolve();

/**
 * Apply server additions/removals from a freshly reloaded config to the
 * running bot:
 *  - removed IDs: stop the log watcher, clear the TPS timer, disconnect
 *    RCON, and drop the instance from the registry,
 *  - added IDs: create the instance and wire the full watcher set, exactly
 *    as at startup.
 *
 * Everything that resolves instances per tick (snapshot timer, downtime
 * monitor, status embed, command routing) picks the change up automatically
 * via getAllInstances()/getServerInstance().
 */
export function reconcileServers(
  client: Client,
  freshConfig: BotConfig,
): Promise<ReconcileResult> {
  const run = reconcileChain.then(() => doReconcile(client, freshConfig));
  reconcileChain = run.catch(() => {});
  return run;
}

async function doReconcile(
  client: Client,
  freshConfig: BotConfig,
): Promise<ReconcileResult> {
  const configured = freshConfig.servers;
  const registered = getAllInstances();
  const registeredIds = new Set(registered.map((i) => i.id));

  const removed = [...registeredIds].filter((id) => !(id in configured));
  const added = Object.keys(configured).filter(
    (id) => !registeredIds.has(id),
  );
  const changed = registered
    .filter(
      (inst) =>
        inst.id in configured &&
        JSON.stringify(inst.config) !== JSON.stringify(configured[inst.id]),
    )
    .map((inst) => inst.id);

  for (const id of removed) {
    unwireServer(id);
    removeServerInstance(id);
    log.info("reconcile", `Server removed and watchers stopped: ${id}`);
  }

  for (const id of added) {
    const inst = addServerInstance(configured[id]!);
    try {
      await wireServer(inst, client, freshConfig.guilds);
      log.info("reconcile", `Server added and watchers started: ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("reconcile", `Failed to wire added server ${id}: ${msg}`);
    }
  }

  // Re-probe capabilities on every reload — the admin may have just
  // installed (or removed) the setup suite, and newly added servers
  // haven't been probed at all. Command *registration* stays as decided
  // at startup; per-invocation gates pick the new flags up immediately.
  await Promise.all(
    getAllInstances().map(async (inst) => {
      try {
        await inst.probeCapabilities();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("reconcile", `Capability probe failed for ${inst.id}: ${msg}`);
      }
    }),
  );

  // Presence / statusEmbed can be flipped by a reload: arm or disarm the
  // shared status timer so neither direction needs a restart.
  try {
    reconcileStatusEmbed(client, freshConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("reconcile", `Status/presence reconcile failed: ${msg}`);
  }

  // Restart schedules are cheap to rebuild — clear + re-arm from the
  // fresh config so schedule edits apply without a process restart.
  try {
    reconcileRestartSchedules(client, freshConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("reconcile", `Restart-schedule reconcile failed: ${msg}`);
  }

  // New/changed whitelistApplications blocks get their prompt posted.
  await ensureApplicationPrompts(client, freshConfig.guilds).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("reconcile", `Application-prompt reconcile failed: ${msg}`);
  });

  if (changed.length > 0) {
    log.warn(
      "reconcile",
      `Settings changed on existing server(s) [${changed.join(", ")}] — a restart is required to apply those (live instances keep their original connection settings).`,
    );
  }

  return { added, removed, changed };
}
