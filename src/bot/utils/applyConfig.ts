/**
 * applyConfig — the bot-only half of the config-editing seam.
 *
 * readRawConfig / validateCandidate / writeConfig are file-based and live
 * in @mcbot/core (utils/configService.ts), usable from any process. Applying
 * a config to the RUNNING bot (reload cache + reconcile instances and
 * watchers) requires the live Discord client, so it lives here. The web
 * backend never imports this: it writes via writeConfig and lets the
 * bot's fs watcher pick the change up.
 */
import type { Client } from "discord.js";
import { reloadConfig } from "@mcbot/core/config.js";
import { reconcileServers } from "../logWatcher/initMinecraftCommands.js";
import type { BotConfig } from "@mcbot/core/types/index.js";

/**
 * Reload the config cache and reconcile running server instances and
 * watchers with it — the same path `/config reload` uses. Call after
 * writeConfig() when the bot should apply the change immediately instead
 * of waiting for the fs watcher.
 */
export async function applyConfig(client: Client): Promise<{
  config: BotConfig;
  added: string[];
  removed: string[];
  changed: string[];
}> {
  const config = reloadConfig();
  const { added, removed, changed } = await reconcileServers(client, config);
  return { config, added, removed, changed };
}
