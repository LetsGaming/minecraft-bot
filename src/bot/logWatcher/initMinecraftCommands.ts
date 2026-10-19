import path from "path";
import { fileURLToPath } from "url";
import { discoverModules, manifestOf } from "../utils/commands/loadCommandFiles.js";
import { getGlobalWatchers } from "./logWatcher.js";
import { RemoteLogWatcher } from "./RemoteLogWatcher.js";
import {
  getAllInstances,
  getFirstInstance,
  getServerInstance,
  addServerInstance,
  removeServerInstance,
} from "@mcbot/core/utils/server/server.js";
import { loadConfig, getServerIds } from "@mcbot/core/config.js";
import { MS } from "@mcbot/schema/time.js";
import { stableStringify } from "@mcbot/core/utils/config/stableStringify.js";
import { forgetServer } from "./serverCleanup.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { Client } from "discord.js";
import type {
  BotConfig,
  InGameCommandResult,
} from "@mcbot/core/types/index.js";

// Watchers
import {
  registerChatBridge,
  setupDiscordToMc,
  reportBridgeProblems,
  invalidateWebhookCache,
} from "./watchers/log/chatBridge.js";
import {
  liveGuildConfigs,
  type GuildConfigSource,
} from "../utils/guild/guildConfigs.js";
import { registerJoinLeaveWatcher } from "./watchers/log/joinLeave.js";
import { registerDeathWatcher } from "./watchers/log/deaths.js";
import { registerAdvancementWatcher } from "./watchers/log/advancements.js";
import { registerServerEventWatcher } from "./watchers/log/serverEvents.js";
import {
  startTpsMonitor,
  type TpsMonitorHandle,
} from "./watchers/monitors/tpsMonitor.js";
import { startLeaderboardScheduler } from "./watchers/schedulers/leaderboardScheduler.js";
import {
  startStatusEmbed,
  reconcileStatusEmbed,
} from "./watchers/schedulers/statusEmbed.js";
import { startDowntimeMonitor } from "./watchers/monitors/downtimeMonitor.js";
import { startUpgradeMonitor } from "./watchers/monitors/upgradeMonitor.js";
import { startDailyReminderScheduler } from "./watchers/schedulers/dailyReminderScheduler.js";
import { startChannelPurge } from "./watchers/schedulers/channelPurge.js";
import { startHostResourcesMonitor } from "./watchers/monitors/hostResourcesMonitor.js";
import { startPollScheduler } from "./watchers/schedulers/pollScheduler.js";
import { startTempBanScheduler } from "./watchers/schedulers/tempBanScheduler.js";
import { pruneCommandUsage } from "@mcbot/core/utils/commands/commandUsage.js";
import { pruneSessions } from "@mcbot/core/utils/stores/sessionStore.js";
import { registerSleepWatcher } from "./watchers/log/sleepWatcher.js";
import { registerConsoleRelay } from "./watchers/log/consoleRelay.js";
import { startUpdateNotifier } from "./watchers/monitors/updateNotifier.js";
import { startPlayerCountSampler } from "@mcbot/core/utils/stores/playerCountHistory.js";
import { commandEnabledAnywhere } from "@mcbot/core/utils/commands/commandPolicy.js";
import {
  registerManifestCommands,
  flushCommandManifest,
} from "@mcbot/core/utils/commands/commandManifest.js";
import { reconcileRestartSchedules } from "./watchers/schedulers/restartScheduler.js";
import { startMilestoneWatcher } from "./watchers/monitors/milestoneWatcher.js";
import { ensureApplicationPrompts } from "../interactions/whitelistApplications.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Per-server watcher lifecycle ──────────────────────────────────────────
// Every resource wired for a server instance is tracked here so config-reload
// reconciliation can tear it down again when the server is removed.

interface ServerHandles {
  watcher: RemoteLogWatcher;
  tpsMonitor: TpsMonitorHandle | null;
  /** How many of the global (in-game command) watchers this watcher has. */
  globalsWired: number;
}

const serverHandles = new Map<string, ServerHandles>();

/** In-game command modules found on disk but not initialized because they were disabled everywhere. */
const deferredIngame = new Map<string, { init: () => void | Promise<void> }>();

async function initDeferredIngameCommands(): Promise<void> {
  for (const [name, mod] of [...deferredIngame]) {
    if (!commandEnabledAnywhere(name)) continue;
    deferredIngame.delete(name);
    try {
      await mod.init();
      log.info("commands", `Loaded !${name} after config reload`);
    } catch (err) {
      log.error("commands", `Failed to load !${name}: ${errMsg(err)}`);
    }
  }
  syncGlobalWatchers();
}

/**
 * AUD-021: hand every running watcher the global watchers registered since
 * it was wired. Watchers copy the global list when a server is wired, so a
 * command loaded by a later config reload reached the global list only: the
 * log said "loaded" and the command never answered until a restart.
 */
