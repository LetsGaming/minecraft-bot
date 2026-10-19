/**
 * applyConfig: the bot-only half of the config-editing seam.
 *
 * readRawConfig / validateCandidate / writeConfig are file-based and live
 * in @mcbot/core (utils/config/configService.ts), usable from any process.
 * Applying a config to the RUNNING bot (reload cache + reconcile instances
 * and watchers) requires the live Discord client, so it lives here. The web
 * backend never imports this: it writes via writeConfig and lets the bot's
 * fs watcher pick the change up.
 *
 * This is the one "reload config and reconcile" sequence: the file watcher
 * and `/config reload` both run it.
 */
import type { Client } from "discord.js";
import { loadConfig, reloadConfig } from "@mcbot/core/config.js";
import { beginConfigApply } from "@mcbot/core/utils/server/runtimeHeartbeat.js";
import { summarizeConfigChanges } from "@mcbot/core/utils/config/configDiff.js";
import { log } from "@mcbot/core/utils/logger.js";
import {
  reconcileServers,
  type ReconcileResult,
} from "../logWatcher/initMinecraftCommands.js";
import type { BotConfig } from "@mcbot/core/types/index.js";

export interface ApplyResult extends ReconcileResult {
  config: BotConfig;
  /** One line per changed setting outside the servers block, as `summarizeConfigChanges` words them. */
  settingChanges: string[];
}

let lastApplied: BotConfig | null = null;

/**
 * The config loaded at startup counts as fully applied: the heartbeat reports
 * it as such, and later reloads are diffed against it.
 */
export function markStartupConfigApplied(config: BotConfig): void {
  lastApplied = config;
  beginConfigApply()([]);
}

/**
 * Reconcile running server instances and watchers with the config.
 *
 * Without `fresh` the config file is reloaded first (`/config reload`, or a
 * caller that just ran writeConfig and does not want to wait for the fs
 * watcher). The fs watcher passes the config it already reloaded.
 */
export async function applyConfig(
  client: Client,
  fresh?: BotConfig,
): Promise<ApplyResult> {
  const before = lastApplied ?? loadConfig();
  const config = fresh ?? reloadConfig();
  const settingChanges = summarizeConfigChanges(before, config);
  lastApplied = config;
  for (const change of settingChanges) {
    log.info("config", `Reload: ${change}`);
  }

  // The revision is captured before reconciling so a second reload landing
  // mid-reconcile is not reported as applied before it was.
  const reportApplied = beginConfigApply();
  const result = await reconcileServers(client, config);
  reportApplied(result.changed);

  const { added, removed, replaced, changed, failed } = result;
  if (added.length + removed.length + replaced.length + changed.length + failed.length > 0) {
    log.info(
      "config",
      `Reload applied, added: [${added.join(", ")}], removed: [${removed.join(", ")}], rebuilt: [${replaced.join(", ")}]` +
        (changed.length > 0
          ? `; changed (restart required): [${changed.join(", ")}]`
          : "") +
        (failed.length > 0 ? `; failed to start: [${failed.join(", ")}]` : ""),
    );
  }
  return { config, settingChanges, ...result };
}