function syncGlobalWatchers(): void {
  const globals = getGlobalWatchers();
  for (const handles of serverHandles.values()) {
    for (const { regex, handler } of globals.slice(handles.globalsWired)) {
      handles.watcher.register(regex, handler);
    }
    handles.globalsWired = globals.length;
  }
}

async function wireServer(
  server: ReturnType<typeof getAllInstances>[number],
  client: Client,
  guildConfigs: GuildConfigSource,
): Promise<void> {
  // Every instance streams its log over the wrapper's SSE endpoint.
  const watcher = new RemoteLogWatcher(server);

  const globals = getGlobalWatchers();
  for (const { regex, handler } of globals) {
    watcher.register(regex, handler);
  }
  const globalsWired = globals.length;

  registerChatBridge(watcher, client, guildConfigs, getServerIds);
  registerJoinLeaveWatcher(watcher, client, guildConfigs);
  registerDeathWatcher(watcher, client, guildConfigs);
  registerAdvancementWatcher(watcher, client, guildConfigs);
  registerServerEventWatcher(watcher, client, guildConfigs);
  registerSleepWatcher(watcher);
  registerConsoleRelay(watcher, client, server.id);

  let tpsMonitor: TpsMonitorHandle | null = null;
  try {
    await watcher.start(client);
    tpsMonitor = startTpsMonitor(server, client, guildConfigs);
  } catch (err) {
    try {
      watcher.stop();
    } catch {
      // nothing running to stop
    }
    throw err;
  }

  serverHandles.set(server.id, { watcher, tpsMonitor, globalsWired });
}

function unwireServer(serverId: string): void {
  const handles = serverHandles.get(serverId);
  if (handles) {
    try {
      handles.watcher.stop();
    } catch {
      // best-effort: a watcher that failed to start has nothing to stop
    }
    handles.tpsMonitor?.stop();
    serverHandles.delete(serverId);
  }
  forgetServer(serverId);
}

export async function initMinecraftCommands(client: Client): Promise<void> {
  const cfg = loadConfig();
  // Long-lived watchers, monitors and schedulers get the PROVIDER
  // (liveGuildConfigs), never a snapshot: they are wired once and run for the
  // process lifetime, so a snapshot would miss guilds added by a later reload.

  // ── 1. Load in-game !command definitions (registers them globally) ──
  const commandsDir = path.join(__dirname, "commands");
  type InGameInit = () => void | Promise<void>;
  // A command's identity is its filename: it is what !name dispatches on and
  // what the `commands` config block keys enablement by.
  const modules = await discoverModules<InGameInit>(
    commandsDir,
    "in-game",
    (mod, file) => {
      const { init, COMMAND_INFO } = mod as Partial<InGameCommandResult> & {
        init?: InGameInit;
      };
      if (typeof init !== "function") return null;
      return {
        name: path.basename(file, ".js"),
        description: COMMAND_INFO?.description ?? "",
        value: init,
      };
    },
  );
  for (const { name, value: init } of modules) {
    try {
      // Only skip when disabled in EVERY scope; per-server enablement is
      // enforced live at dispatch inside defineCommand.
      if (!commandEnabledAnywhere(name)) {
        log.info("commands", `Skipping disabled: !${name}`);
        deferredIngame.set(name, { init });
        continue;
      }
      await init();
      log.info("commands", `Loaded !${name}`);
    } catch (err) {
      log.error("commands", `Failed to load !${name}: ${errMsg(err)}`);
    }
  }
  registerManifestCommands("ingame", manifestOf(modules));
  await flushCommandManifest();

  // ── 2. Create a LogWatcher for each server instance ──
  const instances = getAllInstances();

  for (const server of instances) {
    await wireServer(server, client, liveGuildConfigs);
  }

  // ── 3. Discord → MC chat bridge ──
  // Every bridge is bound to exactly one server (resolveGuildBridges):
  // the channel a message is typed in decides which server it reaches.
  setupDiscordToMc(
    client,
    liveGuildConfigs,
    (id) => (id ? getServerInstance(id) : getFirstInstance()),
    getServerIds,
  );

  // ── 4. Scheduled leaderboard auto-poster ──
  startLeaderboardScheduler(client, liveGuildConfigs);

  // ── 5. Persistent status embed ──
  startStatusEmbed(client, liveGuildConfigs);

  // ── 5b. Daily claim reminders ──
  startDailyReminderScheduler(client);

  // ── 6. Downtime monitor ──
  // Pass the provider so reconciled server additions/removals are
  // monitored without restarting the timer.
  startDowntimeMonitor(getAllInstances, client, liveGuildConfigs);

  // Live message for a server upgrade, and quiet downtime alerts while it runs.
  startUpgradeMonitor(getAllInstances, client, liveGuildConfigs);

  // Disk-full early warning for local instances (hostAlerts config).
  startHostResourcesMonitor(getAllInstances, client, liveGuildConfigs);

  // Re-arm open polls (close timers + button collectors) after restart.
  startPollScheduler(client);

  // Re-arm timed bans; anything that expired during downtime is pardoned now.
  startTempBanScheduler(client);

  // Usage rows past the retention window. Once at startup and once a day
  // after. The table only grows by a few hundred rows a day, so this is
  // housekeeping rather than anything time-critical.
  pruneCommandUsage();
  setInterval(() => pruneCommandUsage(), MS.day).unref();

  // Player sessions past their retention window, on the same cadence.
  const pruneOldSessions = (): void => {
    try {
      pruneSessions();
    } catch (err) {
      log.warn("sessions", `Session prune failed: ${errMsg(err)}`);
    }
  };
  pruneOldSessions();
  setInterval(pruneOldSessions, MS.day).unref();

  // ── 8. Daily channel purge ──
  startChannelPurge(client, liveGuildConfigs);

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
  await ensureApplicationPrompts(client, liveGuildConfigs).catch((err) => {
    log.warn("wlapp", `Prompt setup failed: ${errMsg(err)}`);
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
  /** Server IDs that are configured but could not be wired; they are not registered, so the next reload retries. */
  failed: string[];
  /** Server IDs whose watchers were stopped and instances dropped. */
  removed: string[];
  /** Server IDs whose settings changed and whose instance and watchers were rebuilt from the new config. */
  replaced: string[];
  /** Server IDs whose settings changed but could not be rebuilt live; these still need a restart. */
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
 *    as at startup,
 *  - IDs whose settings changed: rebuild the instance from the new config and
 *    rewire its watchers.
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
  const newIds = Object.keys(configured).filter(
    (id) => !registeredIds.has(id),
  );
  const differing = registered
    .filter(
      (inst) =>
        inst.id in configured &&
        stableStringify(inst.config) !== stableStringify(configured[inst.id]),
    )
    .map((inst) => inst.id);

  for (const id of removed) {
    unwireServer(id);
    removeServerInstance(id);
    log.info("reconcile", `Server removed and watchers stopped: ${id}`);
  }

  const replaced: string[] = [];
  const changed: string[] = [];
  for (const id of differing) {
    unwireServer(id);
    removeServerInstance(id);
    const inst = addServerInstance(configured[id]!);
    try {
      await wireServer(inst, client, liveGuildConfigs);
      replaced.push(id);
      log.info("reconcile", `Server settings changed, instance rebuilt: ${id}`);
    } catch (err) {
      changed.push(id);
      log.error("reconcile", `Failed to rewire changed server ${id}: ${errMsg(err)}`);
    }
  }

  const added: string[] = [];
  const failed: string[] = [];
  for (const id of newIds) {
    const inst = addServerInstance(configured[id]!);
    try {
      await wireServer(inst, client, liveGuildConfigs);
      added.push(id);
      log.info("reconcile", `Server added and watchers started: ${id}`);
    } catch (err) {
      // An unwired instance would answer commands but never feed the bridge
      // or monitors; dropping it lets the next reload try again.
      unwireServer(id);
      removeServerInstance(id);
      failed.push(id);
      log.error("reconcile", `Failed to wire added server ${id}: ${errMsg(err)}`);
    }
  }

  await initDeferredIngameCommands();

  // Re-probe capabilities on every reload: the admin may have just
  // installed (or removed) the setup suite, and newly added servers
  // haven't been probed at all. Command *registration* stays as decided
  // at startup; per-invocation gates pick the new flags up immediately.
  await Promise.all(
    getAllInstances().map((inst) =>
      safe(`Capability probe for ${inst.id}`, () => inst.probeCapabilities()),
    ),
  );

  // Presence / statusEmbed can be flipped by a reload: arm or disarm the
  // shared status timer so neither direction needs a restart.
  await safe("Status/presence reconcile", () => reconcileStatusEmbed(client, freshConfig));

  // Restart schedules are cheap to rebuild: clear and re-arm from the
  // fresh config so schedule edits apply without a process restart.
  await safe("Restart-schedule reconcile", () => reconcileRestartSchedules(client, freshConfig));

  // Guild blocks are re-read live by the watchers themselves, but a
  // newly added guild's bridge misconfiguration would otherwise only be
  // reported at startup, so surface it here instead. The webhook cache is
  // dropped at the same time so a re-pointed bridge channel re-resolves.
  reportBridgeProblems(
    freshConfig.guilds,
    Object.keys(freshConfig.servers),
    "chatBridge",
  );
  invalidateWebhookCache();

  // New/changed whitelistApplications blocks get their prompt posted.
  await safe("Application-prompt reconcile", () =>
    ensureApplicationPrompts(client, liveGuildConfigs),
  );

  if (changed.length > 0) {
    log.warn(
      "reconcile",
      `Settings changed on server(s) [${changed.join(", ")}] but could not be applied live; a restart is required.`,
    );
  }

  return { added, removed, replaced, changed, failed };
}

/** Run a reconcile step whose failure must not stop the rest of the reload. */
async function safe(label: string, step: () => unknown): Promise<void> {
  try {
    await step();
  } catch (err) {
    log.warn("reconcile", `${label} failed: ${errMsg(err)}`);
  }
}
